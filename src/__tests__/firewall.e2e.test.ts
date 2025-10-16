import execa from 'execa';
import path from 'path';

const CLI_PATH = path.join(__dirname, '../../dist/cli.js');

/**
 * End-to-end tests for awf network filtering
 * These tests run the actual CLI with real Docker containers and network isolation
 *
 * Prerequisites:
 * - Docker must be running
 * - npm run build must have been executed
 * - Tests must run with sudo (required for host-level iptables manipulation)
 * - Run with: sudo npm test -- firewall.e2e.test.ts
 */
describe('awf E2E network filtering', () => {
  beforeAll(() => {
    // Verify running with sudo
    if (process.getuid && process.getuid() !== 0) {
      throw new Error(
        'Tests must run with sudo for iptables manipulation. Run: sudo npm test -- firewall.e2e.test.ts'
      );
    }
  });

  const runFirewallWrapper = async (
    allowDomains: string[],
    command: string
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
    const args = [
      CLI_PATH,
      '--allow-domains',
      allowDomains.join(','),
      command,
    ];

    try {
      // Run as root (tests already running with sudo)
      const result = await execa(process.execPath, args, {
        reject: false,
        timeout: 60000, // 60 second timeout (increased for container pulls)
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for Docker build logs
      });
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error: any) {
      // Handle timeout or other execa errors
      return {
        exitCode: error.exitCode ?? 1,
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? error.message ?? '',
      };
    }
  };

  it('allows access to whitelisted domain (api.github.com)', async () => {
    const result = await runFirewallWrapper(
      ['api.github.com'],
      'curl -fsS https://api.github.com/zen'
    );

    expect(result.exitCode).toBe(0);
  }, 60000); // 60 second Jest timeout

  it('blocks access to non-whitelisted domain (example.com)', async () => {
    const result = await runFirewallWrapper(
      ['github.com'],
      'curl -f https://example.com'
    );

    expect(result.exitCode).not.toBe(0);
  }, 60000);

  it('allows subdomain access when parent domain is whitelisted', async () => {
    const result = await runFirewallWrapper(
      ['github.com'],
      'curl -fsS https://api.github.com/zen'
    );

    expect(result.exitCode).toBe(0);
  }, 60000);

  it('allows multiple whitelisted domains', async () => {
    const result = await runFirewallWrapper(
      ['github.com', 'npmjs.org'],
      'curl -fsS https://registry.npmjs.org/chalk/latest'
    );

    expect(result.exitCode).toBe(0);
  }, 60000);

  it('blocks when accessing blocked domain even with other domains whitelisted', async () => {
    const result = await runFirewallWrapper(
      ['github.com'],
      'curl -f https://google.com'
    );

    expect(result.exitCode).not.toBe(0);
  }, 60000);

  describe('docker-in-docker scenarios', () => {
    it('allows docker-spawned containers to access whitelisted domains', async () => {
      const result = await runFirewallWrapper(
        ['api.github.com', 'registry-1.docker.io', 'auth.docker.io', 'production.cloudflare.docker.com'],
        'docker run --rm curlimages/curl -fsS https://api.github.com/zen'
      );

      expect(result.exitCode).toBe(0);
      // Should return a GitHub zen quote
      expect(result.stdout.length).toBeGreaterThan(0);
    }, 120000); // Longer timeout for docker pull

    it('blocks docker-spawned containers from accessing non-whitelisted domains', async () => {
      const result = await runFirewallWrapper(
        ['registry-1.docker.io', 'auth.docker.io', 'production.cloudflare.docker.com'], // Only Docker registry, not GitHub
        'docker run --rm curlimages/curl -fsS https://api.github.com/zen'
      );

      // Should fail - Squid returns 403 for blocked domain
      expect(result.exitCode).not.toBe(0);
      // curl exits with 22 for HTTP errors (403)
      expect(result.exitCode).toBe(22);
    }, 120000);

    it('docker wrapper injects network and proxy configuration', async () => {
      const result = await runFirewallWrapper(
        ['example.com'],
        'docker run --rm alpine sh -c "echo wrapper test" && cat /tmp/docker-wrapper.log 2>/dev/null || echo "no log"'
      );

      // Check that wrapper was invoked
      expect(result.stdout).toContain('WRAPPER CALLED');
      expect(result.stdout).toContain('INJECTING --network');
    }, 120000);

    it('blocks --network host to prevent firewall bypass', async () => {
      const result = await runFirewallWrapper(
        ['github.com', 'registry-1.docker.io', 'auth.docker.io', 'production.cloudflare.docker.com'],
        'docker run --rm --network host curlimages/curl -f https://example.com'
      );

      // Should fail with exit code 1
      expect(result.exitCode).toBe(1);
      // Should show firewall error message (appears in stdout from container output)
      const output = result.stdout + result.stderr;
      expect(output).toContain('ERROR: --network host is not allowed');
    }, 120000);
  });
});
