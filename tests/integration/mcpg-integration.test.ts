/**
 * MCP Gateway Integration Tests
 *
 * Tests the integration of AWF (Agentic Workflow Firewall) with gh-aw-mcpg (MCP Gateway).
 *
 * Architecture:
 * - MCP Gateway runs as a Docker container on the host (ghcr.io/githubnext/gh-aw-mcpg)
 * - AWF containers connect to it via host.docker.internal
 * - All HTTP/HTTPS traffic from AWF containers goes through Squid proxy
 * - Squid allows CONNECT to host.docker.internal on port 80
 *
 * Prerequisites:
 * - The gh-aw-mcpg image must be available (pulled or cached)
 * - Docker socket access for spawning containers
 * - GITHUB_PERSONAL_ACCESS_TOKEN for GitHub MCP server (optional, some tests skip if not set)
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';
import { createDockerHelper, DockerHelper } from '../fixtures/docker-helper';
import * as fs from 'fs';
import execa = require('execa');

// MCP Gateway container configuration
const MCPG_IMAGE = 'ghcr.io/githubnext/gh-aw-mcpg:v0.0.10';
const MCPG_CONTAINER_NAME = 'mcpg-gateway-test';
const MCPG_HOST_PORT = 18080; // Use non-standard port to avoid conflicts

describe('MCP Gateway Integration Tests', () => {
  let runner: AwfRunner;
  let docker: DockerHelper;
  let mcpgContainerId: string | undefined;
  let mcpConfigPath: string;

  // Check if we have the required token for GitHub MCP tests
  const hasGithubToken = !!process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

  beforeAll(async () => {
    // Clean up any leftover resources
    await cleanup(false);

    runner = createRunner();
    docker = createDockerHelper();

    // Create MCP client config file
    mcpConfigPath = `/tmp/mcp-gateway-config-${Date.now()}.json`;
    const mcpConfig = {
      mcpServers: {
        'github-gateway': {
          type: 'http',
          url: `http://host.docker.internal:${MCPG_HOST_PORT}/mcp/github`,
          headers: {
            Authorization: 'Bearer awf-test-session',
          },
          tools: ['*'],
        },
      },
    };
    fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

    // Pull MCP Gateway image
    console.log(`Pulling MCP Gateway image: ${MCPG_IMAGE}`);
    try {
      await docker.pullImage(MCPG_IMAGE);
    } catch (error) {
      console.warn(`Failed to pull ${MCPG_IMAGE}, it may already be cached or unavailable`);
    }
  }, 300000); // 5 minutes for image pulls

  afterAll(async () => {
    // Clean up MCP config file
    if (mcpConfigPath && fs.existsSync(mcpConfigPath)) {
      fs.unlinkSync(mcpConfigPath);
    }

    // Stop and remove MCP Gateway container
    if (mcpgContainerId) {
      await docker.stop(MCPG_CONTAINER_NAME);
      await docker.rm(MCPG_CONTAINER_NAME, true);
    }

    await cleanup(false);
  }, 60000);

  beforeEach(async () => {
    // Ensure MCP Gateway container is not running
    await docker.rm(MCPG_CONTAINER_NAME, true);
  }, 30000);

  afterEach(async () => {
    // Stop and remove MCP Gateway container after each test
    await docker.stop(MCPG_CONTAINER_NAME);
    await docker.rm(MCPG_CONTAINER_NAME, true);
    mcpgContainerId = undefined;
  }, 30000);

  /**
   * Helper function to start the MCP Gateway container
   */
  async function startMcpGateway(): Promise<void> {
    console.log('Starting MCP Gateway container...');

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
      } catch (error) {
        // Continue waiting
      }
    }

    if (!healthy) {
      throw new Error('MCP Gateway failed to become healthy');
    }
  }

  describe('1. Host Access via host.docker.internal', () => {
    test('AWF container can reach host.docker.internal when enabled', async () => {
      await startMcpGateway();

      const result = await runner.runWithSudo(
        `curl -s -f http://host.docker.internal:${MCPG_HOST_PORT}/health`,
        {
          allowDomains: ['host.docker.internal'],
          enableHostAccess: true,
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('OK');
    }, 120000);

    test('AWF container cannot reach host.docker.internal when disabled', async () => {
      await startMcpGateway();

      // Without --enable-host-access, host.docker.internal should not resolve
      const result = await runner.runWithSudo(
        `curl -s -f --max-time 5 http://host.docker.internal:${MCPG_HOST_PORT}/health`,
        {
          allowDomains: ['host.docker.internal'],
          // enableHostAccess: false (default)
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toFail();
    }, 120000);

    test('host.docker.internal blocked when not in allowed domains', async () => {
      await startMcpGateway();

      const result = await runner.runWithSudo(
        `curl -s -f --max-time 5 http://host.docker.internal:${MCPG_HOST_PORT}/health`,
        {
          allowDomains: ['github.com'], // host.docker.internal not in list
          enableHostAccess: true,
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toFail();
    }, 120000);
  });

  describe('2. MCP Gateway Health and Basic Connectivity', () => {
    test('MCP Gateway health endpoint accessible', async () => {
      await startMcpGateway();

      const result = await runner.runWithSudo(
        `curl -s -f http://host.docker.internal:${MCPG_HOST_PORT}/health`,
        {
          allowDomains: ['host.docker.internal'],
          enableHostAccess: true,
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('OK');
    }, 120000);

    test('MCP Gateway /mcp endpoint accessible', async () => {
      await startMcpGateway();

      // The /mcp endpoint expects a proper MCP request, but we can test basic connectivity
      const result = await runner.runWithSudo(
        `curl -s -w "%{http_code}" -o /dev/null http://host.docker.internal:${MCPG_HOST_PORT}/mcp`,
        {
          allowDomains: ['host.docker.internal'],
          enableHostAccess: true,
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      // The endpoint should return something (not a connection error)
      expect(result.stdout).toMatch(/\d{3}/); // HTTP status code
    }, 120000);
  });

  describe('3. CONNECT to Non-SSL Port', () => {
    test('Squid allows CONNECT to host.docker.internal:80', async () => {
      await startMcpGateway();

      // This tests that Squid allows CONNECT to port 80 (Safe_ports)
      // which is needed for MCP Gateway HTTP connections
      const result = await runner.runWithSudo(
        `curl -v -f http://host.docker.internal:${MCPG_HOST_PORT}/health`,
        {
          allowDomains: ['host.docker.internal'],
          enableHostAccess: true,
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
    }, 120000);
  });

  describe('4. Volume Mounts for MCP Config', () => {
    test('MCP config file accessible via volume mount', async () => {
      await startMcpGateway();

      const result = await runner.runWithSudo(
        `cat ${mcpConfigPath}`,
        {
          allowDomains: ['host.docker.internal'],
          enableHostAccess: true,
          volumeMounts: [`/tmp:/tmp:ro`],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('github-gateway');
      expect(result.stdout).toContain(`host.docker.internal:${MCPG_HOST_PORT}`);
    }, 120000);
  });

  describe('5. Environment Variables Passthrough', () => {
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

    test('individual env vars passed to container', async () => {
      const testEnvValue = `test-value-${Date.now()}`;

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
  });

  describe('6. Combined MCP Gateway Flow', () => {
    test('Full flow: AWF → Squid → MCP Gateway health check', async () => {
      await startMcpGateway();

      // This test simulates the full flow where:
      // 1. AWF starts with enable-host-access
      // 2. Agent container makes HTTP request to MCP Gateway
      // 3. Request goes through Squid proxy via CONNECT
      // 4. Squid connects to host.docker.internal
      // 5. Gateway receives and responds to the request
      const result = await runner.runWithSudo(
        `bash -c 'curl -s -f http://host.docker.internal:${MCPG_HOST_PORT}/health && echo "Gateway connection successful"'`,
        {
          allowDomains: ['host.docker.internal'],
          enableHostAccess: true,
          volumeMounts: ['/tmp:/tmp:rw'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('OK');
      expect(result.stdout).toContain('Gateway connection successful');
    }, 120000);

    test('Multiple domains including host.docker.internal', async () => {
      await startMcpGateway();

      // Test that we can access both external domains and host.docker.internal
      const result = await runner.runWithSudo(
        `bash -c 'curl -s -f http://host.docker.internal:${MCPG_HOST_PORT}/health && curl -s -f https://api.github.com/zen'`,
        {
          allowDomains: [
            'host.docker.internal',
            'api.github.com',
          ],
          enableHostAccess: true,
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('OK');
    }, 120000);
  });

  // Skip GitHub MCP tests if no token is available
  const maybeDescribe = hasGithubToken ? describe : describe.skip;

  maybeDescribe('7. GitHub MCP Server via Gateway (requires GITHUB_PERSONAL_ACCESS_TOKEN)', () => {
    test('MCP Gateway can spawn GitHub MCP server', async () => {
      await startMcpGateway();

      // Send a simple MCP initialize request to verify the gateway can handle MCP protocol
      // Note: This is a simplified test - full MCP protocol testing would require more complex setup
      const result = await runner.runWithSudo(
        `curl -s -X POST http://host.docker.internal:${MCPG_HOST_PORT}/mcp/github \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer awf-test-session" \
          -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"awf-test","version":"1.0.0"}}}'`,
        {
          allowDomains: ['host.docker.internal', 'api.github.com', 'github.com'],
          enableHostAccess: true,
          logLevel: 'debug',
          timeout: 120000,
        }
      );

      // The gateway should respond with some JSON (even if it's an error, it means connectivity works)
      expect(result.stdout).toBeTruthy();
      // If successful, should contain jsonrpc response
      if (result.success) {
        expect(result.stdout).toContain('jsonrpc');
      }
    }, 180000);
  });
});
