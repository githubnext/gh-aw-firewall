/**
 * Firewall Robustness Test Suite - Basics
 * Port of scripts/ci/test-firewall-robustness.sh
 *
 * Tests covering:
 * - Happy-path basics (exact domains, subdomains, case insensitivity)
 * - Deny cases (IP literals, non-standard ports)
 * - Redirect behavior (cross-domain vs same-domain)
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';

describe('Firewall Robustness - Basics', () => {
  let runner: AwfRunner;

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();
  }, 30000);

  afterAll(async () => {
    await cleanup(false);
  }, 30000);

  describe('1. Happy-Path Basics', () => {
    test('Allow exact domain', async () => {
      const result = await runner.runWithSudo('curl -fsS https://github.com/robots.txt', {
        allowDomains: ['github.com'],
        logLevel: 'warn',
        timeout: 30000,
      });

      expect(result).toSucceed();
    }, 120000);

    test('Multiple allowed domains', async () => {
      const result = await runner.runWithSudo('curl -fsS https://api.github.com/zen', {
        allowDomains: ['github.com', 'api.github.com'],
        logLevel: 'warn',
      });

      expect(result).toSucceed();
    }, 120000);

    test('Subdomain allowed (api.github.com via github.com)', async () => {
      const result = await runner.runWithSudo('curl -fsS https://api.github.com/zen', {
        allowDomains: ['github.com'],
        logLevel: 'warn',
      });

      expect(result).toSucceed();
    }, 120000);

    test('Case insensitive, spaces, trailing dot', async () => {
      const result = await runner.runWithSudo('curl -fsS https://api.github.com/zen', {
        allowDomains: [' GitHub.COM. ', ' API.GitHub.com '],
        logLevel: 'warn',
      });

      expect(result).toSucceed();
    }, 120000);
  });

  describe('2. Deny Cases', () => {
    test('Block different domain', async () => {
      const result = await runner.runWithSudo('curl -f https://example.com', {
        allowDomains: ['github.com'],
        logLevel: 'warn',
      });

      expect(result).toFail();
    }, 120000);

    test('Block direct IP literal access', async () => {
      const result = await runner.runWithSudo(
        `bash -c 'ip=$(dig +short api.github.com 2>/dev/null | grep -E "^[0-9.]+$" | head -1); if [ -z "$ip" ]; then echo "Failed to resolve IP" && exit 1; fi; curl -fk https://$ip'`,
        {
          allowDomains: ['github.com'],
          logLevel: 'warn',
        }
      );

      expect(result).toFail();
    }, 120000);

    test('Block non-standard port', async () => {
      const result = await runner.runWithSudo('curl -f https://github.com:8443 --max-time 5', {
        allowDomains: ['github.com'],
        logLevel: 'warn',
      });

      expect(result).toFail();
    }, 120000);
  });

  describe('3. Redirect Behavior', () => {
    test('Block cross-domain redirect', async () => {
      const result = await runner.runWithSudo(
        `curl -fL 'https://httpbin.org/redirect-to?url=https://example.com' --max-time 10`,
        {
          allowDomains: ['httpbin.org'],
          logLevel: 'warn',
        }
      );

      expect(result).toFail();
    }, 120000);

    test('HTTP requests may fail (known limitation - use HTTPS)', async () => {
      // Note: HTTP→HTTPS redirects are not currently supported
      // See docs/quickstart.md: "HTTP→HTTPS redirects may fail (use HTTPS directly)"
      const result = await runner.runWithSudo('curl -f http://github.com --max-time 10', {
        allowDomains: ['github.com'],
        logLevel: 'warn',
      });

      expect(result).toFail();
    }, 120000);
  });
});
