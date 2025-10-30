#!/usr/bin/env node

import { Command } from 'commander';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { WrapperConfig, LogLevel } from './types';
import { logger } from './logger';
import {
  writeConfigs,
  startContainers,
  runCopilotCommand,
  stopContainers,
  cleanup,
} from './docker-manager';
import {
  ensureFirewallNetwork,
  setupHostIptables,
  cleanupHostIptables,
} from './host-iptables';
import { runMainWorkflow } from './cli-workflow';
import { redactSecrets } from './redact-secrets';

/**
 * Parses a comma-separated list of domains into an array of trimmed, non-empty domain strings
 * @param input - Comma-separated domain string (e.g., "github.com, api.github.com, npmjs.org")
 * @returns Array of trimmed domain strings with empty entries filtered out
 */
export function parseDomains(input: string): string[] {
  return input
    .split(',')
    .map(d => d.trim())
    .filter(d => d.length > 0);
}

/**
 * Redacts sensitive information from command strings
 */
function redactSecrets(command: string): string {
  return command
    // Redact Authorization: Bearer <token>
    .replace(/(Authorization:\s*Bearer\s+)(\S+)/gi, '$1***REDACTED***')
    // Redact Authorization: <token> (non-Bearer)
    .replace(/(Authorization:\s+(?!Bearer\s))(\S+)/gi, '$1***REDACTED***')
    // Redact tokens in environment variables (TOKEN, SECRET, PASSWORD, KEY, API_KEY, etc)
    .replace(/(\w*(?:TOKEN|SECRET|PASSWORD|KEY|AUTH)\w*)=(\S+)/gi, '$1=***REDACTED***')
    // Redact GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_)
    .replace(/\b(gh[pousr]_[a-zA-Z0-9]{36,255})/g, '***REDACTED***');
}

/**
 * Result of parsing environment variables
 */
export interface ParseEnvResult {
  success: true;
  env: Record<string, string>;
}

export interface ParseEnvError {
  success: false;
  invalidVar: string;
}

/**
 * Parses environment variables from an array of KEY=VALUE strings
 * @param envVars Array of environment variable strings in KEY=VALUE format
 * @returns ParseEnvResult with parsed key-value pairs on success, or ParseEnvError with the invalid variable on failure
 */
export function parseEnvironmentVariables(envVars: string[]): ParseEnvResult | ParseEnvError {
  const result: Record<string, string> = {};
  
  for (const envVar of envVars) {
    const match = envVar.match(/^([^=]+)=(.*)$/);
    if (!match) {
      return { success: false, invalidVar: envVar };
    }
    const [, key, value] = match;
    result[key] = value;
  }
  
  return { success: true, env: result };
}

const program = new Command();

