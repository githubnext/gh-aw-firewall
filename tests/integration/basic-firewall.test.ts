/**
 * Basic Firewall Functionality Tests
 * Port of .github/workflows/test-firewall-wrapper.yml
 *
 * These tests verify core firewall behavior:
 * - Domain whitelisting
 * - Subdomain matching
 * - Exit code propagation
 * - DNS resolution
 * - Localhost connectivity
 * - Container lifecycle management
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';
import { createDockerHelper, DockerHelper } from '../fixtures/docker-helper';

describe('Basic Firewall Functionality', () => {
  let runner: AwfRunner;
  let docker: DockerHelper;

  beforeAll(async () => {
    // Run cleanup before tests to ensure clean state
    await cleanup(false);

    runner = createRunner();
    docker = createDockerHelper();
  });

  afterAll(async () => {
    // Clean up after all tests
    await cleanup(false);
  });

  test('Test 1: Basic connectivity with allowed domain', async () => {
    const result = await runner.runWithSudo(
      'curl -v -f --max-time 30 https://api.github.com',
      {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 30000,
      }
    );

    expect(result).toSucceed();
    expect(result.stdout).toContain('HTTP'); // curl should succeed
  }, 120000);

  test('Test 2: Block non-whitelisted domain', async () => {
    const result = await runner.runWithSudo(
      'curl -v -f --max-time 10 https://example.com',
      {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 30000,
      }
    );

    // Should fail because example.com is not in allowlist
    expect(result).toFail();
    expect(result.exitCode).not.toBe(0);
  }, 120000);

  test('Test 3: Multiple domains', async () => {
    const result = await runner.runWithSudo(
      'bash -c "curl -f https://api.github.com && curl -f https://raw.githubusercontent.com"',
      {
        allowDomains: ['github.com', 'githubusercontent.com', 'api.github.com'],
        logLevel: 'debug',
        timeout: 30000,
      }
    );

    expect(result).toSucceed();
  }, 120000);

  test('Test 4: Subdomain matching', async () => {
    // api.github.com should be allowed when github.com is in the allowlist
    const result = await runner.runWithSudo(
      'curl -f --max-time 30 https://api.github.com',
      {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 30000,
      }
    );

    expect(result).toSucceed();
  }, 120000);

  test('Test 5: DNS resolution works', async () => {
    const result = await runner.runWithSudo('nslookup github.com', {
      allowDomains: ['github.com'],
      logLevel: 'debug',
        timeout: 30000,
    });

    expect(result).toSucceed();
    expect(result.stdout).toContain('Address'); // nslookup should return addresses
  }, 120000);

  test('Test 6: Localhost connectivity (MCP stdio servers)', async () => {
    // Localhost connections should work (needed for stdio MCP servers)
    // This will fail to connect (no server running) but shouldn't be blocked by firewall
    const result = await runner.runWithSudo(
      'curl -f http://localhost:1234 || echo "Localhost connection attempt completed"',
      {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 30000,
      }
    );

    // The command should succeed (the echo runs when curl fails)
    expect(result).toSucceed();
    expect(result.stdout).toContain('Localhost connection attempt completed');
  }, 120000);

  test('Test 7: Exit code propagation (success)', async () => {
    const result = await runner.runWithSudo('exit 0', {
      allowDomains: ['github.com'],
      logLevel: 'debug',
        timeout: 30000,
    });

    expect(result).toExitWithCode(0);
  }, 120000);

  test('Test 8: Exit code propagation (failure)', async () => {
    const result = await runner.runWithSudo('exit 42', {
      allowDomains: ['github.com'],
      logLevel: 'debug',
        timeout: 30000,
    });

    expect(result).toExitWithCode(42);
  }, 120000);

  test('Test 9: Keep containers option', async () => {
    const result = await runner.runWithSudo('echo "Test with keep-containers"', {
      allowDomains: ['github.com'],
      keepContainers: true,
      logLevel: 'debug',
        timeout: 30000,
    });

    expect(result).toSucceed();

    // Verify squid container is still running
    const squidRunning = await docker.isRunning('awf-squid');
    expect(squidRunning).toBe(true);

    // Verify runner container still exists (may have exited)
    const runnerInfo = await docker.inspect('awf-runner');
    expect(runnerInfo).not.toBeNull();

    // Clean up manually
    await docker.stop('awf-squid');
    await docker.rm('awf-squid', true);
    await docker.rm('awf-runner', true);
  }, 120000);
});
