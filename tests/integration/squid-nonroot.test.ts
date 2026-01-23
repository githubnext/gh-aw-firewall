import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';
import execa from 'execa';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Integration test to verify Squid container runs as non-root user
 * Addresses security requirement: https://github.com/githubnext/gh-aw-firewall/issues/228
 */
describe('Squid Container Non-Root User', () => {
  let runner: AwfRunner;

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();
  });

  afterAll(async () => {
    await cleanup(false);
  });

  it('should run Squid container as proxy user (UID 13)', async () => {
    // Run a simple command to start the containers
    const result = await runner.runWithSudo(
      'echo "test command"',
      {
        allowDomains: ['example.com'],
        buildLocal: true,  // Build locally to use updated Dockerfile
        keepContainers: true,  // Keep containers running for inspection
        timeout: 60000,
      }
    );

    try {
      // Command should succeed
      if (!result.success) {
        console.error('Command failed. Exit code:', result.exitCode);
        console.error('Stdout:', result.stdout);
        console.error('Stderr:', result.stderr);
      }
      expect(result.success).toBe(true);

      // Inspect the Squid container to verify it runs as proxy user
      const inspectResult = await execa('docker', [
        'inspect',
        'awf-squid',
        '--format={{.Config.User}}'
      ]);

      // Should be running as proxy user
      expect(inspectResult.stdout.trim()).toBe('proxy');

      // Verify the container is actually running as UID 13 by executing a command
      const idResult = await execa('docker', [
        'exec',
        'awf-squid',
        'id',
        '-u'
      ]);

      expect(idResult.stdout.trim()).toBe('13');

      // Verify logs can be written by the proxy user
      const logsResult = await execa('docker', [
        'exec',
        'awf-squid',
        'ls',
        '-la',
        '/var/log/squid'
      ]);

      // Log directory should be owned by proxy user
      expect(logsResult.stdout).toContain('proxy');

    } finally {
      // Clean up containers
      await cleanup(false);
    }
  }, 90000);

  it('should not require root privileges for permission changes', async () => {
    // Verify the entrypoint script doesn't execute chown/chmod commands that require root
    const entrypointPath = path.join(__dirname, '..', '..', 'containers', 'squid', 'entrypoint.sh');
    const entrypointContent = await fs.readFile(entrypointPath, 'utf-8');

    // Should not execute chown or chmod commands (comments are okay)
    // Match actual command execution, not comments
    expect(entrypointContent).not.toMatch(/^\s*chown\s/m);
    expect(entrypointContent).not.toMatch(/^\s*chmod\s/m);
    
    // Should verify it's running as proxy user
    expect(entrypointContent).toContain('id -un');
    expect(entrypointContent).toContain('proxy');
  });

  it('should have USER directive in Dockerfile', async () => {
    // Verify the Dockerfile uses USER directive
    const dockerfilePath = path.join(__dirname, '..', '..', 'containers', 'squid', 'Dockerfile');
    const dockerfileContent = await fs.readFile(dockerfilePath, 'utf-8');

    // Should have USER proxy directive
    expect(dockerfileContent).toMatch(/^USER\s+proxy/m);
  });
});
