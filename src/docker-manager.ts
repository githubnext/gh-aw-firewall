import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import execa from 'execa';
import { DockerComposeConfig, WrapperConfig, BlockedTarget } from './types';
import { logger } from './logger';
import { generateSquidConfig } from './squid-config';

const SQUID_PORT = 3128;

/**
 * Gets existing Docker network subnets to avoid conflicts
 */
async function getExistingDockerSubnets(): Promise<string[]> {
  try {
    // Get all network IDs
    const { stdout: networkIds } = await execa('docker', ['network', 'ls', '-q']);
    if (!networkIds.trim()) {
      return [];
    }

    // Get subnet information for each network
    const { stdout } = await execa('docker', [
      'network',
      'inspect',
      '--format={{range .IPAM.Config}}{{.Subnet}} {{end}}',
      ...networkIds.trim().split('\n'),
    ]);

    // Parse subnets from output (format: "172.17.0.0/16 172.18.0.0/16 ")
    const subnets = stdout
      .split(/\s+/)
      .filter((s) => s.includes('/'))
      .map((s) => s.trim());

    logger.debug(`Found existing Docker subnets: ${subnets.join(', ')}`);
    return subnets;
  } catch {
    logger.debug('Failed to query Docker networks, proceeding with random subnet');
    return [];
  }
}

/**
 * Checks if two subnets overlap
 * Returns true if the new subnet conflicts with an existing subnet
 */
export function subnetsOverlap(subnet1: string, subnet2: string): boolean {
  // Parse CIDR notation: "172.17.0.0/16" -> ["172.17.0.0", "16"]
  const [ip1, cidr1] = subnet1.split('/');
  const [ip2, cidr2] = subnet2.split('/');

  // Convert IP to number
  const ipToNumber = (ip: string): number => {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
  };

  // Calculate network address and broadcast address for a subnet
  const getNetworkRange = (ip: string, cidr: string): [number, number] => {
    const ipNum = ipToNumber(ip);
    const maskBits = parseInt(cidr, 10);
    const mask = (0xffffffff << (32 - maskBits)) >>> 0;
    const networkAddr = (ipNum & mask) >>> 0;
    const broadcastAddr = (networkAddr | ~mask) >>> 0;
    return [networkAddr, broadcastAddr];
  };

  const [start1, end1] = getNetworkRange(ip1, cidr1);
  const [start2, end2] = getNetworkRange(ip2, cidr2);

  // Check if ranges overlap
  return (start1 <= end2 && end1 >= start2);
}

/**
 * Generates a random subnet in Docker's private IP range that doesn't conflict with existing networks
 * Uses 172.16-31.x.0/24 range (Docker's default bridge network range)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _generateRandomSubnet(): Promise<{ subnet: string; squidIp: string; copilotIp: string }> {
  const existingSubnets = await getExistingDockerSubnets();
  const MAX_RETRIES = 50;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Use 172.16-31.x.0/24 range
    const secondOctet = Math.floor(Math.random() * 16) + 16; // 16-31
    const thirdOctet = Math.floor(Math.random() * 256); // 0-255
    const subnet = `172.${secondOctet}.${thirdOctet}.0/24`;

    // Check for conflicts with existing subnets
    const hasConflict = existingSubnets.some((existingSubnet) =>
      subnetsOverlap(subnet, existingSubnet)
    );

    if (!hasConflict) {
      const squidIp = `172.${secondOctet}.${thirdOctet}.10`;
      const copilotIp = `172.${secondOctet}.${thirdOctet}.20`;
      return { subnet, squidIp, copilotIp };
    }

    logger.debug(`Subnet ${subnet} conflicts with existing network, retrying... (attempt ${attempt + 1}/${MAX_RETRIES})`);
  }

  throw new Error(
    `Failed to generate non-conflicting subnet after ${MAX_RETRIES} attempts. ` +
    `Existing subnets: ${existingSubnets.join(', ')}`
  );
}

/**
 * Generates Docker Compose configuration
 * Note: Uses external network 'awf-net' created by host-iptables setup
 */
