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

const program = new Command();

program
  .name('firewall-wrapper')
  .description('Firewall wrapper for GitHub Copilot CLI with L7 egress control')
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
    path.join(os.tmpdir(), `firewall-wrapper-${Date.now()}`)
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

    const allowedDomains = options.allowDomains
      .split(',')
      .map((d: string) => d.trim())
      .filter((d: string) => d.length > 0);

    if (allowedDomains.length === 0) {
      logger.error('At least one domain must be specified with --allow-domains');
      process.exit(1);
    }

    const config: WrapperConfig = {
      allowedDomains,
      copilotCommand,
      logLevel,
      keepContainers: options.keepContainers,
      workDir: options.workDir,
    };

    logger.debug('Configuration:', JSON.stringify(config, null, 2));
    logger.info(`Allowed domains: ${allowedDomains.join(', ')}`);

    let exitCode = 0;
    let containersStarted = false;

    // Handle cleanup on process exit
    const performCleanup = async (signal?: string) => {
      if (signal) {
        logger.info(`Received ${signal}, cleaning up...`);
      }

      if (containersStarted) {
        await stopContainers(config.workDir, config.keepContainers);
      }

      if (!config.keepContainers) {
        await cleanup(config.workDir, false);
      } else {
        logger.info(`Configuration files preserved at: ${config.workDir}`);
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
      // Step 1: Write configuration files
      logger.info('Generating configuration files...');
      await writeConfigs(config);

      // Step 2: Start containers
      await startContainers(config.workDir);
      containersStarted = true;

      // Step 3: Wait for copilot to complete
      exitCode = await runCopilotCommand(config.workDir);

      // Step 4: Cleanup
      await performCleanup();

      logger.success(`Command completed with exit code: ${exitCode}`);
      process.exit(exitCode);
    } catch (error) {
      logger.error('Fatal error:', error);
      await performCleanup();
      process.exit(1);
    }
  });

program.parse();
