import { WrapperConfig } from './types';

export interface WorkflowDependencies {
  ensureFirewallNetwork: () => Promise<{ squidIp: string }>;
  setupHostIptables: (squidIp: string, port: number, dnsServers: string[]) => Promise<void>;
  writeConfigs: (config: WrapperConfig) => Promise<void>;
  startContainers: (workDir: string, allowedDomains: string[], proxyLogsDir?: string, skipPull?: boolean) => Promise<void>;
  redactComposeSecrets: (workDir: string) => void;
  runAgentCommand: (
    workDir: string,
    allowedDomains: string[],
    proxyLogsDir?: string
  ) => Promise<{ exitCode: number }>;
}

export interface WorkflowCallbacks {
  onHostIptablesSetup?: () => void;
  onContainersStarted?: () => void;
}

export interface WorkflowLogger {
  info: (message: string, ...args: unknown[]) => void;
  success: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
}

export interface WorkflowOptions extends WorkflowCallbacks {
  logger: WorkflowLogger;
  performCleanup: () => Promise<void>;
}

/**
 * Executes the primary workflow for the CLI. This function is intentionally pure so
 * it can be unit tested with mocked dependencies.
 */
export async function runMainWorkflow(
  config: WrapperConfig,
  dependencies: WorkflowDependencies,
  options: WorkflowOptions
): Promise<number> {
  const { logger, performCleanup, onHostIptablesSetup, onContainersStarted } = options;

  // Step 0: Setup host-level network and iptables
  logger.info('Setting up host-level firewall network and iptables rules...');
  const networkConfig = await dependencies.ensureFirewallNetwork();
  const dnsServers = config.dnsServers || ['8.8.8.8', '8.8.4.4'];
  await dependencies.setupHostIptables(networkConfig.squidIp, 3128, dnsServers);
  onHostIptablesSetup?.();

  // Step 1: Write configuration files
  logger.info('Generating configuration files...');
  await dependencies.writeConfigs(config);

  // Step 2: Start containers
  await dependencies.startContainers(config.workDir, config.allowedDomains, config.proxyLogsDir, config.skipPull);

  // Step 3: Redact secrets from docker-compose.yml after containers start
  // This must happen AFTER docker compose up because Docker reads the file
  // to configure container environment variables. Redacting before would
  // prevent containers from receiving the tokens they need.
  // The race window is mitigated by the file being written with mode 0600
  // (root-only readable), so the agent (running as awfuser) cannot read it.
  dependencies.redactComposeSecrets(config.workDir);

  onContainersStarted?.();

  // Step 4: Wait for agent to complete
  const result = await dependencies.runAgentCommand(config.workDir, config.allowedDomains, config.proxyLogsDir);

  // Step 5: Cleanup (logs will be preserved automatically if they exist)
  await performCleanup();

  if (result.exitCode === 0) {
    logger.success('Command completed successfully');
  } else {
    logger.warn(`Command completed with exit code: ${result.exitCode}`);
  }

  return result.exitCode;
}
