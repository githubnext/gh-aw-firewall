/**
 * Localhost Access Tests
 *
 * These tests verify the localhost keyword functionality for Playwright testing:
 * - localhost keyword automatically enables host access
 * - localhost is mapped to host.docker.internal
 * - Common dev ports (3000-10000) are automatically allowed
 * - Protocol prefixes (http://localhost, https://localhost) are preserved
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';

describe('Localhost Access', () => {
  let runner: AwfRunner;

  beforeAll(async () => {
    // Run cleanup before tests to ensure clean state
    await cleanup(false);
    runner = createRunner();
  });

  afterAll(async () => {
    // Clean up after all tests
    await cleanup(false);
  });

  test('should automatically enable host access when localhost is in allowed domains', async () => {
    const result = await runner.runWithSudo('echo "test"', {
      allowDomains: ['localhost'],
      logLevel: 'debug',
      timeout: 60000,
    });

    expect(result).toSucceed();
    // Check that the logs show automatic host access enablement
    expect(result.stderr).toContain('localhost keyword detected - automatically enabling host access');
    expect(result.stderr).toContain('allowing common development ports');
  }, 120000);

  test('should map localhost to host.docker.internal in configuration', async () => {
    const result = await runner.runWithSudo('echo "test"', {
      allowDomains: ['localhost'],
      logLevel: 'debug',
      timeout: 60000,
    });

    expect(result).toSucceed();
    // Check that host.docker.internal is in the allowed domains
    expect(result.stderr).toContain('Allowed domains: host.docker.internal');
  }, 120000);

  test('should preserve http:// protocol prefix for localhost', async () => {
    const result = await runner.runWithSudo('echo "test"', {
      allowDomains: ['http://localhost'],
      logLevel: 'debug',
      timeout: 60000,
    });

    expect(result).toSucceed();
    expect(result.stderr).toContain('localhost keyword detected');
    expect(result.stderr).toContain('Allowed domains: http://host.docker.internal');
  }, 120000);

  test('should preserve https:// protocol prefix for localhost', async () => {
    const result = await runner.runWithSudo('echo "test"', {
      allowDomains: ['https://localhost'],
      logLevel: 'debug',
      timeout: 60000,
    });

    expect(result).toSucceed();
    expect(result.stderr).toContain('localhost keyword detected');
    expect(result.stderr).toContain('Allowed domains: https://host.docker.internal');
  }, 120000);

  test('should work with localhost combined with other domains', async () => {
    const result = await runner.runWithSudo('echo "test"', {
      allowDomains: ['localhost', 'github.com', 'example.com'],
      logLevel: 'debug',
      timeout: 60000,
    });

    expect(result).toSucceed();
    expect(result.stderr).toContain('localhost keyword detected');
    // All domains should be present (localhost replaced with host.docker.internal)
    expect(result.stderr).toContain('host.docker.internal');
    expect(result.stderr).toContain('github.com');
    expect(result.stderr).toContain('example.com');
  }, 120000);

  test('should allow custom port range to override default', async () => {
    const result = await runner.runWithSudo('echo "test"', {
      allowDomains: ['localhost'],
      allowHostPorts: '8080',
      logLevel: 'debug',
      timeout: 60000,
    });

    expect(result).toSucceed();
    // Should not show automatic port range message since user specified their own
    expect(result.stderr).not.toContain('allowing common development ports');
  }, 120000);

  test('should resolve host.docker.internal from inside container', async () => {
    // Verify that host.docker.internal is resolvable
    const result = await runner.runWithSudo('getent hosts host.docker.internal', {
      allowDomains: ['localhost'],
      logLevel: 'debug',
      timeout: 60000,
    });

    expect(result).toSucceed();
    // getent should return IP address for host.docker.internal
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+\.\d+/);
  }, 120000);

  test('should work for Playwright-style testing scenario', async () => {
    // Simulate a Playwright test scenario: testing a local dev server
    // We can't actually run a server here, but we can verify the setup is correct
    const result = await runner.runWithSudo(
      'bash -c "echo Starting Playwright test for localhost && echo Test complete"',
      {
        allowDomains: ['localhost'],
        logLevel: 'info',
        timeout: 60000,
      }
    );

    expect(result).toSucceed();
    expect(result.stdout).toContain('Starting Playwright test for localhost');
    expect(result.stdout).toContain('Test complete');
  }, 120000);
});
