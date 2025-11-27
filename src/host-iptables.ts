import execa from 'execa';
import { logger } from './logger';

const NETWORK_NAME = 'awf-net';
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

  // Create a dedicated chain for our rules to make cleanup easier
  const chainName = 'FW_WRAPPER';
  logger.debug(`Creating dedicated chain '${chainName}'...`);

  // Remove chain if it exists (cleanup from previous runs)
  try {
    // Check if chain exists first
    const { exitCode } = await execa('iptables', ['-t', 'filter', '-L', chainName, '-n'], { reject: false });
    if (exitCode === 0) {
      logger.debug(`Chain '${chainName}' already exists, cleaning up...`);

      // First, remove any references from DOCKER-USER
      const { stdout } = await execa('iptables', [
        '-t', 'filter', '-L', 'DOCKER-USER', '-n', '--line-numbers',
      ], { reject: false });

      const lines = stdout.split('\n');
      const lineNumbers: number[] = [];
      for (const line of lines) {
        if (line.includes(chainName)) {
          const match = line.match(/^(\d+)/);
          if (match) {
            lineNumbers.push(parseInt(match[1], 10));
          }
        }
      }

      // Delete rules in reverse order
      for (const lineNum of lineNumbers.reverse()) {
        logger.debug(`Removing reference to ${chainName} from DOCKER-USER line ${lineNum}`);
        await execa('iptables', [
          '-t', 'filter', '-D', 'DOCKER-USER', lineNum.toString(),
        ], { reject: false });
      }

      // Then flush and delete the chain
      await execa('iptables', ['-t', 'filter', '-F', chainName], { reject: false });
      await execa('iptables', ['-t', 'filter', '-X', chainName], { reject: false });
    }
  } catch (error) {
    // Ignore errors
    logger.debug('Error during chain cleanup:', error);
  }

  // Create the chain
  await execa('iptables', ['-t', 'filter', '-N', chainName]);

  // Build rules in our dedicated chain
  // 1. Allow all traffic FROM the Squid proxy (it needs unrestricted outbound access)
  await execa('iptables', [
    '-t', 'filter', '-A', chainName,
    '-s', squidIp,
    '-j', 'ACCEPT',
  ]);

  // 2. Allow established and related connections (return traffic)
  await execa('iptables', [
    '-t', 'filter', '-A', chainName,
    '-m', 'conntrack', '--ctstate', 'ESTABLISHED,RELATED',
    '-j', 'ACCEPT',
  ]);

  // 3. Allow localhost traffic
  await execa('iptables', [
    '-t', 'filter', '-A', chainName,
    '-o', 'lo',
    '-j', 'ACCEPT',
  ]);

  await execa('iptables', [
    '-t', 'filter', '-A', chainName,
    '-d', '127.0.0.0/8',
    '-j', 'ACCEPT',
  ]);

  // 4. Allow DNS (UDP and TCP port 53) with logging for audit trail
  // Log DNS queries first (LOG doesn't terminate processing)
  await execa('iptables', [
    '-t', 'filter', '-A', chainName,
    '-p', 'udp', '--dport', '53',
    '-j', 'LOG', '--log-prefix', '[FW_DNS_QUERY] ', '--log-level', '4',
  ]);

  await execa('iptables', [
    '-t', 'filter', '-A', chainName,
    '-p', 'udp', '--dport', '53',
    '-j', 'ACCEPT',
  ]);

  await execa('iptables', [
    '-t', 'filter', '-A', chainName,
    '-p', 'tcp', '--dport', '53',
    '-j', 'LOG', '--log-prefix', '[FW_DNS_QUERY] ', '--log-level', '4',
  ]);

  await execa('iptables', [
    '-t', 'filter', '-A', chainName,
    '-p', 'tcp', '--dport', '53',
    '-j', 'ACCEPT',
  ]);

  // 5. Allow traffic to Squid proxy
  await execa('iptables', [
    '-t', 'filter', '-A', chainName,
    '-p', 'tcp', '-d', squidIp, '--dport', squidPort.toString(),
    '-j', 'ACCEPT',
  ]);

  // 6. Block multicast and link-local traffic
  await execa('iptables', [
    '-t', 'filter', '-A', chainName,
    '-m', 'addrtype', '--dst-type', 'MULTICAST',
    '-j', 'REJECT', '--reject-with', 'icmp-port-unreachable',
  ]);

  await execa('iptables', [
    '-t', 'filter', '-A', chainName,
    '-d', '169.254.0.0/16',
    '-j', 'REJECT', '--reject-with', 'icmp-port-unreachable',
  ]);

  await execa('iptables', [
    '-t', 'filter', '-A', chainName,
    '-d', '224.0.0.0/4',
    '-j', 'REJECT', '--reject-with', 'icmp-port-unreachable',
  ]);

  // 7. Block all other UDP traffic (except DNS which is already allowed)
  await execa('iptables', [
    '-t', 'filter', '-A', chainName,
    '-p', 'udp', '!', '--dport', '53',
    '-j', 'LOG', '--log-prefix', '[FW_BLOCKED_UDP] ', '--log-level', '4',
  ]);

  await execa('iptables', [
    '-t', 'filter', '-A', chainName,
    '-p', 'udp', '!', '--dport', '53',
    '-j', 'REJECT', '--reject-with', 'icmp-port-unreachable',
  ]);

  // 8. Default deny all other traffic
  await execa('iptables', [
    '-t', 'filter', '-A', chainName,
    '-j', 'LOG', '--log-prefix', '[FW_BLOCKED_OTHER] ', '--log-level', '4',
  ]);

  await execa('iptables', [
    '-t', 'filter', '-A', chainName,
    '-j', 'REJECT', '--reject-with', 'icmp-port-unreachable',
  ]);

  // Now insert a rule in DOCKER-USER that jumps to our chain for traffic FROM the firewall bridge
  // Note: We use -i (input interface) to match egress traffic FROM containers on the bridge
  // Check if rule already exists
  const { stdout: existingRules } = await execa('iptables', [
    '-t', 'filter', '-L', 'DOCKER-USER', '-n', '--line-numbers',
  ]);

  if (!existingRules.includes(`-i ${bridgeName}`)) {
    logger.debug(`Inserting rule in DOCKER-USER to jump to ${chainName} for bridge ${bridgeName}...`);
    await execa('iptables', [
      '-t', 'filter', '-I', 'DOCKER-USER', '1',
      '-i', bridgeName,
      '-j', chainName,
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

  logger.debug(`${chainName} chain:`);
  const { stdout: fwWrapperRules } = await execa('iptables', [
    '-t', 'filter', '-L', chainName, '-n', '-v',
  ]);
  logger.debug(fwWrapperRules);
}

/**
 * Cleans up host-level iptables rules
 */
export async function cleanupHostIptables(): Promise<void> {
  logger.debug('Cleaning up host-level iptables rules...');

  const chainName = 'FW_WRAPPER';

  try {
    // Get the bridge name
    const bridgeName = await getNetworkBridgeName();
    if (bridgeName) {
      // Find and remove the rule that jumps to our chain
      const { stdout } = await execa('iptables', [
        '-t', 'filter', '-L', 'DOCKER-USER', '-n', '--line-numbers',
      ], { reject: false });

      // Parse line numbers for rules that reference our bridge
      const lines = stdout.split('\n');
      const lineNumbers: number[] = [];
      for (const line of lines) {
        if ((line.includes(`-i ${bridgeName}`) || line.includes(`-o ${bridgeName}`)) && line.includes(chainName)) {
          const match = line.match(/^(\d+)/);
          if (match) {
            lineNumbers.push(parseInt(match[1], 10));
          }
        }
      }

      // Delete rules in reverse order (to maintain line numbers)
      for (const lineNum of lineNumbers.reverse()) {
        logger.debug(`Removing rule ${lineNum} from DOCKER-USER`);
        await execa('iptables', [
          '-t', 'filter', '-D', 'DOCKER-USER', lineNum.toString(),
        ], { reject: false });
      }
    }

    // Flush and delete our custom chain
    await execa('iptables', ['-t', 'filter', '-F', chainName], { reject: false });
    await execa('iptables', ['-t', 'filter', '-X', chainName], { reject: false });

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
