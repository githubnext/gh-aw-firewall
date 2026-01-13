/**
 * Host Access and MCP Gateway Integration Tests
 *
 * Tests the integration of AWF (Agentic Workflow Firewall) with:
 * 1. Host access via host.docker.internal
 * 2. Environment variable passthrough
 * 3. Volume mounts for configuration files
 * 4. MCP Gateway connectivity (ghcr.io/githubnext/gh-aw-mcpg:v0.0.48)
 *
 * Note: HTTP connectivity tests through the proxy to host services are
 * environment-dependent and may require specific network configuration.
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';
import { createDockerHelper, DockerHelper } from '../fixtures/docker-helper';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import execa = require('execa');

// MCP Gateway configuration - use latest stable version
const MCPG_IMAGE = 'ghcr.io/githubnext/gh-aw-mcpg:v0.0.48';
const MCPG_CONTAINER_NAME = 'mcpg-gateway-test';
const MCPG_HOST_PORT = 8080;

describe('Host Access Integration Tests', () => {
  let runner: AwfRunner;
  let docker: DockerHelper;
  let testConfigPath: string;
  const tmpDir = os.tmpdir();

  beforeAll(async () => {
    // Clean up any leftover resources
    await cleanup(false);

    runner = createRunner();
    docker = createDockerHelper();

    // Create a test config file for volume mount tests
    testConfigPath = path.join(tmpDir, `awf-test-config-${Date.now()}.json`);
    const testConfig = {
      testKey: 'testValue',
      servers: {
        'test-server': {
          url: 'http://host.docker.internal/mcp/github',
        },
      },
    };
    fs.writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));
  }, 60000);

  afterAll(async () => {
    // Clean up test config file
    if (testConfigPath && fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
    await cleanup(false);
  }, 60000);

  describe('1. Host Access Configuration', () => {
    test('AWF container can resolve host.docker.internal when enabled', async () => {
      // Test DNS resolution with --enable-host-access
      const result = await runner.runWithSudo(
        'getent hosts host.docker.internal',
        {
          allowDomains: ['github.com'],
          enableHostAccess: true,
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      // Should resolve to an IP address (typically 172.17.0.1 or host-gateway IP)
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+\.\d+/);
    }, 120000);

    test('AWF container cannot resolve host.docker.internal when disabled', async () => {
      // Without --enable-host-access, host.docker.internal should not resolve
      const result = await runner.runWithSudo(
        'getent hosts host.docker.internal',
        {
          allowDomains: ['github.com'],
          // enableHostAccess: false (default)
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toFail();
    }, 120000);

    test('host.docker.internal resolves to correct gateway IP', async () => {
      const result = await runner.runWithSudo(
        'getent hosts host.docker.internal | awk \'{print $1}\'',
        {
          allowDomains: ['github.com'],
          enableHostAccess: true,
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      // Should contain a private IP (172.x.x.x, 10.x.x.x, or 192.168.x.x)
      // The output contains entrypoint logs, so we search within the output
      expect(result.stdout).toMatch(/(172\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)/);
    }, 120000);
  });

  describe('2. Volume Mounts for Config Files', () => {
    test('Config file accessible via volume mount', async () => {
      const result = await runner.runWithSudo(
        `cat ${testConfigPath}`,
        {
          allowDomains: ['github.com'],
          volumeMounts: [`${tmpDir}:${tmpDir}:ro`],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('testKey');
      expect(result.stdout).toContain('testValue');
    }, 120000);

    test('Config file with host.docker.internal URL accessible', async () => {
      const result = await runner.runWithSudo(
        `cat ${testConfigPath} | grep -q host.docker.internal && echo "Found host.docker.internal"`,
        {
          allowDomains: ['github.com'],
          enableHostAccess: true,
          volumeMounts: [`${tmpDir}:${tmpDir}:ro`],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('Found host.docker.internal');
    }, 120000);

    test('Read-write mount allows file creation', async () => {
      const testFile = path.join(tmpDir, `awf-rw-test-${Date.now()}.txt`);
      const testContent = 'AWF read-write mount test';

      const result = await runner.runWithSudo(
        `echo "${testContent}" > ${testFile} && cat ${testFile}`,
        {
          allowDomains: ['github.com'],
          volumeMounts: [`${tmpDir}:${tmpDir}:rw`],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain(testContent);

      // Verify file was created on host
      expect(fs.existsSync(testFile)).toBe(true);
      fs.unlinkSync(testFile);
    }, 120000);
  });

  describe('3. Environment Variables Passthrough', () => {
    test('env-all passes environment variables to container', async () => {
      const testEnvValue = `test-value-${Date.now()}`;

      const result = await runner.runWithSudo(
        'echo $AWF_TEST_VAR',
        {
          allowDomains: ['github.com'],
          envAll: true,
          env: {
            AWF_TEST_VAR: testEnvValue,
          },
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain(testEnvValue);
    }, 120000);

    test('individual env vars passed to container via --env flag', async () => {
      const testEnvValue = `custom-var-${Date.now()}`;

      const result = await runner.runWithSudo(
        'echo $MY_CUSTOM_VAR',
        {
          allowDomains: ['github.com'],
          env: {
            MY_CUSTOM_VAR: testEnvValue,
          },
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain(testEnvValue);
    }, 120000);

    test('multiple env vars can be passed together', async () => {
      const result = await runner.runWithSudo(
        'echo "VAR1=$VAR1 VAR2=$VAR2"',
        {
          allowDomains: ['github.com'],
          env: {
            VAR1: 'value1',
            VAR2: 'value2',
          },
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('VAR1=value1');
      expect(result.stdout).toContain('VAR2=value2');
    }, 120000);

    test('sensitive env vars can be passed for MCP tokens', async () => {
      const mockToken = 'ghp_mock_token_12345';

      const result = await runner.runWithSudo(
        'echo "Token length: ${#GITHUB_PERSONAL_ACCESS_TOKEN}"',
        {
          allowDomains: ['github.com'],
          env: {
            GITHUB_PERSONAL_ACCESS_TOKEN: mockToken,
          },
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain(`Token length: ${mockToken.length}`);
    }, 120000);
  });

  describe('4. Combined Options', () => {
    test('Multiple options work together', async () => {
      const testEnvValue = `combined-test-${Date.now()}`;

      const result = await runner.runWithSudo(
        `bash -c 'echo "Env: $TEST_VAR" && cat ${testConfigPath} && getent hosts host.docker.internal'`,
        {
          allowDomains: ['github.com', 'api.github.com'],
          enableHostAccess: true,
          volumeMounts: [`${tmpDir}:${tmpDir}:ro`],
          env: {
            TEST_VAR: testEnvValue,
          },
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain(testEnvValue);
      expect(result.stdout).toContain('testKey');
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+\.\d+/);
    }, 120000);

    test('enableHostAccess flag is properly passed to AWF', async () => {
      // This test verifies that the enableHostAccess option is correctly
      // passed through the runner and into the AWF CLI
      const result = await runner.runWithSudo(
        'cat /etc/hosts | grep -q host.docker && echo "host.docker.internal configured"',
        {
          allowDomains: ['github.com'],
          enableHostAccess: true,
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      // The /etc/hosts file should contain the host.docker.internal entry
      expect(result.stdout).toContain('host.docker.internal configured');
    }, 120000);
  });
});

/**
 * MCP Gateway Integration Tests
 *
 * Tests actual connectivity to the MCP Gateway running on the host.
 * Uses ghcr.io/githubnext/gh-aw-mcpg:v0.0.48 (latest stable release)
 */