export function generateDockerCompose(
  config: WrapperConfig,
  networkConfig: { subnet: string; squidIp: string; copilotIp: string }
): DockerComposeConfig {
  const projectRoot = path.join(__dirname, '..');

  // Default to GHCR images unless buildLocal is explicitly set
  const useGHCR = !config.buildLocal;
  const registry = config.imageRegistry || 'ghcr.io/githubnext/gh-aw-firewall';
  const tag = config.imageTag || 'latest';

  // Squid service configuration
  const squidService: any = {
    container_name: 'awf-squid',
    networks: {
      'awf-net': {
        ipv4_address: networkConfig.squidIp,
      },
    },
    volumes: [
      `${config.workDir}/squid.conf:/etc/squid/squid.conf:ro`,
      `${config.workDir}/squid-logs:/var/log/squid:rw`,
    ],
    healthcheck: {
      test: ['CMD', 'nc', '-z', 'localhost', '3128'],
      interval: '5s',
      timeout: '3s',
      retries: 5,
      start_period: '10s',
    },
    ports: [`${SQUID_PORT}:${SQUID_PORT}`],
  };

  // Use GHCR image or build locally
  if (useGHCR) {
    squidService.image = `${registry}/squid:${tag}`;
  } else {
    squidService.build = {
      context: path.join(projectRoot, 'containers/squid'),
      dockerfile: 'Dockerfile',
    };
  }

  // Build environment variables for copilot container
  // System variables that must be overridden or excluded (would break container operation)
  const EXCLUDED_ENV_VARS = new Set([
    'PATH',           // Must use container's PATH
    'DOCKER_HOST',    // Must use container's socket path
    'DOCKER_CONTEXT', // Must use default context
    'DOCKER_CONFIG',  // Must use clean config
    'PWD',            // Container's working directory
    'OLDPWD',         // Not relevant in container
    'SHLVL',          // Shell level not relevant
    '_',              // Last command executed
    'SUDO_COMMAND',   // Sudo metadata
    'SUDO_USER',      // Sudo metadata
    'SUDO_UID',       // Sudo metadata
    'SUDO_GID',       // Sudo metadata
  ]);

  // Start with required/overridden environment variables
  const environment: Record<string, string> = {
    HTTP_PROXY: `http://${networkConfig.squidIp}:${SQUID_PORT}`,
    HTTPS_PROXY: `http://${networkConfig.squidIp}:${SQUID_PORT}`,
    SQUID_PROXY_HOST: 'squid-proxy',
    SQUID_PROXY_PORT: SQUID_PORT.toString(),
    HOME: process.env.HOME || '/root',
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    DOCKER_HOST: 'unix:///var/run/docker.sock',
    DOCKER_CONTEXT: 'default',
  };

  // If --env-all is specified, pass through all host environment variables (except excluded ones)
  if (config.envAll) {
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && !EXCLUDED_ENV_VARS.has(key) && !Object.prototype.hasOwnProperty.call(environment, key)) {
        environment[key] = value;
      }
    }
  } else {
    // Default behavior: selectively pass through specific variables
    if (process.env.GITHUB_TOKEN) environment.GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    if (process.env.GH_TOKEN) environment.GH_TOKEN = process.env.GH_TOKEN;
    if (process.env.GITHUB_PERSONAL_ACCESS_TOKEN) environment.GITHUB_PERSONAL_ACCESS_TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    // Anthropic API key for Claude Code
    if (process.env.ANTHROPIC_API_KEY) environment.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (process.env.USER) environment.USER = process.env.USER;
    if (process.env.TERM) environment.TERM = process.env.TERM;
    if (process.env.XDG_CONFIG_HOME) environment.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME;
  }

  // Additional environment variables from --env flags (these override everything)
  if (config.additionalEnv) {
    Object.assign(environment, config.additionalEnv);
  }

  // Build volumes list for copilot container
  const copilotVolumes: string[] = [
    // Essential mounts that are always included
    '/tmp:/tmp:rw',
    `${process.env.HOME}:${process.env.HOME}:rw`,
    // Mount Docker socket for MCP servers that need to run containers
    '/var/run/docker.sock:/var/run/docker.sock:rw',
    // Mount clean Docker config to override host's context
    `${config.workDir}/.docker:/workspace/.docker:rw`,
    // Override host's .docker directory with clean config to prevent Docker CLI
    // from reading host's context (e.g., desktop-linux pointing to wrong socket)
    `${config.workDir}/.docker:${process.env.HOME}/.docker:rw`,
    // Mount copilot logs directory to workDir for persistence
    `${config.workDir}/copilot-logs:${process.env.HOME}/.copilot/logs:rw`,
  ];

  // Add custom volume mounts if specified
  if (config.volumeMounts && config.volumeMounts.length > 0) {
    logger.debug(`Adding ${config.volumeMounts.length} custom volume mount(s)`);
    config.volumeMounts.forEach(mount => {
      copilotVolumes.push(mount);
    });
  } else {
    // If no custom mounts specified, include blanket host filesystem mount for backward compatibility
    logger.debug('No custom mounts specified, using blanket /:/host:rw mount');
    copilotVolumes.unshift('/:/host:rw');
  }

  // Copilot service configuration
  const copilotService: any = {
    container_name: 'awf-copilot',
    networks: {
      'awf-net': {
        ipv4_address: networkConfig.copilotIp,
      },
    },
    dns: ['8.8.8.8', '8.8.4.4'], // Use Google DNS instead of Docker's embedded DNS
    dns_search: [], // Disable DNS search domains to prevent embedded DNS fallback
    volumes: copilotVolumes,
    environment,
    depends_on: {
      'squid-proxy': {
        condition: 'service_healthy',
      },
    },
    cap_add: ['NET_ADMIN'], // Required for iptables
    stdin_open: true,
    tty: config.tty || false, // Use --tty flag, default to false for clean logs
    // Escape $ with $$ for Docker Compose variable interpolation
    command: ['/bin/bash', '-c', config.copilotCommand.replace(/\$/g, '$$$$')],
  };

  // Set working directory if specified (overrides Dockerfile WORKDIR)
  if (config.containerWorkDir) {
    copilotService.working_dir = config.containerWorkDir;
    logger.debug(`Set container working directory to: ${config.containerWorkDir}`);
  }

  // Use GHCR image or build locally
  if (useGHCR) {
    copilotService.image = `${registry}/copilot:${tag}`;
  } else {
    copilotService.build = {
      context: path.join(projectRoot, 'containers/copilot'),
      dockerfile: 'Dockerfile',
    };
  }

  return {
    services: {
      'squid-proxy': squidService,
      'copilot': copilotService,
    },
    networks: {
      'awf-net': {
        external: true,
      },
    },
  };
}

