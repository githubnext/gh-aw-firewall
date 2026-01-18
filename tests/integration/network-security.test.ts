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

  describe('Container Escape Prevention (Seccomp)', () => {
    test('should block ptrace syscall', async () => {
      // ptrace is commonly used for container escape attacks
      // Start a background process and try to trace it using $! (last background PID)
      const result = await runner.runWithSudo(
        "bash -c 'sleep 10 & strace -p $! 2>&1' || echo 'ptrace blocked'",
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      // strace should fail because ptrace is blocked by seccomp
      expect(result.stdout).toMatch(/ptrace blocked|Operation not permitted|attach: ptrace/);
    }, 120000);

    test('should block mount syscall', async () => {
      // mount is used for container escape via filesystem manipulation
      const result = await runner.runWithSudo(
        "mount -t tmpfs none /mnt 2>&1 || echo 'mount blocked'",
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/mount blocked|Operation not permitted|permission denied/i);
    }, 120000);
  });

  describe('Raw Socket Prevention', () => {
    test('should block raw socket creation for ICMP', async () => {
      // ping requires CAP_NET_RAW which is dropped
      const result = await runner.runWithSudo(
        'ping -c 1 8.8.8.8 2>&1 || echo "raw socket blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      // ping should fail because NET_RAW is dropped
      expect(result.stdout).toMatch(/raw socket blocked|Operation not permitted|socket: Permission denied/i);
    }, 120000);
  });

  describe('DNS Exfiltration Prevention', () => {
    test('should only allow DNS to trusted servers', async () => {
      // Attempt to query an untrusted DNS server (should fail)
      // Using dig if available, otherwise nslookup
      const result = await runner.runWithSudo(
        "dig @1.2.3.4 example.com +time=2 +tries=1 2>&1 || echo 'untrusted DNS blocked'",
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      // dig to untrusted DNS server should fail (traffic blocked by iptables)
      expect(result.stdout).toMatch(/untrusted DNS blocked|connection timed out|no servers could be reached/i);
    }, 120000);
  });
});
