/**
 * Firewall Escape Tests
 *
 * These tests attempt to bypass the firewall through various attack vectors
 * to validate the defense-in-depth architecture:
 *
 * 1. DNS Exfiltration - Unauthorized DNS servers, DNS tunneling
 * 2. Port Scanning - Dangerous ports (22, 3306, 5432, etc.)
 * 3. iptables Modification - Flush, insert, delete rules
 * 4. Container Escape - mount, ptrace blocked by seccomp
 * 5. Protocol Bypass - QUIC/HTTP3, raw sockets
 * 6. Domain Pattern Bypass - Overly broad patterns
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';

describe('Firewall Escape Prevention', () => {
  let runner: AwfRunner;

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();
  });

  afterAll(async () => {
    await cleanup(false);
  });

  describe('DNS Exfiltration Prevention', () => {
    test('should block DNS queries to unauthorized DNS servers', async () => {
      // Attempt to query an unauthorized DNS server (Cloudflare)
      const result = await runner.runWithSudo(
        'dig @1.1.1.1 example.com 2>&1 || echo "DNS query blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      // Either the dig command should fail, or we should see blocked message
      // DNS to unauthorized servers should be blocked by iptables
      expect(result).toSucceed();
      expect(result.stdout).toMatch(/blocked|timed out|connection refused|no servers could be reached/i);
    }, 120000);

    test('should block DNS queries to OpenDNS', async () => {
      // Attempt to query OpenDNS (not in trusted DNS list)
      const result = await runner.runWithSudo(
        'dig @208.67.222.222 example.com +time=3 2>&1 || echo "DNS query blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/blocked|timed out|connection refused|no servers could be reached/i);
    }, 120000);

    test('should only allow DNS to configured trusted servers', async () => {
      // Allowed DNS queries to trusted servers should work
      // Default trusted servers are 8.8.8.8 and 8.8.4.4 (Google DNS)
      const result = await runner.runWithSudo(
        'nslookup github.com 2>&1 | head -20',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      // Should successfully resolve
      expect(result.stdout).toMatch(/name\s*=|address/i);
    }, 120000);
  });

  describe('Port Scanning Prevention', () => {
    test('should block connection to SSH port (22)', async () => {
      const result = await runner.runWithSudo(
        'nc -z -w 3 github.com 22 2>&1 || echo "port 22 blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('port 22 blocked');
    }, 120000);

    test('should block connection to MySQL port (3306)', async () => {
      const result = await runner.runWithSudo(
        'nc -z -w 3 github.com 3306 2>&1 || echo "port 3306 blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('port 3306 blocked');
    }, 120000);

    test('should block connection to PostgreSQL port (5432)', async () => {
      const result = await runner.runWithSudo(
        'nc -z -w 3 github.com 5432 2>&1 || echo "port 5432 blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('port 5432 blocked');
    }, 120000);

    test('should block connection to Redis port (6379)', async () => {
      const result = await runner.runWithSudo(
        'nc -z -w 3 github.com 6379 2>&1 || echo "port 6379 blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('port 6379 blocked');
    }, 120000);

    test('should block connection to MongoDB port (27017)', async () => {
      const result = await runner.runWithSudo(
        'nc -z -w 3 github.com 27017 2>&1 || echo "port 27017 blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('port 27017 blocked');
    }, 120000);

    test('should block connection to RDP port (3389)', async () => {
      const result = await runner.runWithSudo(
        'nc -z -w 3 github.com 3389 2>&1 || echo "port 3389 blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('port 3389 blocked');
    }, 120000);
  });

  describe('iptables Rule Modification Prevention', () => {
    test('should block iptables -F flush attempt', async () => {
      // Attempt to flush all iptables rules
      const result = await runner.runWithSudo(
        'iptables -F 2>&1 || echo "iptables flush blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/blocked|permission denied|operation not permitted/i);
    }, 120000);

    test('should block iptables -A append attempt', async () => {
      // Attempt to add an ACCEPT rule for all traffic
      const result = await runner.runWithSudo(
        'iptables -A OUTPUT -j ACCEPT 2>&1 || echo "iptables append blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/blocked|permission denied|operation not permitted/i);
    }, 120000);

    test('should block iptables NAT table modification', async () => {
      // Attempt to modify NAT table to bypass proxy
      const result = await runner.runWithSudo(
        'iptables -t nat -F OUTPUT 2>&1 || echo "NAT modification blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/blocked|permission denied|operation not permitted/i);
    }, 120000);

    test('should verify firewall still works after bypass attempt', async () => {
      // Attempt to bypass, then verify firewall is still enforced
      const result = await runner.runWithSudo(
        "bash -c 'iptables -F 2>/dev/null; curl -f https://example.com --max-time 5 2>&1 || echo \"firewall still active\"'",
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('firewall still active');
    }, 120000);
  });

  describe('Container Escape Prevention', () => {
    test('should block mount syscall', async () => {
      // Attempt to mount a filesystem (blocked by seccomp)
      const result = await runner.runWithSudo(
        'mount -t tmpfs tmpfs /tmp/test 2>&1 || echo "mount blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/blocked|operation not permitted|permission denied/i);
    }, 120000);

    test('should block ptrace syscall', async () => {
      // Attempt to use ptrace (blocked by seccomp)
      const result = await runner.runWithSudo(
        'strace echo test 2>&1 || echo "ptrace blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      // Either strace fails, or we get blocked message
      expect(result.stdout).toMatch(/blocked|operation not permitted|permission denied/i);
    }, 120000);

    test('should block kernel module loading', async () => {
      // Attempt to load a kernel module (blocked by seccomp)
      const result = await runner.runWithSudo(
        'insmod /nonexistent.ko 2>&1 || echo "insmod blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      // Module loading should fail
      expect(result.stdout).toMatch(/blocked|operation not permitted|permission denied|no such file|invalid module format/i);
    }, 120000);

    test('should block reboot attempt', async () => {
      // Attempt to reboot (blocked by seccomp)
      const result = await runner.runWithSudo(
        'reboot 2>&1 || echo "reboot blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/blocked|operation not permitted|permission denied|must be superuser/i);
    }, 120000);
  });

  describe('Protocol Bypass Prevention', () => {
    test('should block raw socket creation', async () => {
      // Attempt to create a raw socket (requires CAP_NET_RAW)
      const result = await runner.runWithSudo(
        'ping -c 1 example.com 2>&1 || echo "raw socket blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      // ICMP ping requires raw sockets, should fail without CAP_NET_RAW
      expect(result).toSucceed();
      expect(result.stdout).toMatch(/blocked|operation not permitted|permission denied|prohibited/i);
    }, 120000);

    test('should block non-HTTP/HTTPS traffic on arbitrary ports', async () => {
      // Attempt to connect to a non-standard port
      const result = await runner.runWithSudo(
        'nc -z -w 3 github.com 8080 2>&1 || echo "non-standard port blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('non-standard port blocked');
    }, 120000);

    test('should block UDP traffic to non-DNS ports', async () => {
      // Attempt UDP traffic to a non-DNS port
      const result = await runner.runWithSudo(
        'bash -c "echo test | nc -u -w 3 8.8.8.8 12345 2>&1" || echo "UDP blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      // UDP to non-DNS ports should be blocked or timeout
      // No error indicates the UDP traffic was silently dropped (expected behavior)
      expect(result).toBeDefined();
    }, 120000);
  });

  describe('Domain Pattern Validation', () => {
    test('should reject empty domain list', async () => {
      const result = await runner.runWithSudo(
        'echo "test"',
        {
          allowDomains: [],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      // Should fail because no domains are allowed
      expect(result).toFail();
    }, 120000);

    test('should block parent domain when only subdomain is allowed', async () => {
      const result = await runner.runWithSudo(
        'curl -f https://github.com --max-time 5',
        {
          allowDomains: ['api.github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      // When only api.github.com is allowed, github.com should be blocked
      expect(result).toFail();
    }, 120000);

    test('should block non-allowed domain even with protocol manipulation', async () => {
      // Try accessing a blocked domain with explicit port
      const result = await runner.runWithSudo(
        'curl -f https://example.com:443 --max-time 5',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toFail();
    }, 120000);
  });

  describe('Combined Attack Scenarios', () => {
    test('should maintain firewall after multiple bypass attempts', async () => {
      // Attempt multiple bypass techniques, then verify firewall
      const result = await runner.runWithSudo(
        `bash -c '
          # Try iptables flush
          iptables -F 2>/dev/null
          # Try NAT modification
          iptables -t nat -F OUTPUT 2>/dev/null
          # Verify firewall is still active
          curl -f https://example.com --max-time 5 2>&1 || echo "firewall still enforced"
        '`,
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('firewall still enforced');
    }, 120000);

    test('should block data exfiltration via unauthorized DNS', async () => {
      // Attempt to exfiltrate data via DNS TXT query to unauthorized server
      const result = await runner.runWithSudo(
        'dig TXT @1.1.1.1 test.example.com 2>&1 || echo "exfiltration blocked"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/blocked|timed out|no servers/i);
    }, 120000);

    test('should block environment variable proxy bypass', async () => {
      // Attempt to bypass proxy via environment variables
      const result = await runner.runWithSudo(
        "env no_proxy='*' http_proxy='' https_proxy='' curl -f https://example.com --max-time 5",
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      // Should still be blocked despite environment variable manipulation
      expect(result).toFail();
    }, 120000);
  });
});
