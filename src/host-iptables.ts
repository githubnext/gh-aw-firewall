import execa from 'execa';
import { logger } from './logger';

const NETWORK_NAME = 'awf-net';
const CHAIN_NAME = 'FW_WRAPPER';
const NETWORK_SUBNET = '172.30.0.0/24';

/**
 * Gets the bridge interface name for the firewall network
 */
async function getNetworkBridgeName(): Promise<string | null> {
  try {
    const { stdout } = await execa('docker', [
      'network',
      'inspect',
      NETWORK_NAME,
      '-f',
      '{{index .Options "com.docker.network.bridge.name"}}',
    ]);
    const bridgeName = stdout.trim();
    return bridgeName || null;
  } catch (error) {
    logger.debug('Failed to get network bridge name:', error);
    return null;
  }
}

/**
 * Creates the dedicated firewall network if it doesn't exist
 * Returns the Squid and agent IPs
 */
export async function ensureFirewallNetwork(): Promise<{
  subnet: string;
  squidIp: string;
  agentIp: string;
}> {
  logger.debug(`Ensuring firewall network '${NETWORK_NAME}' exists...`);

  // Check if network already exists
  let networkExists = false;
  try {
    await execa('docker', ['network', 'inspect', NETWORK_NAME]);
    networkExists = true;
    logger.debug(`Network '${NETWORK_NAME}' already exists`);
  } catch {
    // Network doesn't exist
  }

  if (!networkExists) {
    // Network doesn't exist, create it with explicit bridge name
    logger.debug(`Creating network '${NETWORK_NAME}' with subnet ${NETWORK_SUBNET}...`);
    await execa('docker', [
      'network',
      'create',
      NETWORK_NAME,
      '--subnet',
      NETWORK_SUBNET,
      '--opt',
      'com.docker.network.bridge.name=fw-bridge',
    ]);
    logger.success(`Created network '${NETWORK_NAME}' with bridge 'fw-bridge'`);
  }

  return {
    subnet: NETWORK_SUBNET,
    squidIp: '172.30.0.10',
    agentIp: '172.30.0.20',
  };
}

/**
 * Sets up host-level iptables rules using DOCKER-USER chain
 * This ensures ALL containers on the firewall network are subject to egress filtering
 * @param squidIp - IP address of the Squid proxy
 * @param squidPort - Port number of the Squid proxy
 */