describe('MCP Gateway Integration Tests', () => {
  let runner: AwfRunner;
  let docker: DockerHelper;
  let mcpgContainerId: string | undefined;
  const tmpDir = os.tmpdir();

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();
    docker = createDockerHelper();

    // Pull MCP Gateway image
    console.log(`Pulling MCP Gateway image: ${MCPG_IMAGE}`);
    try {
      await docker.pullImage(MCPG_IMAGE);
    } catch (error) {
      console.warn(`Failed to pull ${MCPG_IMAGE}, it may already be cached`);
    }
  }, 300000);

  afterAll(async () => {
    // Stop and remove MCP Gateway container
    await docker.stop(MCPG_CONTAINER_NAME);
    await docker.rm(MCPG_CONTAINER_NAME, true);
    await cleanup(false);
  }, 60000);

  afterEach(async () => {
    // Clean up gateway container after each test
    await docker.stop(MCPG_CONTAINER_NAME);
    await docker.rm(MCPG_CONTAINER_NAME, true);
    mcpgContainerId = undefined;
  }, 30000);

  /**
   * Helper function to start the MCP Gateway container
   */
  async function startMcpGateway(): Promise<void> {
    console.log('Starting MCP Gateway container...');

    // Remove any existing container
    await docker.rm(MCPG_CONTAINER_NAME, true);

    const envVars: Record<string, string> = {};
    if (process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
      envVars['GITHUB_PERSONAL_ACCESS_TOKEN'] = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    }

    const result = await docker.run({
      image: MCPG_IMAGE,
      name: MCPG_CONTAINER_NAME,
      detach: true,
      ports: [`${MCPG_HOST_PORT}:8000`],
      volumes: ['/var/run/docker.sock:/var/run/docker.sock'],
      env: envVars,
    });

    mcpgContainerId = result.containerId;

    // Wait for gateway to be ready
    console.log('Waiting for MCP Gateway to be healthy...');
    let healthy = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      try {
        const healthCheck = await execa('curl', [
          '-s',
          '-f',
          `http://127.0.0.1:${MCPG_HOST_PORT}/health`,
        ], { reject: false });
        if (healthCheck.exitCode === 0) {
          healthy = true;
          console.log('MCP Gateway is healthy');
          break;
        }
      } catch {
        // Continue waiting
      }
    }

    if (!healthy) {
      throw new Error('MCP Gateway failed to become healthy');
    }
  }

  test('MCP Gateway health endpoint accessible from host', async () => {
    await startMcpGateway();

    // Verify gateway is accessible from host
    const healthCheck = await execa('curl', [
      '-s',
      '-f',
      `http://127.0.0.1:${MCPG_HOST_PORT}/health`,
    ], { reject: false });

    expect(healthCheck.exitCode).toBe(0);
    expect(healthCheck.stdout).toContain('OK');
  }, 180000);

  test('AWF can resolve host.docker.internal for gateway access', async () => {
    await startMcpGateway();

    // Test that AWF container can resolve host.docker.internal
    const result = await runner.runWithSudo(
      `getent hosts host.docker.internal && echo "Gateway port: ${MCPG_HOST_PORT}"`,
      {
        allowDomains: ['host.docker.internal'],
        enableHostAccess: true,
        logLevel: 'debug',
        timeout: 60000,
      }
    );

    expect(result).toSucceed();
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+\.\d+/);
    expect(result.stdout).toContain(`Gateway port: ${MCPG_HOST_PORT}`);
  }, 180000);

  test('MCP Gateway config can be mounted into AWF container', async () => {
    await startMcpGateway();

    // Create MCP client config file
    const mcpConfigPath = path.join(tmpDir, `mcp-gateway-config-${Date.now()}.json`);
    const mcpConfig = {
      mcpServers: {
        'github-gateway': {
          type: 'http',
          url: `http://host.docker.internal:${MCPG_HOST_PORT}/mcp/github`,
          headers: {
            Authorization: '******',
          },
          tools: ['*'],
        },
      },
    };
    fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

    try {
      const result = await runner.runWithSudo(
        `cat ${mcpConfigPath}`,
        {
          allowDomains: ['host.docker.internal'],
          enableHostAccess: true,
          volumeMounts: [`${tmpDir}:${tmpDir}:ro`],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('github-gateway');
      expect(result.stdout).toContain(`host.docker.internal:${MCPG_HOST_PORT}`);
    } finally {
      if (fs.existsSync(mcpConfigPath)) {
        fs.unlinkSync(mcpConfigPath);
      }
    }
  }, 180000);
});
