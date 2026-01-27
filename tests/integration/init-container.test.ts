/**
 * Init Container Pattern Tests
 *
 * These tests verify that the init container pattern is working correctly:
 * - iptables-setup container runs first with NET_ADMIN
 * - iptables-setup container exits successfully
 * - agent container runs without NET_ADMIN capability
 * - iptables rules are still enforced in agent container
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';

describe('Init Container Pattern', () => {
  let runner: AwfRunner;

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();
  });

  afterAll(async () => {
    await cleanup(false);
  });

  describe('Container Startup Order', () => {
    test('should start iptables-setup container before agent', async () => {
      // Run a simple command that should succeed
      const result = await runner.runWithSudo(
        'echo "Hello from agent container"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('Hello from agent container');
      
      // Check that iptables setup logs indicate it ran first
      expect(result.stderr).toContain('[iptables] Setting up NAT redirection to Squid proxy');
    }, 120000);

    test('should exit iptables-setup container after setup', async () => {
      const result = await runner.runWithSudo(
        'docker ps -a --filter "name=awf-iptables-setup" --format "{{.Status}}"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      // The init container should have exited (Exited (0))
      expect(result.stdout).toMatch(/Exited \(0\)/);
    }, 120000);
  });

  describe('Capability Verification', () => {
    test('should NOT have NET_ADMIN capability in agent container', async () => {
      // Check capabilities in the agent container
      // When NET_ADMIN is not present, iptables commands should fail
      const result = await runner.runWithSudo(
        'iptables -t nat -L OUTPUT -n 2>&1 || echo "iptables failed (expected)"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      // iptables should fail due to lack of CAP_NET_ADMIN
      expect(result.stdout).toContain('iptables failed (expected)');
    }, 120000);

    test('should prevent iptables modification attempts', async () => {
      const result = await runner.runWithSudo(
        'iptables -t nat -F OUTPUT 2>&1 || echo "flush blocked (no NET_ADMIN)"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('flush blocked (no NET_ADMIN)');
    }, 120000);
  });

  describe('Firewall Functionality', () => {
    test('should still enforce domain whitelist despite init container pattern', async () => {
      // Verify that iptables rules set up by init container are still enforced
      const result = await runner.runWithSudo(
        'curl -f https://example.com --max-time 5',
        {
          allowDomains: ['github.com'], // example.com is NOT allowed
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toFail();
      // Should be blocked by Squid proxy (403 Forbidden)
      expect(result.stderr).toContain('403');
    }, 120000);

    test('should allow whitelisted domains', async () => {
      const result = await runner.runWithSudo(
        'curl -f https://github.com --max-time 10',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
    }, 120000);

    test('should redirect HTTP/HTTPS traffic to Squid', async () => {
      // Verify that traffic redirection is working
      const result = await runner.runWithSudo(
        'curl -v https://github.com --max-time 10 2>&1 | grep -i "proxy"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      // Should show proxy connection in curl verbose output
      expect(result.stdout.toLowerCase()).toMatch(/proxy|via/);
    }, 120000);
  });

  describe('Network Namespace Sharing', () => {
    test('should share network namespace between init and agent containers', async () => {
      // The iptables rules set by init container should be visible in agent
      // We verify this indirectly by checking that the firewall works
      const result = await runner.runWithSudo(
        'curl -I https://github.com --max-time 10',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('HTTP/');
    }, 120000);
  });
});
