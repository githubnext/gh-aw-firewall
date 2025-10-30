/**
 * Firewall Robustness Test Suite - Protocol & Security
 * Port of scripts/ci/test-firewall-robustness.sh
 *
 * Tests covering:
 * - Protocol & transport edges (HTTP/2, DoH, bypass attempts)
 * - Security corner cases
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';

describe('Firewall Robustness - Protocol & Security', () => {
  let runner: AwfRunner;

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();
  }, 30000);

  afterAll(async () => {
    await cleanup(false);
  }, 30000);

  describe('4. Protocol & Transport Edges', () => {
    test('HTTP/2 support', async () => {
      const result = await runner.runWithSudo('curl -fsS --http2 https://api.github.com/zen', {
        allowDomains: ['api.github.com'],
        logLevel: 'warn',
      });

      expect(result).toSucceed();
    }, 120000);

    test('Block curl --connect-to bypass attempt', async () => {
      const result = await runner.runWithSudo(
        'curl -f --connect-to ::github.com: https://example.com --max-time 5',
        {
          allowDomains: ['github.com'],
          logLevel: 'warn',
        }
      );

      expect(result).toFail();
    }, 120000);

    test('Block NO_PROXY environment variable bypass', async () => {
      const result = await runner.runWithSudo(`env NO_PROXY='*' curl -f https://example.com --max-time 5`, {
        allowDomains: ['github.com'],
        logLevel: 'warn',
      });

      expect(result).toFail();
    }, 120000);

    test('Block DNS over HTTPS (DoH)', async () => {
      const result = await runner.runWithSudo('curl -f https://cloudflare-dns.com/dns-query --max-time 5', {
        allowDomains: ['github.com'],
        logLevel: 'warn',
      });

      expect(result).toFail();
    }, 120000);

    test('Block AWS metadata endpoint', async () => {
      const result = await runner.runWithSudo('curl -f http://169.254.169.254 --max-time 5', {
        allowDomains: ['github.com'],
        logLevel: 'warn',
      });

      expect(result).toFail();
    }, 120000);
  });

  describe('7. Security Corner Cases', () => {
    test('Block SNI ≠ Host header mismatch', async () => {
      const result = await runner.runWithSudo(
        `curl -fk --header 'Host: github.com' https://example.com --max-time 5`,
        {
          allowDomains: ['github.com'],
          logLevel: 'warn',
        }
      );

      expect(result).toFail();
    }, 120000);

    test('Allow link-local multicast (mDNS not blocked - UDP passthrough)', async () => {
      // Note: UDP traffic like mDNS is not currently blocked by the firewall
      // The firewall only controls HTTP/HTTPS traffic through Squid proxy
      // UDP nc always succeeds (it's connectionless)
      const result = await runner.runWithSudo('timeout 5 nc -u -w1 224.0.0.251 5353 </dev/null', {
        allowDomains: ['github.com'],
        logLevel: 'warn',
      });

      expect(result).toSucceed();
    }, 120000);
  });
});
