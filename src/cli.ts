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
 * Parses domains from a file, supporting both line-separated and comma-separated formats
 * @param filePath - Path to file containing domains (one per line or comma-separated)
 * @returns Array of trimmed domain strings with empty entries and comments filtered out
 * @throws Error if file doesn't exist or can't be read
 */
export function parseDomainsFile(filePath: string): string[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Domains file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const domains: string[] = [];

  // Split by lines first
  const lines = content.split('\n');
  
  for (const line of lines) {
    // Remove comments (anything after #)
    const withoutComment = line.split('#')[0].trim();
    
    // Skip empty lines
    if (withoutComment.length === 0) {
      continue;
    }
    
    // Check if line contains commas (comma-separated format)
    if (withoutComment.includes(',')) {
      // Parse as comma-separated domains
      const commaSeparated = parseDomains(withoutComment);
      domains.push(...commaSeparated);
    } else {
      // Single domain per line
      domains.push(withoutComment);
    }
  }

  return domains;
}

/**
 * Escapes a shell argument by wrapping it in single quotes and escaping any single quotes within it
 * @param arg - Argument to escape
 * @returns Escaped argument safe for shell execution
 */
export function escapeShellArg(arg: string): string {
  // If the argument doesn't contain special characters, return as-is
  // Character class includes: letters, digits, underscore, dash, dot (literal), slash, equals, colon
  if (/^[a-zA-Z0-9_\-./=:]+$/.test(arg)) {
    return arg;
  }
  // Otherwise, wrap in single quotes and escape any single quotes inside
  // The pattern '\\'' works by: ending the single-quoted string ('),
  // adding an escaped single quote (\'), then starting a new single-quoted string (')
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Joins an array of shell arguments into a single command string, properly escaping each argument
 * @param args - Array of arguments
 * @returns Command string with properly escaped arguments
 */
export function joinShellArgs(args: string[]): string {
  return args.map(escapeShellArg).join(' ');
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
 * Result of parsing volume mounts
 */
export interface ParseVolumeMountsResult {
  success: true;
  mounts: string[];
}

export interface ParseVolumeMountsError {
  success: false;
  invalidMount: string;
  reason: string;
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

/**
 * Parses and validates volume mount specifications
 * @param mounts Array of volume mount strings in host_path:container_path[:mode] format
 * @returns ParseVolumeMountsResult on success, or ParseVolumeMountsError with details on failure
 */
export function parseVolumeMounts(mounts: string[]): ParseVolumeMountsResult | ParseVolumeMountsError {
  const result: string[] = [];

  for (const mount of mounts) {
    // Parse mount specification: host_path:container_path[:mode]
    const parts = mount.split(':');

    if (parts.length < 2 || parts.length > 3) {
      return {
        success: false,
        invalidMount: mount,
        reason: 'Mount must be in format host_path:container_path[:mode]'
      };
    }

    const [hostPath, containerPath, mode] = parts;

    // Validate host path is not empty
    if (!hostPath || hostPath.trim() === '') {
      return {
        success: false,
        invalidMount: mount,
        reason: 'Host path cannot be empty'
      };
    }

    // Validate container path is not empty
    if (!containerPath || containerPath.trim() === '') {
      return {
        success: false,
        invalidMount: mount,
        reason: 'Container path cannot be empty'
      };
    }

    // Validate host path is absolute
    if (!hostPath.startsWith('/')) {
      return {
        success: false,
        invalidMount: mount,
        reason: 'Host path must be absolute (start with /)'
      };
    }

    // Validate container path is absolute
    if (!containerPath.startsWith('/')) {
      return {
        success: false,
        invalidMount: mount,
        reason: 'Container path must be absolute (start with /)'
      };
    }

    // Validate mode if specified
    if (mode && mode !== 'ro' && mode !== 'rw') {
      return {
        success: false,
        invalidMount: mount,
        reason: 'Mount mode must be either "ro" or "rw"'
      };
    }

    // Validate host path exists
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const fs = require('fs');
      if (!fs.existsSync(hostPath)) {
        return {
          success: false,
          invalidMount: mount,
          reason: `Host path does not exist: ${hostPath}`
        };
      }
    } catch (error) {
      return {
        success: false,
        invalidMount: mount,
        reason: `Failed to check host path: ${error}`
      };
    }

    // Add to result list
    result.push(mount);
  }

  return { success: true, mounts: result };
}

const program = new Command();

program
  .name('awf')
  .description('Network firewall for agentic workflows with domain whitelisting')
  .version('0.1.0')
  .option(
    '--allow-domains <domains>',
    'Comma-separated list of allowed domains (e.g., github.com,api.github.com)'
  )
  .option(
    '--allow-domains-file <path>',
    'Path to file containing allowed domains (one per line or comma-separated, supports # comments)'
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
  .option(
    '-v, --mount <host_path:container_path[:mode]>',
    'Volume mount (can be specified multiple times). Format: host_path:container_path[:ro|rw]',
    (value, previous: string[] = []) => [...previous, value],
    []
  )
  .option(
    '--container-workdir <dir>',
    'Working directory inside the container (should match GITHUB_WORKSPACE for path consistency)'
  )
  .argument('[args...]', 'Command and arguments to execute (use -- to separate from options)')
  .action(async (args: string[], options) => {
    // Require -- separator for passing command arguments
    if (args.length === 0) {
      console.error('Error: No command specified. Use -- to separate command from options.');
      console.error('Example: awf --allow-domains github.com -- curl https://api.github.com');
      process.exit(1);
    }
    
    // Join arguments with proper shell escaping to preserve argument boundaries
    const copilotCommand = joinShellArgs(args);
    // Parse and validate options
    const logLevel = options.logLevel as LogLevel;
    if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
      console.error(`Invalid log level: ${logLevel}`);
      process.exit(1);
    }

    logger.setLevel(logLevel);

    // Parse domains from both --allow-domains flag and --allow-domains-file
    let allowedDomains: string[] = [];

    // Parse domains from command-line flag if provided
    if (options.allowDomains) {
      allowedDomains = parseDomains(options.allowDomains);
    }

    // Parse domains from file if provided
    if (options.allowDomainsFile) {
      try {
        const fileDomainsArray = parseDomainsFile(options.allowDomainsFile);
        allowedDomains.push(...fileDomainsArray);
      } catch (error) {
        logger.error(`Failed to read domains file: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    }

    // Ensure at least one domain is specified
    if (allowedDomains.length === 0) {
      logger.error('At least one domain must be specified with --allow-domains or --allow-domains-file');
      process.exit(1);
    }

    // Remove duplicates (in case domains appear in both sources)
    allowedDomains = [...new Set(allowedDomains)];

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

    // Parse and validate volume mounts from --mount flags
    let volumeMounts: string[] | undefined = undefined;
    if (options.mount && Array.isArray(options.mount) && options.mount.length > 0) {
      const parsed = parseVolumeMounts(options.mount);
      if (!parsed.success) {
        logger.error(`Invalid volume mount: ${parsed.invalidMount}`);
        logger.error(`Reason: ${parsed.reason}`);
        process.exit(1);
      }
      volumeMounts = parsed.mounts;
      logger.debug(`Parsed ${volumeMounts.length} volume mount(s)`);
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
      volumeMounts,
      containerWorkDir: options.containerWorkdir,
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
