#!/usr/bin/env node

import { Command } from 'commander';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { isIPv6 } from 'net';
import { WrapperConfig, LogLevel } from './types';
import { logger } from './logger';
import {
  writeConfigs,
  startContainers,
  runAgentCommand,
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
import { validateDomainOrPattern } from './domain-patterns';
import { OutputFormat } from './types';
import { version } from '../package.json';

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
 * Default DNS servers (Google Public DNS)
 */
export const DEFAULT_DNS_SERVERS = ['8.8.8.8', '8.8.4.4'];

/**
 * Validates that a string is a valid IPv4 address
 * @param ip - String to validate
 * @returns true if the string is a valid IPv4 address
 */
export function isValidIPv4(ip: string): boolean {
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
  return ipv4Regex.test(ip);
}

/**
 * Validates that a string is a valid IPv6 address using Node.js built-in net module
 * @param ip - String to validate
 * @returns true if the string is a valid IPv6 address
 */
export function isValidIPv6(ip: string): boolean {
  return isIPv6(ip);
}

/**
 * Parses and validates DNS servers from a comma-separated string
 * @param input - Comma-separated DNS server string (e.g., "8.8.8.8,1.1.1.1")
 * @returns Array of validated DNS server IP addresses
 * @throws Error if any IP address is invalid or if the list is empty
 */
export function parseDnsServers(input: string): string[] {
  const servers = input
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (servers.length === 0) {
    throw new Error('At least one DNS server must be specified');
  }

  for (const server of servers) {
    if (!isValidIPv4(server) && !isValidIPv6(server)) {
      throw new Error(`Invalid DNS server IP address: ${server}`);
    }
  }

  return servers;
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
  .version(version)
  .option(
    '--allow-domains <domains>',
    'Comma-separated list of allowed domains. Supports wildcards and protocol prefixes:\n' +
    '                                   github.com         - exact domain + subdomains (HTTP & HTTPS)\n' +
    '                                   *.github.com       - any subdomain of github.com\n' +
    '                                   api-*.example.com  - api-* subdomains\n' +
    '                                   https://secure.com - HTTPS only\n' +
    '                                   http://legacy.com  - HTTP only'
  )
  .option(
    '--allow-domains-file <path>',
    'Path to file containing allowed domains (one per line or comma-separated, supports # comments)'
  )
  .option(
    '--block-domains <domains>',
    'Comma-separated list of blocked domains (takes precedence over allowed domains). Supports wildcards.'
  )
  .option(
    '--block-domains-file <path>',
    'Path to file containing blocked domains (one per line or comma-separated, supports # comments)'
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
    '--tty',
    'Allocate a pseudo-TTY for the container (required for interactive tools like Claude Code)',
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
    'Pass all host environment variables to container (excludes system vars like PATH)',
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
  .option(
    '--dns-servers <servers>',
    'Comma-separated list of trusted DNS servers. DNS traffic is ONLY allowed to these servers (default: 8.8.8.8,8.8.4.4)',
    '8.8.8.8,8.8.4.4'
  )
  .option(
    '--proxy-logs-dir <path>',
    'Directory to save Squid proxy logs to (writes access.log directly to this directory)'
  )
  .option(
    '--enable-host-access',
    'Enable access to host services via host.docker.internal. ' +
    'Security warning: When combined with --allow-domains host.docker.internal, ' +
    'containers can access ANY service on the host machine.',
    false
  )
  .option(
    '--allow-host-ports <ports>',
    'Comma-separated list of ports or port ranges to allow when using --enable-host-access. ' +
    'By default, only ports 80 and 443 are allowed. ' +
    'Example: --allow-host-ports 3000 or --allow-host-ports 3000,8080 or --allow-host-ports 3000-3010,8000-8090'
  )
  .option(
    '--ssl-bump',
    'Enable SSL Bump for HTTPS content inspection (allows URL path filtering for HTTPS)',
    false
  )
  .option(
    '--allow-urls <urls>',
    'Comma-separated list of allowed URL patterns for HTTPS (requires --ssl-bump).\n' +
    '                                   Supports wildcards: https://github.com/githubnext/*'
  )
  .argument('[args...]', 'Command and arguments to execute (use -- to separate from options)')
  .action(async (args: string[], options) => {
    // Require -- separator for passing command arguments
    if (args.length === 0) {
      console.error('Error: No command specified. Use -- to separate command from options.');
      console.error('Example: awf --allow-domains github.com -- curl https://api.github.com');
      process.exit(1);
    }

    // Command argument handling:
    //
    // SINGLE ARGUMENT (complete shell command):
    //   When a single argument is passed, it's treated as a complete shell
    //   command string. This is CRITICAL for preserving shell variables ($HOME,
    //   $(command), etc.) that must expand in the container, not on the host.
    //
    //   Example: awf -- 'echo $HOME'
    //   → args = ['echo $HOME']  (single element)
    //   → Passed as-is: 'echo $HOME'
    //   → Docker Compose: 'echo $$HOME' (escaped for YAML)
    //   → Container shell: 'echo $HOME' (expands to container home)
    //
    // MULTIPLE ARGUMENTS (shell-parsed by user's shell):
    //   When multiple arguments are passed, each is shell-escaped and joined.
    //   This happens when the user doesn't quote the command.
    //
    //   Example: awf -- curl -H "Auth: token" https://api.github.com
    //   → args = ['curl', '-H', 'Auth: token', 'https://api.github.com']
    //   → joinShellArgs(): curl -H 'Auth: token' https://api.github.com
    //
    // Why not use shell-quote library?
    // - shell-quote expands variables on the HOST ($HOME → /home/hostuser)
    // - We need variables to expand in CONTAINER ($HOME → /root or /home/runner)
    // - The $$$$  escaping pattern requires literal $ preservation
    //
    const agentCommand = args.length === 1 ? args[0] : joinShellArgs(args);
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

    // Validate all domains and patterns
    for (const domain of allowedDomains) {
      try {
        validateDomainOrPattern(domain);
      } catch (error) {
        logger.error(`Invalid domain or pattern: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    }

    // Parse blocked domains from both --block-domains flag and --block-domains-file
    let blockedDomains: string[] = [];

    // Parse blocked domains from command-line flag if provided
    if (options.blockDomains) {
      blockedDomains = parseDomains(options.blockDomains);
    }

    // Parse blocked domains from file if provided
    if (options.blockDomainsFile) {
      try {
        const fileBlockedDomainsArray = parseDomainsFile(options.blockDomainsFile);
        blockedDomains.push(...fileBlockedDomainsArray);
      } catch (error) {
        logger.error(`Failed to read blocked domains file: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    }

    // Remove duplicates from blocked domains
    blockedDomains = [...new Set(blockedDomains)];

    // Validate all blocked domains and patterns
    for (const domain of blockedDomains) {
      try {
        validateDomainOrPattern(domain);
      } catch (error) {
        logger.error(`Invalid blocked domain or pattern: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
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

    // Parse and validate DNS servers
    let dnsServers: string[];
    try {
      dnsServers = parseDnsServers(options.dnsServers);
    } catch (error) {
      logger.error(`Invalid DNS servers: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }

    // Parse --allow-urls for SSL Bump mode
    let allowedUrls: string[] | undefined;
    if (options.allowUrls) {
      allowedUrls = parseDomains(options.allowUrls);
      if (allowedUrls.length > 0 && !options.sslBump) {
        logger.error('--allow-urls requires --ssl-bump to be enabled');
        process.exit(1);
      }

      // Validate URL patterns for security
      for (const url of allowedUrls) {
        // URL patterns must start with https://
        if (!url.startsWith('https://')) {
          logger.error(`URL patterns must start with https:// (got: ${url})`);
          logger.error('Use --allow-domains for domain-level filtering without SSL Bump');
          process.exit(1);
        }

        // Reject overly broad patterns that would bypass security
        const dangerousPatterns = [
          /^https:\/\/\*$/,           // https://*
          /^https:\/\/\*\.\*$/,       // https://*.*
          /^https:\/\/\.\*$/,         // https://.*
          /^\.\*$/,                   // .*
          /^\*$/,                     // *
          /^https:\/\/[^/]*\*[^/]*$/, // https://*anything* without path
        ];

        for (const pattern of dangerousPatterns) {
          if (pattern.test(url)) {
            logger.error(`URL pattern "${url}" is too broad and would bypass security controls`);
            logger.error('URL patterns must include a specific domain and path, e.g., https://github.com/org/*');
            process.exit(1);
          }
        }

        // Ensure pattern has a path component (not just domain)
        const urlWithoutScheme = url.replace(/^https:\/\//, '');
        if (!urlWithoutScheme.includes('/')) {
          logger.error(`URL pattern "${url}" must include a path component`);
          logger.error('For domain-only filtering, use --allow-domains instead');
          logger.error('Example: https://github.com/githubnext/* (includes path)');
          process.exit(1);
        }
      }
    }

    // Validate SSL Bump option
    if (options.sslBump) {
      logger.info('SSL Bump mode enabled - HTTPS content inspection will be performed');
      logger.warn('⚠️  SSL Bump intercepts HTTPS traffic. Only use for trusted workloads.');
    }

    const config: WrapperConfig = {
      allowedDomains,
      blockedDomains: blockedDomains.length > 0 ? blockedDomains : undefined,
      agentCommand,
      logLevel,
      keepContainers: options.keepContainers,
      tty: options.tty || false,
      workDir: options.workDir,
      buildLocal: options.buildLocal,
      imageRegistry: options.imageRegistry,
      imageTag: options.imageTag,
      additionalEnv: Object.keys(additionalEnv).length > 0 ? additionalEnv : undefined,
      envAll: options.envAll,
      volumeMounts,
      containerWorkDir: options.containerWorkdir,
      dnsServers,
      proxyLogsDir: options.proxyLogsDir,
      enableHostAccess: options.enableHostAccess,
      allowHostPorts: options.allowHostPorts,
      sslBump: options.sslBump,
      allowedUrls,
    };

    // Warn if --env-all is used
    if (config.envAll) {
      logger.warn('⚠️  Using --env-all: All host environment variables will be passed to container');
      logger.warn('   This may expose sensitive credentials if logs or configs are shared');
    }

    // Warn if --allow-host-ports is used without --enable-host-access
    if (config.allowHostPorts && !config.enableHostAccess) {
      logger.error('❌ --allow-host-ports requires --enable-host-access to be set');
      process.exit(1);
    }

    // Warn if --enable-host-access is used with host.docker.internal in allowed domains
    if (config.enableHostAccess) {
      const hasHostDomain = allowedDomains.some(d =>
        d === 'host.docker.internal' || d.endsWith('.host.docker.internal')
      );
      if (hasHostDomain) {
        logger.warn('⚠️  Host access enabled with host.docker.internal in allowed domains');
        logger.warn('   Containers can access ANY service running on the host machine');
        logger.warn('   Only use this for trusted workloads (e.g., MCP gateways)');
      }
    }

    // Log config with redacted secrets
    const redactedConfig = {
      ...config,
      agentCommand: redactSecrets(config.agentCommand),
    };
    logger.debug('Configuration:', JSON.stringify(redactedConfig, null, 2));
    logger.info(`Allowed domains: ${allowedDomains.join(', ')}`);
    if (blockedDomains.length > 0) {
      logger.info(`Blocked domains: ${blockedDomains.join(', ')}`);
    }
    logger.debug(`DNS servers: ${dnsServers.join(', ')}`);

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
        await cleanup(config.workDir, false, config.proxyLogsDir);
        // Note: We don't remove the firewall network here since it can be reused
        // across multiple runs. Cleanup script will handle removal if needed.
      } else {
        logger.info(`Configuration files preserved at: ${config.workDir}`);
        logger.info(`Agent logs available at: ${config.workDir}/agent-logs/`);
        logger.info(`Squid logs available at: ${config.workDir}/squid-logs/`);
        logger.info(`Host iptables rules preserved (--keep-containers enabled)`);
      }
    };

    // Register signal handlers
    process.on('SIGINT', async () => {
      await performCleanup('SIGINT');
      console.error(`Process exiting with code: 130`);
      process.exit(130); // Standard exit code for SIGINT
    });

    process.on('SIGTERM', async () => {
      await performCleanup('SIGTERM');
      console.error(`Process exiting with code: 143`);
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
          runAgentCommand,
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

      console.error(`Process exiting with code: ${exitCode}`);
      process.exit(exitCode);
    } catch (error) {
      logger.error('Fatal error:', error);
      await performCleanup();
      console.error(`Process exiting with code: 1`);
      process.exit(1);
    }
  });

/**
 * Validates that a format string is one of the allowed values
 * 
 * @param format - Format string to validate
 * @param validFormats - Array of valid format options
 * @throws Exits process with error if format is invalid
 */
function validateFormat(format: string, validFormats: string[]): void {
  if (!validFormats.includes(format)) {
    logger.error(`Invalid format: ${format}. Must be one of: ${validFormats.join(', ')}`);
    process.exit(1);
  }
}

// Logs subcommand - view Squid proxy logs
const logsCmd = program
  .command('logs')
  .description('View and analyze Squid proxy logs from current or previous runs')
  .option('-f, --follow', 'Follow log output in real-time (like tail -f)', false)
  .option(
    '--format <format>',
    'Output format: raw (as-is), pretty (colorized), json (structured)',
    'pretty'
  )
  .option('--source <path>', 'Path to log directory or "running" for live container')
  .option('--list', 'List available log sources', false)
  .option(
    '--with-pid',
    'Enrich logs with PID/process info (real-time only, requires -f)',
    false
  )
  .action(async (options) => {
    // Validate format option
    const validFormats: OutputFormat[] = ['raw', 'pretty', 'json'];
    validateFormat(options.format, validFormats);

    // Warn if --with-pid is used without -f
    if (options.withPid && !options.follow) {
      logger.warn('--with-pid only works with real-time streaming (-f). PID tracking disabled.');
    }

    // Dynamic import to avoid circular dependencies
    const { logsCommand } = await import('./commands/logs');
    await logsCommand({
      follow: options.follow,
      format: options.format as OutputFormat,
      source: options.source,
      list: options.list,
      withPid: options.withPid && options.follow, // Only enable if also following
    });
  });

// Logs stats subcommand - show aggregated statistics
logsCmd
  .command('stats')
  .description('Show aggregated statistics from firewall logs')
  .option(
    '--format <format>',
    'Output format: json, markdown, pretty',
    'pretty'
  )
  .option('--source <path>', 'Path to log directory or "running" for live container')
  .action(async (options) => {
    // Validate format option
    const validFormats = ['json', 'markdown', 'pretty'];
    if (!validFormats.includes(options.format)) {
      logger.error(`Invalid format: ${options.format}. Must be one of: ${validFormats.join(', ')}`);
      process.exit(1);
    }

    const { statsCommand } = await import('./commands/logs-stats');
    await statsCommand({
      format: options.format as 'json' | 'markdown' | 'pretty',
      source: options.source,
    });
  });

// Logs summary subcommand - generate summary report (optimized for GitHub Actions)
logsCmd
  .command('summary')
  .description('Generate summary report (defaults to markdown for GitHub Actions)')
  .option(
    '--format <format>',
    'Output format: json, markdown, pretty',
    'markdown'
  )
  .option('--source <path>', 'Path to log directory or "running" for live container')
  .action(async (options) => {
    // Validate format option
    const validFormats = ['json', 'markdown', 'pretty'];
    validateFormat(options.format, validFormats);

    const { summaryCommand } = await import('./commands/logs-summary');
    await summaryCommand({
      format: options.format as 'json' | 'markdown' | 'pretty',
      source: options.source,
    });
  });

// Only parse arguments if this file is run directly (not imported as a module)
if (require.main === module) {
  program.parse();
}