/**
 * Writes configuration files to disk
 * Uses fixed network configuration (172.30.0.0/24) defined in host-iptables.ts
 */
export async function writeConfigs(config: WrapperConfig): Promise<void> {
  logger.debug('Writing configuration files...');

  // Ensure work directory exists
  if (!fs.existsSync(config.workDir)) {
    fs.mkdirSync(config.workDir, { recursive: true });
  }

  // Create a clean Docker config directory to prevent host's Docker context from being used
  // This is mounted into the container via DOCKER_CONFIG env var
  const dockerConfigDir = path.join(config.workDir, '.docker');
  if (!fs.existsSync(dockerConfigDir)) {
    fs.mkdirSync(dockerConfigDir, { recursive: true });
  }

  // Write a minimal Docker config that uses default context (no custom socket paths)
  const dockerConfig = {
    currentContext: 'default',
  };
  fs.writeFileSync(
    path.join(dockerConfigDir, 'config.json'),
    JSON.stringify(dockerConfig, null, 2)
  );
  logger.debug(`Docker config written to: ${dockerConfigDir}/config.json`);

  // Create copilot logs directory for persistence
  const copilotLogsDir = path.join(config.workDir, 'copilot-logs');
  if (!fs.existsSync(copilotLogsDir)) {
    fs.mkdirSync(copilotLogsDir, { recursive: true });
  }
  logger.debug(`Copilot logs directory created at: ${copilotLogsDir}`);

  // Create squid logs directory for persistence
  // Note: Squid runs as user 'proxy' (UID 13, GID 13 in ubuntu/squid image)
  // We need to make the directory writable by the proxy user
  const squidLogsDir = path.join(config.workDir, 'squid-logs');
  if (!fs.existsSync(squidLogsDir)) {
    fs.mkdirSync(squidLogsDir, { recursive: true, mode: 0o777 });
  }
  logger.debug(`Squid logs directory created at: ${squidLogsDir}`);

  // Use fixed network configuration (network is created by host-iptables.ts)
  const networkConfig = {
    subnet: '172.30.0.0/24',
    squidIp: '172.30.0.10',
    copilotIp: '172.30.0.20',
  };
  logger.debug(`Using network config: ${networkConfig.subnet} (squid: ${networkConfig.squidIp}, copilot: ${networkConfig.copilotIp})`);

  // Write Squid config
  const squidConfig = generateSquidConfig({
    domains: config.allowedDomains,
    port: SQUID_PORT,
  });
  const squidConfigPath = path.join(config.workDir, 'squid.conf');
  fs.writeFileSync(squidConfigPath, squidConfig);
  logger.debug(`Squid config written to: ${squidConfigPath}`);

  // Write Docker Compose config
  const dockerCompose = generateDockerCompose(config, networkConfig);
  const dockerComposePath = path.join(config.workDir, 'docker-compose.yml');
  fs.writeFileSync(dockerComposePath, yaml.dump(dockerCompose));
  logger.debug(`Docker Compose config written to: ${dockerComposePath}`);
}

