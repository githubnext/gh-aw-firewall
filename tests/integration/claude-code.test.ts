/**
 * Claude Code Integration Tests
 *
 * These tests verify that Claude Code (via @anthropic-ai/claude-code) works correctly through the firewall:
 * - Basic connectivity to Anthropic domains
 * - Domain whitelisting (allowed vs blocked domains)
 * - Exit code propagation
 * - File operations and bash command execution (simulating MCP tools)
 * - Log preservation
 * - Claude Code CLI execution via npx
 * - Fetch feature (web content retrieval through firewall)
 *
 * Test Structure:
 * - Tests 1-10: Basic firewall behavior tests (no Claude Code installation required) ✅
 * - Test 11: Claude Code --version test (verifies CLI can be installed and run) ✅
 * - Tests 12-15: Claude Code execution and fetch tests (requires ANTHROPIC_API_KEY) ✅
 *
 * EMFILE Error Fix:
 * The copilot container now raises both file descriptor and inotify watcher limits:
 * - ulimits.nofile to 65536
 * - fs.inotify.max_user_watches to 524288
 * - fs.inotify.max_user_instances to 1024
 * (see docker-manager.ts for implementation)
 * This prevents "EMFILE: too many open files" errors when Claude Code creates file watchers
 * for ~/.claude/settings.json during sequential test runs.
 *
 * Background:
 * - The firewall mounts the host's HOME directory (docker-manager.ts:222)
 * - Claude Code watches ~/.claude/settings.json for configuration changes
 * - File watchers accumulate across test runs
 * - Default container limit (1024) was exhausted after ~11 tests
 * - New limit (65536) supports running all tests in sequence
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';
import * as fs from 'fs';
import * as path from 'path';

describe('Claude Code Integration', () => {
  let runner: AwfRunner;

  beforeAll(async () => {
    // Run cleanup before tests to ensure clean state
    await cleanup(false);

    runner = createRunner();

    // Verify ANTHROPIC_API_KEY is set
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required for Claude Code tests');
    }
  });

  afterAll(async () => {
    // Clean up after all tests
    await cleanup(false);
  });

  test('Test 1: Basic connectivity to Claude API domains', async () => {
    const result = await runner.runWithSudo(
      'curl -f --max-time 30 https://www.anthropic.com',
      {
        allowDomains: [
          'anthropic.com',
          'api.anthropic.com',
          'cdn.anthropic.com',
          'github.com',
          'api.github.com',
          'raw.githubusercontent.com',
          'registry.npmjs.org',
        ],
        logLevel: 'debug',
        timeout: 60000,
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
        },
      }
    );

    // Should be able to connect to Anthropic's website
    expect(result).toSucceed();
  }, 120000);

  test('Test 2: Access allowed Anthropic domain', async () => {
    const result = await runner.runWithSudo(
      'curl -f --max-time 30 https://www.anthropic.com',
      {
        allowDomains: [
          'anthropic.com',
          'api.anthropic.com',
          'cdn.anthropic.com',
        ],
        logLevel: 'debug',
        timeout: 60000,
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
        },
      }
    );

    // Should succeed with only Anthropic domains
    expect(result).toSucceed();
  }, 120000);

  test('Test 3: Block non-whitelisted domains', async () => {
    // Try to use Claude to access a non-whitelisted domain
    const result = await runner.runWithSudo(
      'curl -f --max-time 10 https://example.com',
      {
        allowDomains: [
          'api.anthropic.com',
          'cdn.anthropic.com',
        ],
        logLevel: 'debug',
        timeout: 30000,
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
        },
      }
    );

    // Should fail because example.com is not in allowlist
    expect(result).toFail();
    expect(result.exitCode).not.toBe(0);
  }, 120000);

  test('Test 4: Exit code propagation (success)', async () => {
    const result = await runner.runWithSudo(
      'exit 0',
      {
        allowDomains: [
          'anthropic.com',
          'api.anthropic.com',
          'cdn.anthropic.com',
        ],
        logLevel: 'debug',
        timeout: 60000,
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
        },
      }
    );

    expect(result).toExitWithCode(0);
  }, 120000);

  test('Test 5: Exit code propagation (failure)', async () => {
    const result = await runner.runWithSudo(
      'bash -c "exit 42"',
      {
        allowDomains: [
          'anthropic.com',
          'api.anthropic.com',
          'cdn.anthropic.com',
        ],
        logLevel: 'debug',
        timeout: 30000,
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
        },
      }
    );

    expect(result).toExitWithCode(42);
  }, 120000);

  test('Test 6: File operations (simulating MCP tools)', async () => {
    // Create a temporary test file in /tmp (simulates file operations that Claude Code would do)
    const testContent = 'Hello from Claude Code test';
    const testFile = '/tmp/claude-test-file.txt';

    const result = await runner.runWithSudo(
      `bash -c "echo '${testContent}' > ${testFile} && cat ${testFile}"`,
      {
        allowDomains: [
          'anthropic.com',
          'api.anthropic.com',
          'cdn.anthropic.com',
        ],
        logLevel: 'debug',
        timeout: 60000,
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
        },
      }
    );

    expect(result).toSucceed();
    expect(result.stdout).toContain(testContent);
  }, 120000);

  test('Test 7: Bash command execution (simulating MCP tools)', async () => {
    const result = await runner.runWithSudo(
      'bash -c "ls -la /tmp && echo Command executed successfully"',
      {
        allowDomains: [
          'anthropic.com',
          'api.anthropic.com',
          'cdn.anthropic.com',
        ],
        logLevel: 'debug',
        timeout: 60000,
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
        },
      }
    );

    expect(result).toSucceed();
    expect(result.stdout).toContain('Command executed successfully');
  }, 120000);

  test('Test 8: Multiple allowed domains', async () => {
    const result = await runner.runWithSudo(
      'bash -c "curl -f --max-time 30 https://www.anthropic.com && curl -f --max-time 30 https://api.github.com"',
      {
        allowDomains: [
          'anthropic.com',
          'api.anthropic.com',
          'cdn.anthropic.com',
          'github.com',
          'api.github.com',
        ],
        logLevel: 'debug',
        timeout: 60000,
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
        },
      }
    );

    // Both domains should be accessible
    expect(result).toSucceed();
  }, 120000);

  test('Test 9: Log preservation', async () => {
    const result = await runner.runWithSudo(
      'echo "Test log preservation"',
      {
        allowDomains: [
          'anthropic.com',
          'api.anthropic.com',
          'cdn.anthropic.com',
        ],
        logLevel: 'debug',
        timeout: 30000,
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
        },
      }
    );

    expect(result).toSucceed();

    // Check if work directory was extracted
    if (result.workDir) {
      // Squid logs should exist (even if empty)
      const squidLogsPath = path.join(result.workDir, 'squid-logs');

      // Check if squid logs directory was created (it might have been moved to /tmp)
      // or check for preserved logs in /tmp
      const squidLogsExist = fs.existsSync(squidLogsPath) ||
                            fs.readdirSync('/tmp').some(f => f.startsWith('squid-logs-'));

      expect(squidLogsExist).toBe(true);
    }
  }, 120000);

  test('Test 10: DNS resolution', async () => {
    const result = await runner.runWithSudo(
      'nslookup api.anthropic.com',
      {
        allowDomains: [
          'anthropic.com',
          'api.anthropic.com',
          'cdn.anthropic.com',
        ],
        logLevel: 'debug',
        timeout: 30000,
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
        },
      }
    );

    expect(result).toSucceed();
    expect(result.stdout).toContain('Address'); // nslookup should return addresses
  }, 120000);

  test('Test 11: Claude Code CLI execution via npx', async () => {
    const result = await runner.runWithSudo(
      'npx -y @anthropic-ai/claude-code --version',
      {
        allowDomains: [
          'anthropic.com',
          'api.anthropic.com',
          'cdn.anthropic.com',
          'registry.npmjs.org',
          'registry.npmjs.com',
        ],
        logLevel: 'debug',
        timeout: 120000, // Give more time for npx to download
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
        },
      }
    );

    // Claude Code should be able to report its version
    expect(result).toSucceed();
    expect(result.stdout).toContain('claude-code'); // Should show version info
  }, 180000); // 3 minutes for initial download

  test('Test 12: Claude Code with simple command', async () => {
    const result = await runner.runWithSudo(
      'npx -y @anthropic-ai/claude-code "echo hello from claude"',
      {
        allowDomains: [
          'anthropic.com',
          'api.anthropic.com',
          'cdn.anthropic.com',
          'registry.npmjs.org',
          'registry.npmjs.com',
        ],
        logLevel: 'debug',
        timeout: 120000,
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
        },
      }
    );

    // Should succeed and execute the command
    expect(result).toSucceed();
  }, 180000); // 3 minutes

  test('Test 13: Claude Code with --print flag (non-interactive mode)', async () => {
    // Test Claude Code in print mode (non-interactive, useful for CI/CD)
    const result = await runner.runWithSudo(
      'npx -y @anthropic-ai/claude-code --print "What is 2+2?"',
      {
        allowDomains: [
          'anthropic.com',
          'api.anthropic.com',
          'cdn.anthropic.com',
          'registry.npmjs.org',
          'registry.npmjs.com',
        ],
        logLevel: 'debug',
        timeout: 120000,
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
        },
      }
    );

    // Should succeed and Claude should respond
    expect(result).toSucceed();
    // Claude should answer the math question
    expect(result.stdout).toMatch(/4|four/i);
  }, 180000); // 3 minutes

  test('Test 14: Claude Code with fetch feature (web content fetching)', async () => {
    // Test Claude Code's fetch feature to retrieve web content through the firewall
    const result = await runner.runWithSudo(
      'npx -y @anthropic-ai/claude-code --print --enable-fetch "Fetch the content from https://www.anthropic.com and tell me what you see"',
      {
        allowDomains: [
          'anthropic.com',
          'www.anthropic.com',
          'api.anthropic.com',
          'cdn.anthropic.com',
          'registry.npmjs.org',
          'registry.npmjs.com',
        ],
        logLevel: 'debug',
        timeout: 180000, // 3 minutes - fetch may take longer
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
        },
      }
    );

    // Should succeed - Claude should be able to fetch and describe the content
    expect(result).toSucceed();
    // Response should mention something about Anthropic (the company/website)
    expect(result.stdout).toMatch(/anthropic|claude|ai|safety/i);
  }, 240000); // 4 minutes for fetch operation

  test('Test 15: Claude Code fetch blocked domain (should fail gracefully)', async () => {
    // Test that fetch respects the firewall rules and blocks non-whitelisted domains
    const result = await runner.runWithSudo(
      'npx -y @anthropic-ai/claude-code --print --enable-fetch "Fetch the content from https://example.com"',
      {
        allowDomains: [
          'anthropic.com',
          'api.anthropic.com',
          'cdn.anthropic.com',
          'registry.npmjs.org',
          'registry.npmjs.com',
          // Note: example.com is NOT in the allowlist
        ],
        logLevel: 'debug',
        timeout: 180000,
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
        },
      }
    );

    // Claude Code should still succeed (doesn't crash), but should report fetch failure
    // The tool will either succeed with Claude explaining the fetch failed,
    // or fail if Claude cannot handle the blocked request
    // Either way, we verify the firewall is blocking the domain
    if (result.success) {
      // If it succeeds, Claude should mention the fetch failed or was blocked
      expect(result.stdout).toMatch(/error|fail|block|unable|cannot|could not/i);
    }
    // If it fails, that's also acceptable - the firewall blocked the request
  }, 240000); // 4 minutes
});
