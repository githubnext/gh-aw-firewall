/**
 * Firewall Robustness Test Suite
 * Port of scripts/ci/test-firewall-robustness.sh
 *
 * Comprehensive tests covering:
 * - Happy-path basics (exact domains, subdomains, case insensitivity)
 * - Deny cases (IP literals, non-standard ports)
 * - Redirect behavior (cross-domain vs same-domain)
 * - Protocol & transport edges (HTTP/2, DoH, bypass attempts)
 * - IPv4/IPv6 parity
 * - Git operations
 * - Security corner cases
 * - Observability (audit log validation)
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';
import { createLogParser } from '../fixtures/log-parser';
import * as fs from 'fs';
import * as path from 'path';

describe('Firewall Robustness Tests', () => {
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

  describe('5. IPv4/IPv6 Parity', () => {
    test('IPv4 dual-stack', async () => {
      const result = await runner.runWithSudo('curl -fsS -4 https://api.github.com/zen', {
        allowDomains: ['api.github.com'],
        logLevel: 'warn',
      });

      expect(result).toSucceed();
    }, 120000);

    test('IPv6 dual-stack (if available)', async () => {
      // IPv6 may not be available in all environments
      const result = await runner.runWithSudo('curl -fsS -6 https://api.github.com/zen || exit 0', {
        allowDomains: ['api.github.com'],
        logLevel: 'warn',
      });

      expect(result).toSucceed();
    }, 120000);
  });

  describe('6. Git Operations', () => {
    test('Git over HTTPS allowed', async () => {
      const result = await runner.runWithSudo('git ls-remote https://github.com/octocat/Hello-World.git HEAD', {
        allowDomains: ['github.com'],
        logLevel: 'warn',
      });

      expect(result).toSucceed();
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

  describe('9. Observability', () => {
    test('Verify audit log fields for blocked traffic', async () => {
      const result = await runner.runWithSudo('curl -f https://example.com --max-time 5', {
        allowDomains: ['github.com'],
        keepContainers: true,
        logLevel: 'warn',
      });

      expect(result).toFail(); // Request should be blocked

      // Check Squid logs contain required fields
      if (result.workDir) {
        const squidLogPath = path.join(result.workDir, 'squid-logs', 'access.log');

        if (fs.existsSync(squidLogPath)) {
          const logContent = fs.readFileSync(squidLogPath, 'utf-8');
          const parser = createLogParser();
          const entries = parser.parseSquidLog(logContent);

          // Should have at least one log entry
          expect(entries.length).toBeGreaterThan(0);

          // Find blocked entries
          const blocked = parser.filterByDecision(entries, 'blocked');
          expect(blocked.length).toBeGreaterThan(0);

          // Verify required fields in blocked entry
          const blockedEntry = blocked[0];
          expect(blockedEntry.timestamp).toBeGreaterThan(0);
          expect(blockedEntry.host).toBeTruthy();
          expect(blockedEntry.decision).toBe('TCP_DENIED');
          expect(blockedEntry.statusCode).toBe(403);
        }

        // Cleanup work directory
        await cleanup(false);
      }
    }, 120000);
  });
});