/**
 * Checks Squid logs for access denials to provide better error context
 */
async function checkSquidLogs(workDir: string): Promise<{ hasDenials: boolean; blockedTargets: BlockedTarget[] }> {
  try {
    // Read from the access.log file (Squid doesn't write access logs to stdout)
    const accessLogPath = path.join(workDir, 'squid-logs', 'access.log');
    let logContent = '';

    if (fs.existsSync(accessLogPath)) {
      logContent = fs.readFileSync(accessLogPath, 'utf-8');
    } else {
      logger.debug(`Squid access log not found at: ${accessLogPath}`);
      return { hasDenials: false, blockedTargets: [] };
    }

    const blockedTargets: BlockedTarget[] = [];
    const seenTargets = new Set<string>();
    const lines = logContent.split('\n');

    for (const line of lines) {
      // Look for TCP_DENIED entries in Squid logs
      // Format: timestamp IP domain:port dest:port version method status TCP_DENIED:HIER_NONE domain:port "user-agent"
      if (line.includes('TCP_DENIED')) {
        // Extract the domain:port which appears after the method
        // Example: "1760994429.358 172.30.0.20:36274 github.com:8443 -:- 1.1 CONNECT 403 TCP_DENIED:HIER_NONE github.com:8443 "curl/7.81.0""
        const match = line.match(/(?:GET|POST|CONNECT|PUT|DELETE|HEAD)\s+\d+\s+TCP_DENIED:\S+\s+([^\s]+)/);
        if (match && match[1]) {
          const target = match[1]; // Full target with port (e.g., "github.com:8443")

          if (!seenTargets.has(target)) {
            seenTargets.add(target);

            // Parse domain and port
            const colonIndex = target.lastIndexOf(':');
            let domain: string;
            let port: string | undefined;

            if (colonIndex !== -1) {
              domain = target.substring(0, colonIndex);
              port = target.substring(colonIndex + 1);

              // Validate that port is actually a number (to handle IPv6 addresses correctly)
              if (!/^\d+$/.test(port)) {
                domain = target;
                port = undefined;
              }
            } else {
              domain = target;
            }

            blockedTargets.push({ target, domain, port });
          }
        }
      }
    }
    return { hasDenials: blockedTargets.length > 0, blockedTargets };
  } catch (error) {
    logger.debug('Could not check Squid logs:', error);
    return { hasDenials: false, blockedTargets: [] };
  }
}

/**
 * Starts Docker Compose services
 */
