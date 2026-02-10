/**
 * One-Shot Token Tests
 *
 * These tests verify the LD_PRELOAD one-shot token library that prevents
 * sensitive environment variables from being read multiple times.
 *
 * The library intercepts getenv() calls for tokens like GITHUB_TOKEN and
 * returns the value once, then unsets the variable to prevent malicious
 * code from exfiltrating tokens after legitimate use.
 *
 * Tests verify:
 * - First read succeeds and returns the token value
 * - Second read returns empty/null (token has been cleared)
 * - Behavior works in both container mode and chroot mode
 *
 * IMPORTANT: These tests require buildLocal: true because the one-shot-token
 * library is compiled during the Docker image build. Pre-built images from GHCR
 * may not include this feature if they were built before PR #604 was merged.
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';

describe('One-Shot Token Protection', () => {
  let runner: AwfRunner;

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();
  });

  afterAll(async () => {
    await cleanup(false);
  });

  describe('Container Mode', () => {
    test('should allow GITHUB_TOKEN to be read once, then clear it', async () => {
      // Create a test script that reads the token twice
      const testScript = `
        FIRST_READ=$(printenv GITHUB_TOKEN)
        SECOND_READ=$(printenv GITHUB_TOKEN)
        echo "First read: [$FIRST_READ]"
        echo "Second read: [$SECOND_READ]"
      `;

      const result = await runner.runWithSudo(
        testScript,
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          buildLocal: true, // Build container locally to include one-shot-token.so
          env: {
            GITHUB_TOKEN: 'ghp_test_token_12345',
          },
        }
      );

      expect(result).toSucceed();
      // First read should have the token
      expect(result.stdout).toContain('First read: [ghp_test_token_12345]');
      // Second read should be empty (token has been cleared)
      expect(result.stdout).toContain('Second read: []');
      // Verify the one-shot-token library logged the token access
      expect(result.stderr).toContain('[one-shot-token] Token GITHUB_TOKEN accessed and cleared');
    }, 120000);

    test('should allow COPILOT_GITHUB_TOKEN to be read once, then clear it', async () => {
      const testScript = `
        FIRST_READ=$(printenv COPILOT_GITHUB_TOKEN)
        SECOND_READ=$(printenv COPILOT_GITHUB_TOKEN)
        echo "First read: [$FIRST_READ]"
        echo "Second read: [$SECOND_READ]"
      `;

      const result = await runner.runWithSudo(
        testScript,
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          buildLocal: true,
          env: {
            COPILOT_GITHUB_TOKEN: 'copilot_test_token_67890',
          },
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('First read: [copilot_test_token_67890]');
      expect(result.stdout).toContain('Second read: []');
      expect(result.stderr).toContain('[one-shot-token] Token COPILOT_GITHUB_TOKEN accessed and cleared');
    }, 120000);

    test('should allow OPENAI_API_KEY to be read once, then clear it', async () => {
      const testScript = `
        FIRST_READ=$(printenv OPENAI_API_KEY)
        SECOND_READ=$(printenv OPENAI_API_KEY)
        echo "First read: [$FIRST_READ]"
        echo "Second read: [$SECOND_READ]"
      `;

      const result = await runner.runWithSudo(
        testScript,
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          buildLocal: true,
          env: {
            OPENAI_API_KEY: 'sk-test-openai-key',
          },
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('First read: [sk-test-openai-key]');
      expect(result.stdout).toContain('Second read: []');
      expect(result.stderr).toContain('[one-shot-token] Token OPENAI_API_KEY accessed and cleared');
    }, 120000);

    test('should handle multiple different tokens independently', async () => {
      const testScript = `
        # Read GITHUB_TOKEN twice
        GITHUB_FIRST=$(printenv GITHUB_TOKEN)
        GITHUB_SECOND=$(printenv GITHUB_TOKEN)
        
        # Read OPENAI_API_KEY twice
        OPENAI_FIRST=$(printenv OPENAI_API_KEY)
        OPENAI_SECOND=$(printenv OPENAI_API_KEY)
        
        echo "GitHub first: [$GITHUB_FIRST]"
        echo "GitHub second: [$GITHUB_SECOND]"
        echo "OpenAI first: [$OPENAI_FIRST]"
        echo "OpenAI second: [$OPENAI_SECOND]"
      `;

      const result = await runner.runWithSudo(
        testScript,
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          buildLocal: true,
          env: {
            GITHUB_TOKEN: 'ghp_multi_token_1',
            OPENAI_API_KEY: 'sk-multi-key-2',
          },
        }
      );

      expect(result).toSucceed();
      // Each token should be readable once
      expect(result.stdout).toContain('GitHub first: [ghp_multi_token_1]');
      expect(result.stdout).toContain('GitHub second: []');
      expect(result.stdout).toContain('OpenAI first: [sk-multi-key-2]');
      expect(result.stdout).toContain('OpenAI second: []');
    }, 120000);

    test('should not interfere with non-sensitive environment variables', async () => {
      const testScript = `
        # Non-sensitive variables should be readable multiple times
        FIRST=$(printenv NORMAL_VAR)
        SECOND=$(printenv NORMAL_VAR)
        THIRD=$(printenv NORMAL_VAR)
        echo "First: [$FIRST]"
        echo "Second: [$SECOND]"
        echo "Third: [$THIRD]"
      `;

      const result = await runner.runWithSudo(
        testScript,
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          buildLocal: true,
          env: {
            NORMAL_VAR: 'not_a_token',
          },
        }
      );

      expect(result).toSucceed();
      // Non-sensitive variables should be readable multiple times
      expect(result.stdout).toContain('First: [not_a_token]');
      expect(result.stdout).toContain('Second: [not_a_token]');
      expect(result.stdout).toContain('Third: [not_a_token]');
      // No one-shot-token log message for non-sensitive vars
      expect(result.stderr).not.toContain('[one-shot-token] Token NORMAL_VAR');
    }, 120000);

    test('should work with programmatic getenv() calls', async () => {
      // Use Python to call getenv() directly (not through shell)
      // This tests that the LD_PRELOAD library properly intercepts C library calls
      const pythonScript = `
import os
# First call to os.getenv calls C's getenv()
first = os.getenv('GITHUB_TOKEN', '')
# Second call should return None/empty because token was cleared
second = os.getenv('GITHUB_TOKEN', '')
print(f"First: [{first}]")
print(f"Second: [{second}]")
      `.trim();

      const result = await runner.runWithSudo(
        `python3 -c '${pythonScript}'`,
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          buildLocal: true,
          env: {
            GITHUB_TOKEN: 'ghp_python_test_token',
          },
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('First: [ghp_python_test_token]');
      expect(result.stdout).toContain('Second: []');
      expect(result.stderr).toContain('[one-shot-token] Token GITHUB_TOKEN accessed and cleared');
    }, 120000);
  });

  describe('Chroot Mode', () => {
    test('should allow GITHUB_TOKEN to be read once in chroot mode', async () => {
      const testScript = `
        FIRST_READ=$(printenv GITHUB_TOKEN)
        SECOND_READ=$(printenv GITHUB_TOKEN)
        echo "First read: [$FIRST_READ]"
        echo "Second read: [$SECOND_READ]"
      `;

      const result = await runner.runWithSudo(
        testScript,
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          buildLocal: true,
          enableChroot: true,
          env: {
            GITHUB_TOKEN: 'ghp_chroot_token_12345',
          },
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('First read: [ghp_chroot_token_12345]');
      expect(result.stdout).toContain('Second read: []');
      // Verify the library was copied to the chroot
      expect(result.stderr).toContain('One-shot token library copied to chroot');
      // Verify the one-shot-token library logged the token access
      expect(result.stderr).toContain('[one-shot-token] Token GITHUB_TOKEN accessed and cleared');
    }, 120000);

    test('should allow COPILOT_GITHUB_TOKEN to be read once in chroot mode', async () => {
      const testScript = `
        FIRST_READ=$(printenv COPILOT_GITHUB_TOKEN)
        SECOND_READ=$(printenv COPILOT_GITHUB_TOKEN)
        echo "First read: [$FIRST_READ]"
        echo "Second read: [$SECOND_READ]"
      `;

      const result = await runner.runWithSudo(
        testScript,
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          buildLocal: true,
          enableChroot: true,
          env: {
            COPILOT_GITHUB_TOKEN: 'copilot_chroot_token_67890',
          },
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('First read: [copilot_chroot_token_67890]');
      expect(result.stdout).toContain('Second read: []');
      expect(result.stderr).toContain('[one-shot-token] Token COPILOT_GITHUB_TOKEN accessed and cleared');
    }, 120000);

    test('should work with programmatic getenv() calls in chroot mode', async () => {
      const pythonScript = `
import os
first = os.getenv('GITHUB_TOKEN', '')
second = os.getenv('GITHUB_TOKEN', '')
print(f"First: [{first}]")
print(f"Second: [{second}]")
      `.trim();

      const result = await runner.runWithSudo(
        `python3 -c '${pythonScript}'`,
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          buildLocal: true,
          enableChroot: true,
          env: {
            GITHUB_TOKEN: 'ghp_chroot_python_token',
          },
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('First: [ghp_chroot_python_token]');
      expect(result.stdout).toContain('Second: []');
      expect(result.stderr).toContain('[one-shot-token] Token GITHUB_TOKEN accessed and cleared');
    }, 120000);

    test('should not interfere with non-sensitive variables in chroot mode', async () => {
      const testScript = `
        FIRST=$(printenv NORMAL_VAR)
        SECOND=$(printenv NORMAL_VAR)
        THIRD=$(printenv NORMAL_VAR)
        echo "First: [$FIRST]"
        echo "Second: [$SECOND]"
        echo "Third: [$THIRD]"
      `;

      const result = await runner.runWithSudo(
        testScript,
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          buildLocal: true,
          enableChroot: true,
          env: {
            NORMAL_VAR: 'chroot_not_a_token',
          },
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('First: [chroot_not_a_token]');
      expect(result.stdout).toContain('Second: [chroot_not_a_token]');
      expect(result.stdout).toContain('Third: [chroot_not_a_token]');
      expect(result.stderr).not.toContain('[one-shot-token] Token NORMAL_VAR');
    }, 120000);

    test('should handle multiple different tokens independently in chroot mode', async () => {
      const testScript = `
        GITHUB_FIRST=$(printenv GITHUB_TOKEN)
        GITHUB_SECOND=$(printenv GITHUB_TOKEN)
        OPENAI_FIRST=$(printenv OPENAI_API_KEY)
        OPENAI_SECOND=$(printenv OPENAI_API_KEY)
        echo "GitHub first: [$GITHUB_FIRST]"
        echo "GitHub second: [$GITHUB_SECOND]"
        echo "OpenAI first: [$OPENAI_FIRST]"
        echo "OpenAI second: [$OPENAI_SECOND]"
      `;

      const result = await runner.runWithSudo(
        testScript,
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          buildLocal: true,
          enableChroot: true,
          env: {
            GITHUB_TOKEN: 'ghp_chroot_multi_1',
            OPENAI_API_KEY: 'sk-chroot-multi-2',
          },
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('GitHub first: [ghp_chroot_multi_1]');
      expect(result.stdout).toContain('GitHub second: []');
      expect(result.stdout).toContain('OpenAI first: [sk-chroot-multi-2]');
      expect(result.stdout).toContain('OpenAI second: []');
    }, 120000);
  });

  describe('Edge Cases', () => {
    test('should handle token with empty value', async () => {
      const testScript = `
        FIRST=$(printenv GITHUB_TOKEN)
        SECOND=$(printenv GITHUB_TOKEN)
        echo "First: [$FIRST]"
        echo "Second: [$SECOND]"
      `;

      const result = await runner.runWithSudo(
        testScript,
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          buildLocal: true,
          env: {
            GITHUB_TOKEN: '',
          },
        }
      );

      expect(result).toSucceed();
      // Empty token should be treated as no token
      expect(result.stdout).toContain('First: []');
      expect(result.stdout).toContain('Second: []');
    }, 120000);

    test('should handle token that is not set', async () => {
      const testScript = `
        FIRST=$(printenv NONEXISTENT_TOKEN)
        SECOND=$(printenv NONEXISTENT_TOKEN)
        echo "First: [$FIRST]"
        echo "Second: [$SECOND]"
      `;

      const result = await runner.runWithSudo(
        testScript,
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          buildLocal: true,
        }
      );

      expect(result).toSucceed();
      // Nonexistent token should return empty on both reads
      expect(result.stdout).toContain('First: []');
      expect(result.stdout).toContain('Second: []');
    }, 120000);

    test('should handle token with special characters', async () => {
      const testScript = `
        FIRST=$(printenv GITHUB_TOKEN)
        SECOND=$(printenv GITHUB_TOKEN)
        echo "First: [$FIRST]"
        echo "Second: [$SECOND]"
      `;

      const result = await runner.runWithSudo(
        testScript,
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          buildLocal: true,
          env: {
            GITHUB_TOKEN: 'ghp_test-with-special_chars@#$%',
          },
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('First: [ghp_test-with-special_chars@#$%]');
      expect(result.stdout).toContain('Second: []');
    }, 120000);
  });

  describe('Skip Unset Mode', () => {
    test('should log accesses but not clear tokens when AWF_ONE_SHOT_SKIP_UNSET=1', async () => {
      const testScript = `
        FIRST_READ=$(printenv GITHUB_TOKEN)
        SECOND_READ=$(printenv GITHUB_TOKEN)
        THIRD_READ=$(printenv GITHUB_TOKEN)
        echo "First read: [$FIRST_READ]"
        echo "Second read: [$SECOND_READ]"
        echo "Third read: [$THIRD_READ]"
      `;

      const result = await runner.runWithSudo(
        testScript,
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          buildLocal: true,
          env: {
            GITHUB_TOKEN: 'ghp_skip_unset_test',
            AWF_ONE_SHOT_SKIP_UNSET: '1',
          },
        }
      );

      expect(result).toSucceed();
      // All reads should return the token value (not cleared)
      expect(result.stdout).toContain('First read: [ghp_skip_unset_test]');
      expect(result.stdout).toContain('Second read: [ghp_skip_unset_test]');
      expect(result.stdout).toContain('Third read: [ghp_skip_unset_test]');
      // Should log that skip_unset is enabled
      expect(result.stderr).toContain('[one-shot-token] WARNING: AWF_ONE_SHOT_SKIP_UNSET=1 - tokens will NOT be unset after access');
      // Should log first access with skip_unset flag
      expect(result.stderr).toContain('[one-shot-token] Token GITHUB_TOKEN accessed (skip_unset=1, not cleared)');
    }, 120000);

    test('should work with multiple tokens in skip-unset mode', async () => {
      const testScript = `
        # Read each token multiple times
        GH1=$(printenv GITHUB_TOKEN)
        GH2=$(printenv GITHUB_TOKEN)
        OA1=$(printenv OPENAI_API_KEY)
        OA2=$(printenv OPENAI_API_KEY)
        
        echo "GitHub first: [$GH1]"
        echo "GitHub second: [$GH2]"
        echo "OpenAI first: [$OA1]"
        echo "OpenAI second: [$OA2]"
      `;

      const result = await runner.runWithSudo(
        testScript,
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          buildLocal: true,
          env: {
            GITHUB_TOKEN: 'ghp_skip_multi_1',
            OPENAI_API_KEY: 'sk-skip-multi-2',
            AWF_ONE_SHOT_SKIP_UNSET: '1',
          },
        }
      );

      expect(result).toSucceed();
      // All reads should succeed
      expect(result.stdout).toContain('GitHub first: [ghp_skip_multi_1]');
      expect(result.stdout).toContain('GitHub second: [ghp_skip_multi_1]');
      expect(result.stdout).toContain('OpenAI first: [sk-skip-multi-2]');
      expect(result.stdout).toContain('OpenAI second: [sk-skip-multi-2]');
    }, 120000);

    test('should work in chroot mode with skip-unset', async () => {
      const testScript = `
        FIRST=$(printenv GITHUB_TOKEN)
        SECOND=$(printenv GITHUB_TOKEN)
        echo "First: [$FIRST]"
        echo "Second: [$SECOND]"
      `;

      const result = await runner.runWithSudo(
        testScript,
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          buildLocal: true,
          enableChroot: true,
          env: {
            GITHUB_TOKEN: 'ghp_chroot_skip_unset',
            AWF_ONE_SHOT_SKIP_UNSET: '1',
          },
        }
      );

      expect(result).toSucceed();
      // Both reads should succeed in chroot with skip_unset
      expect(result.stdout).toContain('First: [ghp_chroot_skip_unset]');
      expect(result.stdout).toContain('Second: [ghp_chroot_skip_unset]');
      expect(result.stderr).toContain('[one-shot-token] WARNING: AWF_ONE_SHOT_SKIP_UNSET=1');
      expect(result.stderr).toContain('(skip_unset=1, not cleared)');
    }, 120000);
  });
});
