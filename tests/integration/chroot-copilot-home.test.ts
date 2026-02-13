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
 *
 * OPTIMIZATION: All 3 tests share the same allowDomains and are batched
 * into a single AWF invocation. Reduces 3 invocations to 1.
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';
import { runBatch, BatchResults } from '../fixtures/batch-runner';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('Chroot Copilot Home Directory Access', () => {
  let runner: AwfRunner;
  let batch: BatchResults;

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();

    // Ensure ~/.copilot exists on the host (as the workflow does)
    const testCopilotDir = path.join(os.homedir(), '.copilot');
    if (!fs.existsSync(testCopilotDir)) {
      fs.mkdirSync(testCopilotDir, { recursive: true, mode: 0o755 });
    }

    batch = await runBatch(runner, [
      {
        name: 'write_file',
        command: 'mkdir -p ~/.copilot/test && echo "test-content" > ~/.copilot/test/file.txt && cat ~/.copilot/test/file.txt',
      },
      {
        name: 'nested_dirs',
        command: 'mkdir -p ~/.copilot/pkg/linux-x64/0.0.405 && echo "package-extracted" > ~/.copilot/pkg/linux-x64/0.0.405/marker.txt && cat ~/.copilot/pkg/linux-x64/0.0.405/marker.txt',
      },
      {
        name: 'permissions',
        command: 'touch ~/.copilot/write-test && rm ~/.copilot/write-test && echo "write-success"',
      },
    ], {
      allowDomains: ['localhost'],
      logLevel: 'debug',
      timeout: 60000,
    });
  }, 120000);

  afterAll(async () => {
    await cleanup(false);
  });

  test('should be able to write to ~/.copilot directory', () => {
    const r = batch.get('write_file');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('test-content');
  });

  test('should be able to create nested directories in ~/.copilot', () => {
    const r = batch.get('nested_dirs');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('package-extracted');
  });

  test('should verify ~/.copilot is writable with correct permissions', () => {
    const r = batch.get('permissions');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('write-success');
  });
});