export async function startContainers(workDir: string, allowedDomains: string[]): Promise<void> {
  logger.info('Starting containers...');

  // Force remove any existing containers with these names to avoid conflicts
  // This handles orphaned containers from failed/interrupted previous runs
  logger.debug('Removing any existing containers with conflicting names...');
  try {
    await execa('docker', ['rm', '-f', 'awf-squid', 'awf-copilot'], {
      reject: false,
    });
  } catch {
    // Ignore errors if containers don't exist
    logger.debug('No existing containers to remove (this is normal)');
  }

  try {
    await execa('docker', ['compose', 'up', '-d'], {
      cwd: workDir,
      stdio: 'inherit',
    });
    logger.success('Containers started successfully');
  } catch (error) {
    // Check if this is a healthcheck failure
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('is unhealthy') || errorMsg.includes('dependency failed')) {
      // Check Squid logs to see if it's actually working and blocking traffic
      const { hasDenials, blockedTargets } = await checkSquidLogs(workDir);

      if (hasDenials) {
        logger.error('Firewall blocked domains during startup:');

        const missingDomains: string[] = [];
        const portIssues: BlockedTarget[] = [];

        blockedTargets.forEach(blocked => {
          const isAllowed = allowedDomains.some(allowed =>
            blocked.domain === allowed || blocked.domain.endsWith('.' + allowed)
          );

          if (!isAllowed) {
            // Domain not in allowlist
            logger.error(`  - Blocked: ${blocked.target} (domain not in allowlist)`);
            missingDomains.push(blocked.domain);
          } else if (blocked.port && blocked.port !== '80' && blocked.port !== '443') {
            // Domain is allowed but port is not
            logger.error(`  - Blocked: ${blocked.target} (port ${blocked.port} not allowed, only 80 and 443 are permitted)`);
            portIssues.push(blocked);
          } else {
            // Other reason (shouldn't happen often)
            logger.error(`  - Blocked: ${blocked.target}`);
          }
        });

        logger.error('Allowed domains:');
        allowedDomains.forEach(domain => {
          logger.error(`  - Allowed: ${domain}`);
        });

        if (missingDomains.length > 0) {
          logger.error(`To fix domain issues: --allow-domains "${[...allowedDomains, ...missingDomains].join(',')}"`);
        }
        if (portIssues.length > 0) {
          logger.error('To fix port issues: Use standard ports 80 (HTTP) or 443 (HTTPS)');
        }

        // Create a more user-friendly error
        const blockedList = blockedTargets.map(b => `"${b.target}"`).join(', ');
        throw new Error(
          `Firewall blocked access to: ${blockedList}. ` +
          `Check error messages above for details.`
        );
      }
    }

    logger.error('Failed to start containers:', error);
    throw error;
  }
}

/**
 * Runs the copilot command in the container and reports any blocked domains
 */
export async function runCopilotCommand(workDir: string, allowedDomains: string[]): Promise<{ exitCode: number; blockedDomains: string[] }> {
  logger.info('Executing copilot command...');

  try {
    // Stream logs in real-time using docker logs -f (follow mode)
    // Run this in the background and wait for the container to exit separately
    const logsProcess = execa('docker', ['logs', '-f', 'awf-copilot'], {
      stdio: 'inherit',
      reject: false,
    });

    // Wait for the container to exit (this will run concurrently with log streaming)
    const { stdout: exitCodeStr } = await execa('docker', [
      'wait',
      'awf-copilot',
    ]);

    const exitCode = parseInt(exitCodeStr.trim(), 10);

    // Wait for the logs process to finish (it should exit automatically when container stops)
    await logsProcess;

    logger.debug(`Copilot exit code: ${exitCode}`);

    // Small delay to ensure Squid logs are flushed to disk
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check Squid logs to see if any domains were blocked (do this BEFORE cleanup)
    const { hasDenials, blockedTargets } = await checkSquidLogs(workDir);

    // If command failed (non-zero exit) and domains were blocked, show a warning
    if (exitCode !== 0 && hasDenials) {
      logger.warn('Firewall blocked domains:');

      const missingDomains: string[] = [];
      const portIssues: BlockedTarget[] = [];

      blockedTargets.forEach(blocked => {
        const isAllowed = allowedDomains.some(allowed =>
          blocked.domain === allowed || blocked.domain.endsWith('.' + allowed)
        );

        if (!isAllowed) {
          // Domain not in allowlist
          logger.warn(`  - Blocked: ${blocked.target} (domain not in allowlist)`);
          missingDomains.push(blocked.domain);
        } else if (blocked.port && blocked.port !== '80' && blocked.port !== '443') {
          // Domain is allowed but port is not
          logger.warn(`  - Blocked: ${blocked.target} (port ${blocked.port} not allowed, only 80 and 443 are permitted)`);
          portIssues.push(blocked);
        } else {
          // Other reason (shouldn't happen often)
          logger.warn(`  - Blocked: ${blocked.target}`);
        }
      });

      logger.warn('Allowed domains:');
      allowedDomains.forEach(domain => {
        logger.warn(`  - Allowed: ${domain}`);
      });

      if (missingDomains.length > 0) {
        logger.warn(`To fix domain issues: --allow-domains "${[...allowedDomains, ...missingDomains].join(',')}"`);
      }
      if (portIssues.length > 0) {
        logger.warn('To fix port issues: Use standard ports 80 (HTTP) or 443 (HTTPS)');
      }
    }

    return { exitCode, blockedDomains: blockedTargets.map(b => b.domain) };
  } catch (error) {
    logger.error('Failed to run copilot command:', error);
    throw error;
  }
}

