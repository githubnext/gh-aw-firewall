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
  let testSubdir: string;

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();
    
    // Create a unique test subdirectory in ~/.copilot to avoid polluting real Copilot setup
    testCopilotDir = path.join(os.homedir(), '.copilot');
    testSubdir = path.join(testCopilotDir, `awf-test-${Date.now()}`);
    
    if (!fs.existsSync(testCopilotDir)) {
      fs.mkdirSync(testCopilotDir, { recursive: true, mode: 0o755 });
    }
  });

  afterAll(async () => {
    // Clean up test subdirectory
    if (fs.existsSync(testSubdir)) {
      fs.rmSync(testSubdir, { recursive: true, force: true });
    }
    await cleanup(false);
  });

  test('should be able to write to ~/.copilot directory', async () => {
    const testDir = `~/.copilot/awf-test-${Date.now()}`;
    const result = await runner.runWithSudo(
      `mkdir -p ${testDir}/test && echo "test-content" > ${testDir}/test/file.txt && cat ${testDir}/test/file.txt`,
      {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      }
    );

    expect(result).toSucceed();
    expect(result.stdout).toContain('test-content');
  }, 120000);

  test('should be able to create nested directories in ~/.copilot', async () => {
    // Simulate what Copilot CLI does: create pkg/linux-x64/VERSION with dynamic version
    const testVersion = `test-${Date.now()}`;
    const testDir = `~/.copilot/awf-test-${Date.now()}`;
    const result = await runner.runWithSudo(
      `mkdir -p ${testDir}/pkg/linux-x64/${testVersion} && echo "package-extracted" > ${testDir}/pkg/linux-x64/${testVersion}/marker.txt && cat ${testDir}/pkg/linux-x64/${testVersion}/marker.txt`,
      {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      }
    );

    expect(result).toSucceed();
    expect(result.stdout).toContain('package-extracted');
  }, 120000);

  test('should verify ~/.copilot is writable with correct permissions', async () => {
    const testFile = `~/.copilot/awf-test-write-${Date.now()}`;
    const result = await runner.runWithSudo(
      `touch ${testFile} && rm ${testFile} && echo "write-success"`,
      {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      }
    );

    expect(result).toSucceed();
    expect(result.stdout).toContain('write-success');
  }, 120000);
});
