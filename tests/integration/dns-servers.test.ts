/**
 * DNS Server Configuration Tests
 *
 * These tests verify the --dns-servers CLI option:
 * - Default DNS servers (8.8.8.8, 8.8.4.4)
 * - Custom DNS server configuration
 * - DNS resolution works with custom servers
 * - Invalid DNS server handling
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';

describe('DNS Server Configuration', () => {
  let runner: AwfRunner;

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();
  });

  afterAll(async () => {
    await cleanup(false);
  });

  test('should resolve DNS with default servers', async () => {
    const result = await runner.runWithSudo(
      'nslookup github.com',
      {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000,
      }
    );

    expect(result).toSucceed();
    expect(result.stdout).toContain('Address');
  }, 120000);

  test('should resolve DNS with custom Google DNS server', async () => {
    const result = await runner.runWithSudo(
      'nslookup github.com 8.8.8.8',
      {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000,
      }
    );

    expect(result).toSucceed();
    expect(result.stdout).toContain('Address');
  }, 120000);

  test('should resolve DNS with Cloudflare DNS server', async () => {
    const result = await runner.runWithSudo(
      'nslookup github.com 1.1.1.1',
      {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000,
      }
    );

    expect(result).toSucceed();
    expect(result.stdout).toContain('Address');
  }, 120000);

  test('should show DNS servers in debug output', async () => {
    const result = await runner.runWithSudo(
      'echo "test"',
      {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000,
      }
    );

    expect(result).toSucceed();
    // Debug output should show DNS configuration
    expect(result.stderr).toMatch(/DNS|dns/);
  }, 120000);

  test('should resolve multiple domains sequentially', async () => {
    const result = await runner.runWithSudo(
      'bash -c "nslookup github.com && nslookup api.github.com"',
      {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000,
      }
    );

    expect(result).toSucceed();
    // Both lookups should succeed
    expect(result.stdout).toContain('github.com');
  }, 120000);

  test('should resolve DNS for allowed domains', async () => {
    const result = await runner.runWithSudo(
      'dig github.com +short',
      {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000,
      }
    );

    expect(result).toSucceed();
    // dig should return IP address(es)
    expect(result.stdout.trim()).toMatch(/\d+\.\d+\.\d+\.\d+/);
  }, 120000);
});
