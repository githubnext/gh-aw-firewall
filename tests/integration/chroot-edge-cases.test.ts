/**
 * Chroot Edge Cases and Error Handling Tests
 *
 * These tests verify edge cases, security features, and error handling
 * for chroot mode.
 *
 * NOTE: stdout may contain entrypoint debug logs in addition to command output.
 * Use toContain() instead of exact matches, or check the last line of output.
 *
 * OPTIMIZATION: Tests sharing the same allowDomains + AWF options are batched
 * into single container invocations, reducing ~19 invocations to ~8.
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';
import { runBatch, BatchResults } from '../fixtures/batch-runner';

/**
 * Helper to get the last non-empty line from stdout (skips debug logs)
 */
function getLastLine(output: string): string {
  const lines = output.trim().split('\n').filter(line => line.trim() !== '');
  return lines[lines.length - 1] || '';
}

describe('Chroot Edge Cases', () => {
  let runner: AwfRunner;

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();
  });

  afterAll(async () => {
    await cleanup(false);
  });

  // ---------- Batch: all localhost tests that don't need special AWF options ----------
  describe('General checks (batched)', () => {
    let batch: BatchResults;

    beforeAll(async () => {
      batch = await runBatch(runner, [
        // Environment Variables
        { name: 'echo_path', command: 'echo $PATH' },
        { name: 'echo_home', command: 'echo $HOME' },
        // File System Access
        { name: 'ls_usr_bin', command: 'ls /usr/bin | head -5' },
        { name: 'cat_passwd', command: 'cat /etc/passwd | head -1' },
        { name: 'tmp_write', command: 'echo "test" > /tmp/chroot-test-$$ && cat /tmp/chroot-test-$$ && rm /tmp/chroot-test-$$' },
        { name: 'docker_socket', command: 'test -S /var/run/docker.sock && echo "has_socket" || echo "no_socket"' },
        // Capability Dropping
        { name: 'iptables', command: 'iptables -L 2>&1' },
        { name: 'chroot_cmd', command: 'chroot / /bin/true 2>&1' },
        // Shell Features
        { name: 'pipe', command: 'echo "hello world" | grep hello' },
        { name: 'redirect', command: 'echo "redirect test" > /tmp/redirect-test-$$ && cat /tmp/redirect-test-$$ && rm /tmp/redirect-test-$$' },
        { name: 'cmd_subst', command: 'echo "Today is $(date +%Y)"' },
        { name: 'compound', command: 'echo "first" && echo "second" && echo "third"' },
        // User Context
        { name: 'id_u', command: 'id -u' },
        { name: 'whoami', command: 'whoami' },
      ], {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 120000,
      });
    }, 180000);

    // Environment Variables
    test('should preserve PATH including tool cache paths', () => {
      const r = batch.get('echo_path');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('/usr/bin');
      expect(r.stdout).toContain('/bin');
    });

    test('should have HOME set correctly', () => {
      const r = batch.get('echo_home');
      expect(r.exitCode).toBe(0);
      const lastLine = getLastLine(r.stdout);
      expect(lastLine).toMatch(/^\//);
    });

    // Note: Custom environment variables via --env may not pass through to chroot mode
    // because the command runs through a script file. Standard env vars like PATH work.
    test.skip('should pass custom environment variables', () => {
      // Placeholder – would need individual invocation with env option
    });

    // File System Access
    test('should have read access to /usr', () => {
      expect(batch.get('ls_usr_bin').exitCode).toBe(0);
    });

    test('should have read access to /etc', () => {
      const r = batch.get('cat_passwd');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('root');
    });

    test('should have write access to /tmp', () => {
      const r = batch.get('tmp_write');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('test');
    });

    test('should have Docker socket hidden or inaccessible', () => {
      const r = batch.get('docker_socket');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('no_socket');
    });

    // Capability Dropping
    test('should not have NET_ADMIN capability', () => {
      const r = batch.get('iptables');
      expect(r.exitCode).not.toBe(0);
      expect(r.stdout).toMatch(/permission denied|Operation not permitted/i);
    });

    test('should not be able to use chroot command', () => {
      expect(batch.get('chroot_cmd').exitCode).not.toBe(0);
    });

    // Shell Features
    test('should support shell pipes', () => {
      const r = batch.get('pipe');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('hello');
    });

    test('should support shell redirection', () => {
      const r = batch.get('redirect');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('redirect test');
    });

    test('should support command substitution', () => {
      const r = batch.get('cmd_subst');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/Today is \d{4}/);
    });

    test('should support compound commands', () => {
      const r = batch.get('compound');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('first');
      expect(r.stdout).toContain('second');
      expect(r.stdout).toContain('third');
    });

    // User Context
    test('should run as non-root user', () => {
      const r = batch.get('id_u');
      expect(r.exitCode).toBe(0);
      const lastLine = getLastLine(r.stdout);
      const uid = parseInt(lastLine);
      expect(uid).not.toBe(0);
    });

    test('should have username set', () => {
      const r = batch.get('whoami');
      expect(r.exitCode).toBe(0);
      const lastLine = getLastLine(r.stdout);
      expect(lastLine).not.toBe('root');
    });
  });

  // ---------- Individual: Working directory tests (different containerWorkDir options) ----------
  describe('Working Directory Handling', () => {
    test('should respect container-workdir in chroot mode', async () => {
      const result = await runner.runWithSudo('pwd', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        containerWorkDir: '/tmp',
      });

      expect(result).toSucceed();
      expect(getLastLine(result.stdout)).toBe('/tmp');
    }, 120000);

    test('should fall back to home directory if workdir does not exist', async () => {
      const result = await runner.runWithSudo('pwd', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        containerWorkDir: '/nonexistent/directory/path',
      });

      expect(result).toSucceed();
      const lastLine = getLastLine(result.stdout);
      expect(lastLine).toMatch(/^\//);
    }, 120000);
  });

  // ---------- Individual: Exit code propagation (tests AWF process exit code) ----------
  describe('Exit Code Propagation', () => {
    test('should propagate exit code 0', async () => {
      const result = await runner.runWithSudo('exit 0', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
      });

      expect(result).toExitWithCode(0);
    }, 120000);

    test('should propagate exit code 1', async () => {
      const result = await runner.runWithSudo('exit 1', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
      });

      expect(result).toExitWithCode(1);
    }, 120000);

    test('should propagate exit code from failed command', async () => {
      const result = await runner.runWithSudo('false', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
      });

      expect(result).toExitWithCode(1);
    }, 120000);

    test('should propagate exit code 127 for command not found', async () => {
      const result = await runner.runWithSudo('nonexistent_command_xyz123', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
      });

      expect(result).toExitWithCode(127);
    }, 120000);
  });

  // ---------- Individual: Network tests (different domains per test) ----------
  describe('Network Firewall Enforcement', () => {
    test('should allow HTTPS to whitelisted domains', async () => {
      const result = await runner.runWithSudo('curl -s -o /dev/null -w "%{http_code}" https://api.github.com', {
        allowDomains: ['api.github.com'],
        logLevel: 'debug',
        timeout: 60000,
      });

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/200|301|302/);
    }, 120000);

    test('should block HTTPS to non-whitelisted domains', async () => {
      const result = await runner.runWithSudo('curl -s --connect-timeout 5 https://example.com 2>&1', {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 30000,
      });

      // Should fail or timeout
      expect(result).toFail();
    }, 60000);

    test('should block HTTP to non-whitelisted domains', async () => {
      const result = await runner.runWithSudo('curl -f --connect-timeout 5 http://example.com 2>&1', {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 30000,
      });

      // Should fail or timeout
      expect(result).toFail();
    }, 60000);
  });
});
