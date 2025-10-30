import { runMainWorkflow, WorkflowDependencies } from './cli-workflow';
import { WrapperConfig } from './types';

const baseConfig: WrapperConfig = {
  allowedDomains: ['github.com'],
  runnerCommand: 'echo "hello"',
  logLevel: 'info',
  keepContainers: false,
  workDir: '/tmp/awf-test',
  imageRegistry: 'registry',
  imageTag: 'latest',
  buildLocal: false,
};

const createLogger = () => ({
  info: jest.fn(),
  success: jest.fn(),
  warn: jest.fn(),
});

describe('runMainWorkflow', () => {
  it('executes workflow steps in order and logs success for zero exit code', async () => {
    const callOrder: string[] = [];
    const dependencies: WorkflowDependencies = {
      ensureFirewallNetwork: jest.fn().mockImplementation(async () => {
        callOrder.push('ensureFirewallNetwork');
        return { squidIp: '172.30.0.10' };
      }),
      setupHostIptables: jest.fn().mockImplementation(async () => {
        callOrder.push('setupHostIptables');
      }),
      writeConfigs: jest.fn().mockImplementation(async () => {
        callOrder.push('writeConfigs');
      }),
      startContainers: jest.fn().mockImplementation(async () => {
        callOrder.push('startContainers');
      }),
      runRunnerCommand: jest.fn().mockImplementation(async () => {
        callOrder.push('runRunnerCommand');
        return { exitCode: 0 };
      }),
    };
    const performCleanup = jest.fn().mockImplementation(async () => {
      callOrder.push('performCleanup');
    });
    const logger = createLogger();

    const exitCode = await runMainWorkflow(baseConfig, dependencies, {
      logger,
      performCleanup,
    });

    expect(callOrder).toEqual([
      'ensureFirewallNetwork',
      'setupHostIptables',
      'writeConfigs',
      'startContainers',
      'runRunnerCommand',
      'performCleanup',
    ]);
    expect(exitCode).toBe(0);
    expect(logger.success).toHaveBeenCalledWith('Command completed successfully');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs warning with exit code when command fails', async () => {
    const callOrder: string[] = [];
    const dependencies: WorkflowDependencies = {
      ensureFirewallNetwork: jest.fn().mockImplementation(async () => {
        callOrder.push('ensureFirewallNetwork');
        return { squidIp: '172.30.0.10' };
      }),
      setupHostIptables: jest.fn().mockImplementation(async () => {
        callOrder.push('setupHostIptables');
      }),
      writeConfigs: jest.fn().mockImplementation(async () => {
        callOrder.push('writeConfigs');
      }),
      startContainers: jest.fn().mockImplementation(async () => {
        callOrder.push('startContainers');
      }),
      runRunnerCommand: jest.fn().mockImplementation(async () => {
        callOrder.push('runRunnerCommand');
        return { exitCode: 42 };
      }),
    };
    const performCleanup = jest.fn().mockImplementation(async () => {
      callOrder.push('performCleanup');
    });
    const logger = createLogger();

    const exitCode = await runMainWorkflow(baseConfig, dependencies, {
      logger,
      performCleanup,
    });

    expect(exitCode).toBe(42);
    expect(callOrder).toEqual([
      'ensureFirewallNetwork',
      'setupHostIptables',
      'writeConfigs',
      'startContainers',
      'runRunnerCommand',
      'performCleanup',
    ]);
    expect(logger.warn).toHaveBeenCalledWith('Command completed with exit code: 42');
    expect(logger.success).not.toHaveBeenCalled();
  });
});
