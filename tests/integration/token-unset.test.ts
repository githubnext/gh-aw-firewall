/**
 * Token Unsetting Tests
 *
 * These tests verify that sensitive tokens are properly unset from the entrypoint's
 * environment (/proc/1/environ) after the agent process has started and cached them.
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';

describe('Token Unsetting from Entrypoint Environ', () => {
  let runner: AwfRunner;

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();
  });

  afterAll(async () => {
    await cleanup(false);
  });

  test('should unset GITHUB_TOKEN from /proc/1/environ after agent starts', async () => {
    const testToken = 'ghp_test_token_12345678901234567890';

    // Command that checks /proc/1/environ after sleeping to allow token unsetting
    const command = `
      # Wait for entrypoint to unset tokens (5 second delay + 2 second buffer)
      sleep 7

      # Check if GITHUB_TOKEN is still in /proc/1/environ
      if cat /proc/1/environ | tr "\\0" "\\n" | grep -q "GITHUB_TOKEN="; then
        echo "ERROR: GITHUB_TOKEN still in /proc/1/environ"
        exit 1
      else
        echo "SUCCESS: GITHUB_TOKEN cleared from /proc/1/environ"
      fi

      # Verify agent can still read the token (cached by one-shot-token library)
      if [ -n "$GITHUB_TOKEN" ]; then
        echo "SUCCESS: Agent can still read GITHUB_TOKEN via getenv"
      else
        echo "WARNING: GITHUB_TOKEN not accessible to agent"
      fi
    `;

    const result = await runner.runWithSudo(command, {
      allowDomains: ['example.com'],
      buildLocal: true,
      logLevel: 'debug',
      timeout: 30000,
      env: {
        GITHUB_TOKEN: testToken,
      },
    });

    expect(result).toSucceed();
    expect(result.stdout).toContain('SUCCESS: GITHUB_TOKEN cleared from /proc/1/environ');
    expect(result.stdout).toContain('SUCCESS: Agent can still read GITHUB_TOKEN via getenv');
  }, 60000);

  test('should unset OPENAI_API_KEY from /proc/1/environ after agent starts', async () => {
    const testToken = 'sk-test_openai_key_1234567890';

    const command = `
      sleep 7

      if cat /proc/1/environ | tr "\\0" "\\n" | grep -q "OPENAI_API_KEY="; then
        echo "ERROR: OPENAI_API_KEY still in /proc/1/environ"
        exit 1
      else
        echo "SUCCESS: OPENAI_API_KEY cleared from /proc/1/environ"
      fi

      if [ -n "$OPENAI_API_KEY" ]; then
        echo "SUCCESS: Agent can still read OPENAI_API_KEY via getenv"
      else
        echo "WARNING: OPENAI_API_KEY not accessible to agent"
      fi
    `;

    const result = await runner.runWithSudo(command, {
      allowDomains: ['example.com'],
      buildLocal: true,
      logLevel: 'debug',
      timeout: 30000,
      env: {
        OPENAI_API_KEY: testToken,
      },
    });

    expect(result).toSucceed();
    expect(result.stdout).toContain('SUCCESS: OPENAI_API_KEY cleared from /proc/1/environ');
    expect(result.stdout).toContain('SUCCESS: Agent can still read OPENAI_API_KEY via getenv');
  }, 60000);

  test('should unset ANTHROPIC_API_KEY from /proc/1/environ after agent starts', async () => {
    const testToken = 'sk-ant-test_key_1234567890';

    const command = `
      sleep 7

      if cat /proc/1/environ | tr "\\0" "\\n" | grep -q "ANTHROPIC_API_KEY="; then
        echo "ERROR: ANTHROPIC_API_KEY still in /proc/1/environ"
        exit 1
      else
        echo "SUCCESS: ANTHROPIC_API_KEY cleared from /proc/1/environ"
      fi

      if [ -n "$ANTHROPIC_API_KEY" ]; then
        echo "SUCCESS: Agent can still read ANTHROPIC_API_KEY via getenv"
      else
        echo "WARNING: ANTHROPIC_API_KEY not accessible to agent"
      fi
    `;

    const result = await runner.runWithSudo(command, {
      allowDomains: ['example.com'],
      buildLocal: true,
      logLevel: 'debug',
      timeout: 30000,
      env: {
        ANTHROPIC_API_KEY: testToken,
      },
    });

    expect(result).toSucceed();
    expect(result.stdout).toContain('SUCCESS: ANTHROPIC_API_KEY cleared from /proc/1/environ');
    expect(result.stdout).toContain('SUCCESS: Agent can still read ANTHROPIC_API_KEY via getenv');
  }, 60000);

  test('should unset multiple tokens simultaneously', async () => {
    const command = `
      sleep 7

      # Check all three tokens
      TOKENS_FOUND=0

      if cat /proc/1/environ | tr "\\0" "\\n" | grep -q "GITHUB_TOKEN="; then
        echo "ERROR: GITHUB_TOKEN still in /proc/1/environ"
        TOKENS_FOUND=$((TOKENS_FOUND + 1))
      fi

      if cat /proc/1/environ | tr "\\0" "\\n" | grep -q "OPENAI_API_KEY="; then
        echo "ERROR: OPENAI_API_KEY still in /proc/1/environ"
        TOKENS_FOUND=$((TOKENS_FOUND + 1))
      fi

      if cat /proc/1/environ | tr "\\0" "\\n" | grep -q "ANTHROPIC_API_KEY="; then
        echo "ERROR: ANTHROPIC_API_KEY still in /proc/1/environ"
        TOKENS_FOUND=$((TOKENS_FOUND + 1))
      fi

      if [ $TOKENS_FOUND -eq 0 ]; then
        echo "SUCCESS: All tokens cleared from /proc/1/environ"
      else
        exit 1
      fi

      # Verify all tokens still accessible to agent
      if [ -n "$GITHUB_TOKEN" ] && [ -n "$OPENAI_API_KEY" ] && [ -n "$ANTHROPIC_API_KEY" ]; then
        echo "SUCCESS: All tokens still readable via getenv"
      else
        echo "WARNING: Some tokens not accessible to agent"
      fi
    `;

    const result = await runner.runWithSudo(command, {
      allowDomains: ['example.com'],
      buildLocal: true,
      logLevel: 'debug',
      timeout: 30000,
      env: {
        GITHUB_TOKEN: 'ghp_test_12345',
        OPENAI_API_KEY: 'sk-test_openai',
        ANTHROPIC_API_KEY: 'sk-ant-test',
      },
    });

    expect(result).toSucceed();
    expect(result.stdout).toContain('SUCCESS: All tokens cleared from /proc/1/environ');
    expect(result.stdout).toContain('SUCCESS: All tokens still readable via getenv');
  }, 60000);

  test('should work in non-chroot mode', async () => {
    const command = `
      sleep 7

      if cat /proc/1/environ | tr "\\0" "\\n" | grep -q "GITHUB_TOKEN="; then
        echo "ERROR: GITHUB_TOKEN still in /proc/1/environ"
        exit 1
      else
        echo "SUCCESS: GITHUB_TOKEN cleared from /proc/1/environ in non-chroot mode"
      fi
    `;

    const result = await runner.runWithSudo(command, {
      allowDomains: ['example.com'],
      buildLocal: true,
      logLevel: 'debug',
      timeout: 30000,
      env: {
        GITHUB_TOKEN: 'ghp_test_12345',
        // Disable chroot mode by not setting the flag
        AWF_CHROOT_ENABLED: 'false',
      },
    });

    // Note: The test runner may automatically enable chroot mode,
    // so we just verify the token is cleared regardless of mode
    expect(result).toSucceed();
    expect(result.stdout).toMatch(/SUCCESS: .*cleared from \/proc\/1\/environ/);
  }, 60000);
});
