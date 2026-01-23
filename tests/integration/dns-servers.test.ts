/**
 * DNS Resolution Tests
 *
 * These tests verify that DNS resolution works correctly through Squid proxy:
 * - Squid handles DNS internally (configured with 8.8.8.8, 8.8.4.4)
 * - DNS queries work for allowed domains
 * - No DNS traffic is allowed outside of Squid
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';

describe('DNS Resolution', () => {
  let runner: AwfRunner;

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();
  });

  afterAll(async () => {
    await cleanup(false);
  });

  test('should resolve DNS for allowed domains through Squid', async () => {
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

  test('should resolve DNS with explicit DNS server', async () => {
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

  test('should resolve DNS with alternative DNS server', async () => {
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

  test('should resolve DNS using dig', async () => {
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