export async function setupHostIptables(squidIp: string, squidPort: number): Promise<void> {
  logger.info('Setting up host-level iptables rules...');

  // Get the bridge interface name
  const bridgeName = await getNetworkBridgeName();
  if (!bridgeName) {
    throw new Error(`Failed to get bridge name for network '${NETWORK_NAME}'`);
  }

  logger.debug(`Bridge interface: ${bridgeName}`);

  // Check if we have permission to run iptables commands
  try {
    await execa('iptables', ['-t', 'filter', '-L', 'DOCKER-USER', '-n'], { timeout: 5000 });
  } catch (error: any) {
    if (error.stderr && error.stderr.includes('Permission denied')) {
      throw new Error(
        'Permission denied: iptables commands require root privileges. ' +
        'Please run this command with sudo.'
      );
    }
    // DOCKER-USER chain doesn't exist (shouldn't happen, but handle it)
    logger.warn('DOCKER-USER chain does not exist, which is unexpected. Attempting to create it...');
    try {
      await execa('iptables', ['-t', 'filter', '-N', 'DOCKER-USER']);
    } catch {
      throw new Error(
        'Failed to create DOCKER-USER chain. This may indicate a permission or Docker installation issue.'
      );
    }
  }

  // Create dedicated chains for our rules to make cleanup easier
  // Use CHAIN_NAME for IPv4 and CHAIN_NAME_V6 for IPv6
  logger.debug(`Creating dedicated chain '${CHAIN_NAME}'...`);

  // Remove chain if it exists (cleanup from previous runs)
  try {
    // Check if chain exists first
    const { exitCode } = await execa('iptables', ['-t', 'filter', '-L', CHAIN_NAME, '-n'], { reject: false });
    if (exitCode === 0) {
      logger.debug(`Chain '${CHAIN_NAME}' already exists, cleaning up...`);

      // First, remove any references from DOCKER-USER
      const { stdout } = await execa('iptables', [
        '-t', 'filter', '-L', 'DOCKER-USER', '-n', '--line-numbers',
      ], { reject: false });

      const lines = stdout.split('\n');
      const lineNumbers: number[] = [];
      for (const line of lines) {
        if (line.includes(CHAIN_NAME)) {
          const match = line.match(/^(\d+)/);
          if (match) {
            lineNumbers.push(parseInt(match[1], 10));
          }
        }
      }

      // Delete rules in reverse order
      for (const lineNum of lineNumbers.reverse()) {
        logger.debug(`Removing reference to ${CHAIN_NAME} from DOCKER-USER line ${lineNum}`);
        await execa('iptables', [
          '-t', 'filter', '-D', 'DOCKER-USER', lineNum.toString(),
        ], { reject: false });
      }

      // Then flush and delete the chain
      await execa('iptables', ['-t', 'filter', '-F', CHAIN_NAME], { reject: false });
      await execa('iptables', ['-t', 'filter', '-X', CHAIN_NAME], { reject: false });
    }
  } catch (error) {
    // Ignore errors
    logger.debug('Error during chain cleanup:', error);
  }

  // Create the chain
  await execa('iptables', ['-t', 'filter', '-N', CHAIN_NAME]);

  // Build rules in our dedicated chain
  // 1. Allow all traffic FROM the Squid proxy (it needs unrestricted outbound access)
  await execa('iptables', [
    '-t', 'filter', '-A', CHAIN_NAME,
    '-s', squidIp,
    '-j', 'ACCEPT',
  ]);

  // 2. Allow established and related connections (return traffic)
  await execa('iptables', [
    '-t', 'filter', '-A', CHAIN_NAME,
    '-m', 'conntrack', '--ctstate', 'ESTABLISHED,RELATED',
    '-j', 'ACCEPT',
  ]);

  // 3. Allow localhost traffic
  await execa('iptables', [
    '-t', 'filter', '-A', CHAIN_NAME,
    '-o', 'lo',
    '-j', 'ACCEPT',
  ]);

  await execa('iptables', [
    '-t', 'filter', '-A', CHAIN_NAME,
    '-d', '127.0.0.0/8',
    '-j', 'ACCEPT',
  ]);

  // 4. Allow traffic to Squid proxy
  await execa('iptables', [
    '-t', 'filter', '-A', CHAIN_NAME,
    '-p', 'tcp', '-d', squidIp, '--dport', squidPort.toString(),
    '-j', 'ACCEPT',
  ]);

  // 5. Block multicast and link-local traffic
  await execa('iptables', [
    '-t', 'filter', '-A', CHAIN_NAME,
    '-m', 'addrtype', '--dst-type', 'MULTICAST',
    '-j', 'REJECT', '--reject-with', 'icmp-port-unreachable',
  ]);

  await execa('iptables', [
    '-t', 'filter', '-A', CHAIN_NAME,
    '-d', '169.254.0.0/16',
    '-j', 'REJECT', '--reject-with', 'icmp-port-unreachable',
  ]);

  await execa('iptables', [
    '-t', 'filter', '-A', CHAIN_NAME,
    '-d', '224.0.0.0/4',
    '-j', 'REJECT', '--reject-with', 'icmp-port-unreachable',
  ]);

  // 6. Block all other UDP traffic
  // DNS lookups are handled by Squid proxy internally
  await execa('iptables', [
    '-t', 'filter', '-A', CHAIN_NAME,
    '-p', 'udp',
    '-j', 'LOG', '--log-prefix', '[FW_BLOCKED_UDP] ', '--log-level', '4',
  ]);

  await execa('iptables', [
    '-t', 'filter', '-A', CHAIN_NAME,
    '-p', 'udp',
    '-j', 'REJECT', '--reject-with', 'icmp-port-unreachable',
  ]);

  // 7. Default deny all other traffic
  await execa('iptables', [
    '-t', 'filter', '-A', CHAIN_NAME,
    '-j', 'LOG', '--log-prefix', '[FW_BLOCKED_OTHER] ', '--log-level', '4',
  ]);

  await execa('iptables', [
    '-t', 'filter', '-A', CHAIN_NAME,
    '-j', 'REJECT', '--reject-with', 'icmp-port-unreachable',
  ]);

  // Now insert a rule in DOCKER-USER that jumps to our chain for traffic FROM the firewall bridge
  // Note: We use -i (input interface) to match egress traffic FROM containers on the bridge
  // Check if rule already exists
  const { stdout: existingRules } = await execa('iptables', [
    '-t', 'filter', '-L', 'DOCKER-USER', '-n', '--line-numbers',
  ]);

  if (!existingRules.includes(`-i ${bridgeName}`)) {
    logger.debug(`Inserting rule in DOCKER-USER to jump to ${CHAIN_NAME} for bridge ${bridgeName}...`);
    await execa('iptables', [
      '-t', 'filter', '-I', 'DOCKER-USER', '1',
      '-i', bridgeName,
      '-j', CHAIN_NAME,
    ]);
  } else {
    logger.debug(`Rule for bridge ${bridgeName} already exists in DOCKER-USER`);
  }

  logger.success('Host-level iptables rules configured successfully');

  // Show the rules for debugging
  logger.debug('DOCKER-USER chain:');
  const { stdout: dockerUserRules } = await execa('iptables', [
    '-t', 'filter', '-L', 'DOCKER-USER', '-n', '-v',
  ]);
  logger.debug(dockerUserRules);

  logger.debug(`${CHAIN_NAME} chain:`);
  const { stdout: fwWrapperRules } = await execa('iptables', [
    '-t', 'filter', '-L', CHAIN_NAME, '-n', '-v',
  ]);
  logger.debug(fwWrapperRules);
}