/**
 * Stops and removes Docker Compose services
 */
export async function stopContainers(workDir: string, keepContainers: boolean): Promise<void> {
  if (keepContainers) {
    logger.info('Keeping containers running (--keep-containers enabled)');
    return;
  }

  logger.info('Stopping containers...');

  try {
    await execa('docker', ['compose', 'down', '-v'], {
      cwd: workDir,
      stdio: 'inherit',
    });
    logger.success('Containers stopped successfully');
  } catch (error) {
    logger.error('Failed to stop containers:', error);
    throw error;
  }
}

/**
 * Cleans up temporary files
 * Preserves copilot logs by moving them to a persistent location before cleanup
 */
export async function cleanup(workDir: string, keepFiles: boolean): Promise<void> {
  if (keepFiles) {
    logger.debug(`Keeping temporary files in: ${workDir}`);
    return;
  }

  logger.debug('Cleaning up temporary files...');
  try {
    if (fs.existsSync(workDir)) {
      const timestamp = path.basename(workDir).replace('awf-', '');

      // Preserve copilot logs before cleanup by moving them to /tmp
      const copilotLogsDir = path.join(workDir, 'copilot-logs');
      if (fs.existsSync(copilotLogsDir) && fs.readdirSync(copilotLogsDir).length > 0) {
        const preservedLogsDir = path.join(os.tmpdir(), `copilot-logs-${timestamp}`);
        try {
          fs.renameSync(copilotLogsDir, preservedLogsDir);
          logger.info(`Copilot logs preserved at: ${preservedLogsDir}`);
        } catch (error) {
          logger.debug('Could not preserve copilot logs:', error);
        }
      }

      // Preserve squid logs before cleanup by moving them to /tmp
      const squidLogsDir = path.join(workDir, 'squid-logs');
      if (fs.existsSync(squidLogsDir) && fs.readdirSync(squidLogsDir).length > 0) {
        const preservedSquidLogsDir = path.join(os.tmpdir(), `squid-logs-${timestamp}`);
        try {
          fs.renameSync(squidLogsDir, preservedSquidLogsDir);

          // Make logs readable by GitHub Actions runner for artifact upload
          // Squid creates logs as 'proxy' user (UID 13) which runner cannot read
          // chmod a+rX sets read for all users, and execute for dirs (capital X)
          execa.sync('chmod', ['-R', 'a+rX', preservedSquidLogsDir]);

          logger.info(`Squid logs preserved at: ${preservedSquidLogsDir}`);
        } catch (error) {
          logger.debug('Could not preserve squid logs:', error);
        }
      }

      // Clean up workDir
      fs.rmSync(workDir, { recursive: true, force: true });
      logger.debug('Temporary files cleaned up');
    }
  } catch (error) {
    logger.warn('Failed to clean up temporary files:', error);
  }
}
