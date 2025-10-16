import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import execa from 'execa';
import { DockerComposeConfig, WrapperConfig } from './types';
import { logger } from './logger';
import { generateSquidConfig } from './squid-config';

const SQUID_PORT = 3128;
const NETWORK_SUBNET = '172.30.0.0/24';
const SQUID_IP = '172.30.0.10';

/**
 * Generates Docker Compose configuration
 */
export function generateDockerCompose(config: WrapperConfig): DockerComposeConfig {
  const projectRoot = path.join(__dirname, '..');

  return {
    version: '3.8',
    services: {
      'squid-proxy': {
        build: {
          context: path.join(projectRoot, 'containers/squid'),
          dockerfile: 'Dockerfile',
        },
        container_name: 'firewall-wrapper-squid',
        networks: {
          'firewall-network': {
            ipv4_address: SQUID_IP,
          },
        },
        volumes: [
          `${config.workDir}/squid.conf:/etc/squid/squid.conf:ro`,
          'squid-logs:/var/log/squid',
        ],
        healthcheck: {
          test: ['CMD', 'nc', '-z', 'localhost', '3128'],
          interval: '5s',
          timeout: '3s',
          retries: 5,
          start_period: '10s',
        },
        ports: [`${SQUID_PORT}:${SQUID_PORT}`],
      },
      'copilot': {
        build: {
          context: path.join(projectRoot, 'containers/copilot'),
          dockerfile: 'Dockerfile',
        },
        container_name: 'firewall-wrapper-copilot',
        networks: {
          'firewall-network': {
            ipv4_address: '172.30.0.20',
          },
        },
        dns: ['8.8.8.8', '8.8.4.4'], // Use Google DNS instead of Docker's embedded DNS
        dns_search: [], // Disable DNS search domains to prevent embedded DNS fallback
        volumes: [
          // Mount host filesystem for copilot access
          '/:/host:rw',
          '/tmp:/tmp:rw',
          `${process.env.HOME}:${process.env.HOME}:rw`,
        ],
        environment: {
          HTTP_PROXY: `http://${SQUID_IP}:${SQUID_PORT}`,
          HTTPS_PROXY: `http://${SQUID_IP}:${SQUID_PORT}`,
          SQUID_PROXY_HOST: 'squid-proxy',
          SQUID_PROXY_PORT: SQUID_PORT.toString(),
          // Preserve important env vars
          HOME: process.env.HOME || '/root',
          PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        },
        depends_on: {
          'squid-proxy': {
            condition: 'service_healthy',
          },
        },
        cap_add: ['NET_ADMIN'], // Required for iptables
        stdin_open: true,
        tty: true,
        command: ['/bin/bash', '-c', config.copilotCommand],
      },
    },
    networks: {
      'firewall-network': {
        driver: 'bridge',
        ipam: {
          config: [{ subnet: NETWORK_SUBNET }],
        },
      },
    },
    volumes: {
      'squid-logs': {},
    },
  };
}

/**
 * Writes configuration files to disk
 */
export async function writeConfigs(config: WrapperConfig): Promise<void> {
  logger.debug('Writing configuration files...');

  // Ensure work directory exists
  if (!fs.existsSync(config.workDir)) {
    fs.mkdirSync(config.workDir, { recursive: true });
  }

  // Write Squid config
  const squidConfig = generateSquidConfig({
    domains: config.allowedDomains,
    port: SQUID_PORT,
  });
  const squidConfigPath = path.join(config.workDir, 'squid.conf');
  fs.writeFileSync(squidConfigPath, squidConfig);
  logger.debug(`Squid config written to: ${squidConfigPath}`);

  // Write Docker Compose config
  const dockerCompose = generateDockerCompose(config);
  const dockerComposePath = path.join(config.workDir, 'docker-compose.yml');
  fs.writeFileSync(dockerComposePath, yaml.dump(dockerCompose));
  logger.debug(`Docker Compose config written to: ${dockerComposePath}`);
}

/**
 * Starts Docker Compose services
 */
export async function startContainers(workDir: string): Promise<void> {
  logger.info('Starting containers...');

  try {
    await execa('docker', ['compose', 'up', '-d'], {
      cwd: workDir,
      stdio: 'inherit',
    });
    logger.success('Containers started successfully');
  } catch (error) {
    logger.error('Failed to start containers:', error);
    throw error;
  }
}

/**
 * Runs the copilot command in the container
 */
export async function runCopilotCommand(workDir: string): Promise<number> {
  logger.info('Executing copilot command...');

  try {
    await execa('docker', ['compose', 'logs', '-f', 'copilot'], {
      cwd: workDir,
      stdio: 'inherit',
      reject: false,
    });

    // Get exit code from copilot container
    const { stdout } = await execa('docker', [
      'inspect',
      'firewall-wrapper-copilot',
      '--format={{.State.ExitCode}}',
    ]);

    const exitCode = parseInt(stdout.trim(), 10);
    logger.debug(`Copilot exit code: ${exitCode}`);

    return exitCode;
  } catch (error) {
    logger.error('Failed to run copilot command:', error);
    throw error;
  }
}

/**
 * Stops and removes Docker Compose services
 */
export async function stopContainers(workDir: string, keepContainers: boolean): Promise<void> {
  logger.info('Stopping containers...');

  try {
    if (keepContainers) {
      await execa('docker', ['compose', 'stop'], {
        cwd: workDir,
        stdio: 'inherit',
      });
    } else {
      await execa('docker', ['compose', 'down', '-v'], {
        cwd: workDir,
        stdio: 'inherit',
      });
    }
    logger.success('Containers stopped successfully');
  } catch (error) {
    logger.error('Failed to stop containers:', error);
    throw error;
  }
}

/**
 * Cleans up temporary files
 */
export async function cleanup(workDir: string, keepFiles: boolean): Promise<void> {
  if (keepFiles) {
    logger.debug(`Keeping temporary files in: ${workDir}`);
    return;
  }

  logger.debug('Cleaning up temporary files...');
  try {
    if (fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
      logger.debug('Temporary files cleaned up');
    }
  } catch (error) {
    logger.warn('Failed to clean up temporary files:', error);
  }
}
