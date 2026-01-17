/**
 * Network Security Tests
 *
 * These tests verify security aspects of the firewall:
 * - NET_ADMIN capability is dropped after setup
 * - iptables manipulation is blocked for user commands
 * - Firewall bypass attempts are blocked
 * - SSRF protection
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';

describe('Network Security', () => {
  let runner: AwfRunner;

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();
  });

  afterAll(async () => {
    await cleanup(false);
  });

  describe('Capability Restrictions', () => {
    test('should drop NET_ADMIN capability after iptables setup', async () => {
      // After PR #133, CAP_NET_ADMIN is dropped after iptables setup
      // User commands should not be able to modify iptables rules
      const result = await runner.runWithSudo(
        'iptables -t nat -L OUTPUT 2>&1 || echo "iptables command failed as expected"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      // iptables should fail due to lack of CAP_NET_ADMIN
      expect(result.stdout).toContain('iptables command failed as expected');
    }, 120000);

    test('should block iptables flush attempt', async () => {
      const result = await runner.runWithSudo(
        'iptables -t nat -F OUTPUT 2>&1 || echo "flush blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('flush blocked');
    }, 120000);

    test('should block iptables delete attempt', async () => {
      const result = await runner.runWithSudo(
        'iptables -t nat -D OUTPUT 1 2>&1 || echo "delete blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('delete blocked');
    }, 120000);

    test('should block iptables insert attempt', async () => {
      const result = await runner.runWithSudo(
        'iptables -t nat -I OUTPUT -j ACCEPT 2>&1 || echo "insert blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('insert blocked');
    }, 120000);
  });

  describe('Firewall Bypass Prevention', () => {
    test('should block curl --connect-to bypass', async () => {
      const result = await runner.runWithSudo(
        'curl -f --connect-to ::github.com: https://example.com --max-time 5',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toFail();
    }, 120000);

    test('should block NO_PROXY environment variable bypass', async () => {
      const result = await runner.runWithSudo(
        "env NO_PROXY='*' curl -f https://example.com --max-time 5",
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toFail();
    }, 120000);

    test('should block ALL_PROXY bypass attempt', async () => {
      const result = await runner.runWithSudo(
        "env ALL_PROXY='' curl -f https://example.com --max-time 5",
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toFail();
    }, 120000);
  });

  describe('SSRF Protection', () => {
    test('should block AWS metadata endpoint', async () => {
      const result = await runner.runWithSudo(
        'curl -f http://169.254.169.254 --max-time 5',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toFail();
    }, 120000);

    test('should block AWS metadata endpoint with path', async () => {
      const result = await runner.runWithSudo(
        'curl -f http://169.254.169.254/latest/meta-data/ --max-time 5',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toFail();
    }, 120000);

    test('should block GCP metadata endpoint', async () => {
      const result = await runner.runWithSudo(
        'curl -f "http://metadata.google.internal/computeMetadata/v1/" -H "Metadata-Flavor: Google" --max-time 5',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toFail();
    }, 120000);

    test('should block Azure metadata endpoint', async () => {
      const result = await runner.runWithSudo(
        'curl -f "http://169.254.169.254/metadata/instance" -H "Metadata: true" --max-time 5',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toFail();
    }, 120000);
  });

  describe('DNS Security', () => {
    test('should block DNS over HTTPS (DoH)', async () => {
      const result = await runner.runWithSudo(
        'curl -f https://cloudflare-dns.com/dns-query --max-time 5',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toFail();
    }, 120000);

    test('should block Google DoH endpoint', async () => {
      const result = await runner.runWithSudo(
        'curl -f https://dns.google/dns-query --max-time 5',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toFail();
    }, 120000);
  });

  describe('Firewall Effectiveness After Bypass Attempt', () => {
    test('should maintain firewall after iptables bypass attempt', async () => {
      // Attempt to flush iptables rules (should fail due to dropped NET_ADMIN)
      // Then verify the firewall still blocks non-whitelisted domains
      const result = await runner.runWithSudo(
        "bash -c 'iptables -t nat -F OUTPUT 2>/dev/null; curl -f https://example.com --max-time 5'",
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      // Should fail because:
      // 1. iptables flush fails (no CAP_NET_ADMIN)
      // 2. curl to example.com is blocked by Squid
      expect(result).toFail();
    }, 120000);
  });
});
