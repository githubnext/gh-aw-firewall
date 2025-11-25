/**
 * Claude Code Integration Tests
 *
 * These tests verify that Claude Code (@anthropic-ai/claude-code) can run
 * through the AWF firewall with proper domain whitelisting and --tty support.
 *
 * Requirements:
 * - ANTHROPIC_API_KEY environment variable must be set
 * - --tty flag must be enabled (required for Claude Code to avoid hanging)
 * - Required domains: anthropic.com, statsig.anthropic.com, sentry.io, registry.npmjs.org
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';

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

  test('Test 1: Basic Claude Code execution with arithmetic prompt', async () => {
    const result = await runner.runWithSudo(
      'npx -y @anthropic-ai/claude-code --print "what is 2+2"',
      {
        allowDomains: [
          'anthropic.com',
          'statsig.anthropic.com',
          'sentry.io',
          'registry.npmjs.org'
        ],
        tty: true, // Required for Claude Code to avoid hanging
        logLevel: 'debug',
        timeout: 120000, // 2 minutes
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || ''
        }
      }
    );

    expect(result).toSucceed();
    // Claude should provide an answer containing "4"
    expect(result.stdout.toLowerCase()).toMatch(/4/);
  }, 180000); // 3 minutes timeout

  test('Test 2: Claude Code without --tty flag should timeout/hang', async () => {
    // This test demonstrates the bug that was fixed by adding --tty flag
    // Without --tty, Claude Code hangs indefinitely
    const result = await runner.runWithSudo(
      'npx -y @anthropic-ai/claude-code --print "what is 2+2"',
      {
        allowDomains: [
          'anthropic.com',
          'statsig.anthropic.com',
          'sentry.io',
          'registry.npmjs.org'
        ],
        tty: false, // Explicitly disable TTY
        logLevel: 'debug',
        timeout: 30000, // 30 seconds - should timeout
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || ''
        }
      }
    );

    // Should timeout because Claude Code hangs without TTY
    expect(result.timedOut).toBe(true);
  }, 60000); // 1 minute timeout

  test('Test 3: Block requests when anthropic.com is not in allowlist', async () => {
    const result = await runner.runWithSudo(
      'npx -y @anthropic-ai/claude-code --print "what is 2+2"',
      {
        allowDomains: [
          'registry.npmjs.org' // Only allow npm, not Anthropic API
        ],
        tty: true,
        logLevel: 'debug',
        timeout: 60000,
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || ''
        }
      }
    );

    // Should fail because anthropic.com is not allowed
    expect(result).toFail();
    expect(result.exitCode).not.toBe(0);
  }, 120000);

  test('Test 4: Verify subdomain matching for anthropic.com', async () => {
    // anthropic.com should match api.anthropic.com, cdn.anthropic.com, etc.
    const result = await runner.runWithSudo(
      'bash -c "curl -f --max-time 10 https://api.anthropic.com/v1/messages"',
      {
        allowDomains: ['anthropic.com'], // Should match api.anthropic.com
        tty: false, // Not needed for simple curl
        logLevel: 'debug',
        timeout: 30000
      }
    );

    // Should fail with 401 (auth error) not 403 (firewall block)
    // because domain is allowed but we don't have valid auth
    expect(result).toFail();
    expect(result.exitCode).not.toBe(0);
    // If it was blocked by firewall, curl would show connection error
    // If it reaches API, we get 401/403 from Anthropic
    expect(result.stderr).not.toContain('Could not resolve host');
  }, 60000);

  test('Test 5: Exit code propagation from Claude Code', async () => {
    // Test that exit codes are properly propagated through the firewall
    const result = await runner.runWithSudo(
      'npx -y @anthropic-ai/claude-code --print "hello" 2>&1 | grep -q "Error" && exit 1 || exit 0',
      {
        allowDomains: [
          'anthropic.com',
          'statsig.anthropic.com',
          'sentry.io',
          'registry.npmjs.org'
        ],
        tty: true,
        logLevel: 'debug',
        timeout: 120000,
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || ''
        }
      }
    );

    // Should succeed (exit 0) if no error in output
    expect(result).toSucceed();
  }, 180000);

  test('Test 6: Verify npm registry access for npx', async () => {
    // Verify that registry.npmjs.org is accessible for downloading Claude Code package
    const result = await runner.runWithSudo(
      'curl -f --max-time 10 https://registry.npmjs.org/@anthropic-ai/claude-code',
      {
        allowDomains: ['registry.npmjs.org'],
        tty: false,
        logLevel: 'debug',
        timeout: 30000
      }
    );

    expect(result).toSucceed();
    expect(result.stdout).toContain('"name":"@anthropic-ai/claude-code"');
  }, 60000);

  test('Test 7: Verify all required domains together', async () => {
    // Comprehensive test with all required domains
    const result = await runner.runWithSudo(
      'bash -c "curl -f https://registry.npmjs.org && curl -f https://anthropic.com && curl -f https://statsig.anthropic.com/healthcheck"',
      {
        allowDomains: [
          'anthropic.com',
          'statsig.anthropic.com',
          'sentry.io',
          'registry.npmjs.org'
        ],
        tty: false,
        logLevel: 'debug',
        timeout: 60000
      }
    );

    // All domains should be accessible
    expect(result).toSucceed();
  }, 120000);
});
