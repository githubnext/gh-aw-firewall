/**
 * Chroot Copilot Home Directory Tests
 *
 * These tests verify that the GitHub Copilot CLI can access and write
 * to ~/.copilot directory in chroot mode. This is essential for:
 * - Package extraction (CLI extracts bundled packages to ~/.copilot/pkg)
 * - Configuration storage
 * - Log file management
 *
 * The fix mounts ~/.copilot at /host~/.copilot in chroot mode to enable
 * write access while maintaining security (no full HOME mount).
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('Chroot Copilot Home Directory Access', () => {
  let runner: AwfRunner;
  let testCopilotDir: string;

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();
    
    // Ensure ~/.copilot exists on the host (as the workflow does)
    testCopilotDir = path.join(os.homedir(), '.copilot');
    if (!fs.existsSync(testCopilotDir)) {
      fs.mkdirSync(testCopilotDir, { recursive: true, mode: 0o755 });
    }
  });

  afterAll(async () => {
    await cleanup(false);
  });

  test('should be able to write to ~/.copilot directory', async () => {
    const result = await runner.runWithSudo(
      'mkdir -p ~/.copilot/test && echo "test-content" > ~/.copilot/test/file.txt && cat ~/.copilot/test/file.txt',
      {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
      }
    );

    expect(result).toSucceed();
    expect(result.stdout).toContain('test-content');
  }, 120000);

  test('should be able to create nested directories in ~/.copilot', async () => {
    // Simulate what Copilot CLI does: create pkg/linux-x64/VERSION
    const result = await runner.runWithSudo(
      'mkdir -p ~/.copilot/pkg/linux-x64/0.0.405 && echo "package-extracted" > ~/.copilot/pkg/linux-x64/0.0.405/marker.txt && cat ~/.copilot/pkg/linux-x64/0.0.405/marker.txt',
      {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
      }
    );

    expect(result).toSucceed();
    expect(result.stdout).toContain('package-extracted');
  }, 120000);

  test('should verify ~/.copilot is writable with correct permissions', async () => {
    const result = await runner.runWithSudo(
      'touch ~/.copilot/write-test && rm ~/.copilot/write-test && echo "write-success"',
      {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
      }
    );

    expect(result).toSucceed();
    expect(result.stdout).toContain('write-success');
  }, 120000);
});