/**
 * Cleans up host-level iptables rules (both IPv4 and IPv6)
 */
export async function cleanupHostIptables(): Promise<void> {
  logger.debug('Cleaning up host-level iptables rules...');

  try {
    // Get the bridge name
    const bridgeName = await getNetworkBridgeName();

    // Clean up IPv4 rules
    if (bridgeName) {
      // Find and remove the rule that jumps to our chain
      const { stdout } = await execa('iptables', [
        '-t', 'filter', '-L', 'DOCKER-USER', '-n', '--line-numbers',
      ], { reject: false });

      // Parse line numbers for rules that reference our bridge
      const lines = stdout.split('\n');
      const lineNumbers: number[] = [];
      for (const line of lines) {
        if ((line.includes(`-i ${bridgeName}`) || line.includes(`-o ${bridgeName}`)) && line.includes(CHAIN_NAME)) {
          const match = line.match(/^(\d+)/);
          if (match) {
            lineNumbers.push(parseInt(match[1], 10));
          }
        }
      }

      // Delete rules in reverse order (to maintain line numbers)
      for (const lineNum of lineNumbers.reverse()) {
        logger.debug(`Removing rule ${lineNum} from DOCKER-USER (IPv4)`);
        await execa('iptables', [
          '-t', 'filter', '-D', 'DOCKER-USER', lineNum.toString(),
        ], { reject: false });
      }
    }

    // Flush and delete our custom IPv4 chain
    await execa('iptables', ['-t', 'filter', '-F', CHAIN_NAME], { reject: false });
    await execa('iptables', ['-t', 'filter', '-X', CHAIN_NAME], { reject: false });

    logger.debug('Host-level iptables rules cleaned up');
  } catch (error) {
    logger.debug('Error cleaning up iptables rules:', error);
    // Don't throw - cleanup should be best-effort
  }
}

/**
 * Removes the firewall network
 */
export async function cleanupFirewallNetwork(): Promise<void> {
  logger.debug(`Removing firewall network '${NETWORK_NAME}'...`);

  try {
    await execa('docker', ['network', 'rm', NETWORK_NAME], { reject: false });
    logger.debug('Firewall network removed');
  } catch (error) {
    logger.debug('Error removing firewall network:', error);
    // Don't throw - cleanup should be best-effort
  }
}