program
  .name('awf')
  .description('Network firewall for agentic workflows with domain whitelisting')
  .version('0.1.0')
  .requiredOption(
    '--allow-domains <domains>',
    'Comma-separated list of allowed domains (e.g., github.com,api.github.com)'
  )
  .option(
    '--log-level <level>',
    'Log level: debug, info, warn, error',
    'info'
  )
  .option(
    '--keep-containers',
    'Keep containers running after command exits',
    false
  )
  .option(
    '--work-dir <dir>',
    'Working directory for temporary files',
    path.join(os.tmpdir(), `awf-${Date.now()}`)
  )
  .option(
    '--build-local',
    'Build containers locally instead of using GHCR images',
    false
  )
  .option(
    '--image-registry <registry>',
    'Container image registry',
    'ghcr.io/githubnext/gh-aw-firewall'
  )
  .option(
    '--image-tag <tag>',
    'Container image tag',
    'latest'
  )
  .option(
    '-e, --env <KEY=VALUE>',
    'Additional environment variables to pass to container (can be specified multiple times)',
    (value, previous: string[] = []) => [...previous, value],
    []
  )
  .option(
    '--env-all',
    'Pass all host environment variables to container (excludes system vars like PATH, DOCKER_HOST)',
    false
  )
  .argument('<command>', 'Copilot command to execute (wrap in quotes)')
  .action(async (copilotCommand: string, options) => {
    // Parse and validate options
    const logLevel = options.logLevel as LogLevel;
    if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
      console.error(`Invalid log level: ${logLevel}`);
      process.exit(1);
    }

    logger.setLevel(logLevel);

    const allowedDomains = parseDomains(options.allowDomains);

    if (allowedDomains.length === 0) {
      logger.error('At least one domain must be specified with --allow-domains');
      process.exit(1);
    }

    // Parse additional environment variables from --env flags
    let additionalEnv: Record<string, string> = {};
    if (options.env && Array.isArray(options.env)) {
      const parsed = parseEnvironmentVariables(options.env);
      if (!parsed.success) {
        logger.error(`Invalid environment variable format: ${parsed.invalidVar} (expected KEY=VALUE)`);
        process.exit(1);
      }
      additionalEnv = parsed.env;
    }

    const config: WrapperConfig = {
      allowedDomains,
      copilotCommand,
      logLevel,
      keepContainers: options.keepContainers,
      workDir: options.workDir,
      buildLocal: options.buildLocal,
      imageRegistry: options.imageRegistry,
      imageTag: options.imageTag,
      additionalEnv: Object.keys(additionalEnv).length > 0 ? additionalEnv : undefined,
      envAll: options.envAll,
    };

    // Warn if --env-all is used
    if (config.envAll) {
      logger.warn('⚠️  Using --env-all: All host environment variables will be passed to container');
      logger.warn('   This may expose sensitive credentials if logs or configs are shared');
    }

    // Log config with redacted secrets
    const redactedConfig = {
      ...config,
      copilotCommand: redactSecrets(config.copilotCommand),
    };
    logger.debug('Configuration:', JSON.stringify(redactedConfig, null, 2));
    logger.info(`Allowed domains: ${allowedDomains.join(', ')}`);

    let exitCode = 0;
    let containersStarted = false;
    let hostIptablesSetup = false;

    // Handle cleanup on process exit
    const performCleanup = async (signal?: string) => {
      if (signal) {
        logger.info(`Received ${signal}, cleaning up...`);
      }

      if (containersStarted) {
        await stopContainers(config.workDir, config.keepContainers);
      }

      if (hostIptablesSetup && !config.keepContainers) {
        await cleanupHostIptables();
      }

      if (!config.keepContainers) {
        await cleanup(config.workDir, false);
        // Note: We don't remove the firewall network here since it can be reused
        // across multiple runs. Cleanup script will handle removal if needed.
      } else {
        logger.info(`Configuration files preserved at: ${config.workDir}`);
        logger.info(`Copilot logs available at: ${config.workDir}/copilot-logs/`);
        logger.info(`Squid logs available at: ${config.workDir}/squid-logs/`);
        logger.info(`Host iptables rules preserved (--keep-containers enabled)`);
      }
    };

    // Register signal handlers
    process.on('SIGINT', async () => {
      await performCleanup('SIGINT');
      process.exit(130); // Standard exit code for SIGINT
    });

    process.on('SIGTERM', async () => {
      await performCleanup('SIGTERM');
      process.exit(143); // Standard exit code for SIGTERM
    });

    try {
      exitCode = await runMainWorkflow(
        config,
        {
          ensureFirewallNetwork,
          setupHostIptables,
          writeConfigs,
          startContainers,
          runCopilotCommand,
        },
        {
          logger,
          performCleanup,
          onHostIptablesSetup: () => {
            hostIptablesSetup = true;
          },
          onContainersStarted: () => {
            containersStarted = true;
          },
        }
      );

      process.exit(exitCode);
    } catch (error) {
      logger.error('Fatal error:', error);
      await performCleanup();
      process.exit(1);
    }
  });

// Only parse arguments if this file is run directly (not imported as a module)
if (require.main === module) {
  program.parse();
}
