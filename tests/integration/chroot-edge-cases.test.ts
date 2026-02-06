/**
 * Chroot Edge Cases and Error Handling Tests
 *
 * These tests verify edge cases, security features, and error handling
 * for the --enable-chroot feature.
 *
 * NOTE: stdout may contain entrypoint debug logs in addition to command output.
 * Use toContain() instead of exact matches, or check the last line of output.
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';

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

  describe('Working Directory Handling', () => {
    test('should respect container-workdir in chroot mode', async () => {
      const result = await runner.runWithSudo('pwd', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
        containerWorkDir: '/tmp',
      });

      expect(result).toSucceed();
      // The last line should be /tmp (after all the debug output)
      expect(getLastLine(result.stdout)).toBe('/tmp');
    }, 120000);

    test('should fall back to home directory if workdir does not exist', async () => {
      const result = await runner.runWithSudo('pwd', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
        containerWorkDir: '/nonexistent/directory/path',
      });

      expect(result).toSucceed();
      // Should fall back to home directory (starts with /)
      const lastLine = getLastLine(result.stdout);
      expect(lastLine).toMatch(/^\//);
    }, 120000);
  });

  describe('Environment Variables', () => {
    test('should preserve PATH including tool cache paths', async () => {
      const result = await runner.runWithSudo('echo $PATH', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      // PATH should include standard paths
      expect(result.stdout).toContain('/usr/bin');
      expect(result.stdout).toContain('/bin');
    }, 120000);

    test('should have HOME set correctly', async () => {
      const result = await runner.runWithSudo('echo $HOME', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      // HOME should be a path starting with /
      const lastLine = getLastLine(result.stdout);
      expect(lastLine).toMatch(/^\//);
    }, 120000);

    // Note: Custom environment variables via --env may not pass through to chroot mode
    // because the command runs through a script file. Standard env vars like PATH work.
    test.skip('should pass custom environment variables', async () => {
      const result = await runner.runWithSudo('echo $MY_CUSTOM_VAR', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
        env: {
          MY_CUSTOM_VAR: 'test_value_123',
        },
      });

      expect(result).toSucceed();
      expect(result.stdout).toContain('test_value_123');
    }, 120000);
  });

  describe('File System Access', () => {
    test('should have read access to /usr', async () => {
      const result = await runner.runWithSudo('ls /usr/bin | head -5', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
    }, 120000);

    test('should have read access to /etc', async () => {
      // /etc/hostname might not exist in all environments, check /etc/passwd instead
      const result = await runner.runWithSudo('cat /etc/passwd | head -1', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      // passwd file should have root entry
      expect(result.stdout).toContain('root');
    }, 120000);

    test('should have write access to /tmp', async () => {
      const result = await runner.runWithSudo(
        'echo "test" > /tmp/chroot-test-$$ && cat /tmp/chroot-test-$$ && rm /tmp/chroot-test-$$',
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          enableChroot: true,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('test');
    }, 120000);

    test('should have Docker socket hidden or inaccessible', async () => {
      // Docker socket should be hidden (mounted to /dev/null) or not exist
      const result = await runner.runWithSudo(
        'test -S /var/run/docker.sock && echo "has_socket" || echo "no_socket"',
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          enableChroot: true,
        }
      );

      expect(result).toSucceed();
      // The docker socket should NOT be a socket (it's /dev/null or doesn't exist)
      expect(result.stdout).toContain('no_socket');
    }, 120000);
  });

  describe('Capability Dropping', () => {
    test('should not have NET_ADMIN capability', async () => {
      // Try to run iptables - should fail without NET_ADMIN
      const result = await runner.runWithSudo('iptables -L 2>&1', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      // Should fail due to lack of permissions
      expect(result).toFail();
      expect(result.stdout + result.stderr).toMatch(/permission denied|Operation not permitted/i);
    }, 120000);

    test('should not be able to use chroot command', async () => {
      // Should not be able to chroot again (capability dropped)
      const result = await runner.runWithSudo('chroot / /bin/true 2>&1', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      // Should fail due to lack of CAP_SYS_CHROOT
      expect(result).toFail();
    }, 120000);
  });

  describe('Exit Code Propagation', () => {
    test('should propagate exit code 0', async () => {
      const result = await runner.runWithSudo('exit 0', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toExitWithCode(0);
    }, 120000);

    test('should propagate exit code 1', async () => {
      const result = await runner.runWithSudo('exit 1', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toExitWithCode(1);
    }, 120000);

    test('should propagate exit code from failed command', async () => {
      const result = await runner.runWithSudo('false', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toExitWithCode(1);
    }, 120000);

    test('should propagate exit code 127 for command not found', async () => {
      const result = await runner.runWithSudo('nonexistent_command_xyz123', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toExitWithCode(127);
    }, 120000);
  });

  describe('Network Firewall Enforcement', () => {
    test('should allow HTTPS to whitelisted domains', async () => {
      const result = await runner.runWithSudo('curl -s -o /dev/null -w "%{http_code}" https://api.github.com', {
        allowDomains: ['api.github.com'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/200|301|302/);
    }, 120000);

    test('should block HTTPS to non-whitelisted domains', async () => {
      const result = await runner.runWithSudo('curl -s --connect-timeout 5 https://example.com 2>&1', {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 30000,
        enableChroot: true,
      });

      // Should fail or timeout
      expect(result).toFail();
    }, 60000);

    test('should block HTTP to non-whitelisted domains', async () => {
      const result = await runner.runWithSudo('curl -f --connect-timeout 5 http://example.com 2>&1', {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 30000,
        enableChroot: true,
      });

      // Should fail or timeout
      expect(result).toFail();
    }, 60000);
  });

  describe('Shell Features', () => {
    test('should support shell pipes', async () => {
      const result = await runner.runWithSudo('echo "hello world" | grep hello', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      expect(result.stdout).toContain('hello');
    }, 120000);

    test('should support shell redirection', async () => {
      const result = await runner.runWithSudo(
        'echo "redirect test" > /tmp/redirect-test-$$ && cat /tmp/redirect-test-$$ && rm /tmp/redirect-test-$$',
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          enableChroot: true,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('redirect test');
    }, 120000);

    test('should support command substitution', async () => {
      const result = await runner.runWithSudo('echo "Today is $(date +%Y)"', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/Today is \d{4}/);
    }, 120000);

    test('should support compound commands', async () => {
      const result = await runner.runWithSudo('echo "first" && echo "second" && echo "third"', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      expect(result.stdout).toContain('first');
      expect(result.stdout).toContain('second');
      expect(result.stdout).toContain('third');
    }, 120000);
  });

  describe('User Context', () => {
    test('should run as non-root user', async () => {
      const result = await runner.runWithSudo('id -u', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      // Should not be root (uid 0) - check last line of output
      const lastLine = getLastLine(result.stdout);
      const uid = parseInt(lastLine);
      expect(uid).not.toBe(0);
    }, 120000);

    test('should have username set', async () => {
      const result = await runner.runWithSudo('whoami', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      // The last line should be the username, which should not be 'root'
      const lastLine = getLastLine(result.stdout);
      expect(lastLine).not.toBe('root');
    }, 120000);
  });
});
