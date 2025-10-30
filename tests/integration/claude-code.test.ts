/**
 * Claude Code Tests
 *
 * These tests verify firewall functionality with Claude API:
 * - Claude API domain whitelisting (api.anthropic.com)
 * - Subdomain matching for Anthropic domains
 * - SDK installation through npm
 * - API connectivity through the firewall
 * - Exit code propagation with Claude commands
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';

describe('Claude Code Functionality', () => {
  let runner: AwfRunner;

  beforeAll(async () => {
    // Run cleanup before tests to ensure clean state
    await cleanup(false);

    runner = createRunner();
  });

  afterAll(async () => {
    // Clean up after all tests
    await cleanup(false);
  });

  test('Test 1: Claude API domain is accessible when whitelisted', async () => {
    const result = await runner.runWithSudo(
      'curl -v -f --max-time 30 https://api.anthropic.com',
      {
        allowDomains: ['anthropic.com'],
        logLevel: 'debug',
        timeout: 30000,
      }
    );

    expect(result).toSucceed();
    expect(result.stdout).toContain('HTTP'); // curl should succeed
  }, 120000);

  test('Test 2: Block Claude API when domain not whitelisted', async () => {
    const result = await runner.runWithSudo(
      'curl -v -f --max-time 10 https://api.anthropic.com',
      {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 30000,
      }
    );

    // Should fail because anthropic.com is not in allowlist
    expect(result).toFail();
    expect(result.exitCode).not.toBe(0);
  }, 120000);

  test('Test 3: Multiple domains including Claude API', async () => {
    const result = await runner.runWithSudo(
      'bash -c "curl -f https://api.github.com && curl -f https://api.anthropic.com"',
      {
        allowDomains: ['github.com', 'anthropic.com'],
        logLevel: 'debug',
        timeout: 30000,
      }
    );

    expect(result).toSucceed();
  }, 120000);

  test('Test 4: Subdomain matching for Anthropic domains', async () => {
    // api.anthropic.com should be allowed when anthropic.com is in the allowlist
    const result = await runner.runWithSudo(
      'curl -f --max-time 30 https://api.anthropic.com',
      {
        allowDomains: ['anthropic.com'],
        logLevel: 'debug',
        timeout: 30000,
      }
    );

    expect(result).toSucceed();
  }, 120000);

  test('Test 5: Install Anthropic SDK through firewall', async () => {
    // Test that npm can install the Anthropic SDK with proper domains
    const result = await runner.runWithSudo(
      'bash -c "mkdir -p /tmp/claude-test && cd /tmp/claude-test && npm init -y && npm install --no-save @anthropic-ai/sdk"',
      {
        allowDomains: ['registry.npmjs.org', 'anthropic.com'],
        logLevel: 'debug',
        timeout: 60000,
      }
    );

    expect(result).toSucceed();
  }, 180000);

  test('Test 6: DNS resolution for Anthropic domains', async () => {
    const result = await runner.runWithSudo('nslookup api.anthropic.com', {
      allowDomains: ['anthropic.com'],
      logLevel: 'debug',
      timeout: 30000,
    });

    expect(result).toSucceed();
    expect(result.stdout).toContain('Address'); // nslookup should return addresses
  }, 120000);

  test('Test 7: Exit code propagation with Claude commands', async () => {
    const result = await runner.runWithSudo(
      'bash -c "curl -f https://api.anthropic.com && exit 0"',
      {
        allowDomains: ['anthropic.com'],
        logLevel: 'debug',
        timeout: 30000,
      }
    );

    expect(result).toExitWithCode(0);
  }, 120000);

  test('Test 8: Combined GitHub and Claude domains', async () => {
    // Test real-world scenario with both GitHub and Anthropic domains
    const result = await runner.runWithSudo(
      'bash -c "curl -f https://api.github.com && curl -f https://api.anthropic.com && echo Success"',
      {
        allowDomains: ['github.com', 'anthropic.com', 'githubusercontent.com'],
        logLevel: 'debug',
        timeout: 30000,
      }
    );

    expect(result).toSucceed();
    expect(result.stdout).toContain('Success');
  }, 120000);
});
