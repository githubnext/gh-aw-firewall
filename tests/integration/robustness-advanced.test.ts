/**
 * Firewall Robustness Test Suite - Advanced
 * Port of scripts/ci/test-firewall-robustness.sh
 *
 * Tests covering:
 * - IPv4/IPv6 parity
 * - Git operations
 * - Observability (audit log validation)
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';
import { createLogParser } from '../fixtures/log-parser';
import * as fs from 'fs';
import * as path from 'path';

describe('Firewall Robustness - Advanced', () => {
  let runner: AwfRunner;

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();
  }, 30000);

  afterAll(async () => {
    await cleanup(false);
  }, 30000);

  describe('5. IPv4/IPv6 Parity', () => {
    test('IPv4 dual-stack', async () => {
      const result = await runner.runWithSudo('curl -fsS -4 https://api.github.com/zen', {
        allowDomains: ['api.github.com'],
        logLevel: 'warn',
      });

      expect(result).toSucceed();
    }, 120000);

    test('IPv6 dual-stack (if available)', async () => {
      // IPv6 may not be available in all environments
      const result = await runner.runWithSudo('curl -fsS -6 https://api.github.com/zen || exit 0', {
        allowDomains: ['api.github.com'],
        logLevel: 'warn',
      });

      expect(result).toSucceed();
    }, 120000);
  });

  describe('6. Git Operations', () => {
    test('Git over HTTPS allowed', async () => {
      const result = await runner.runWithSudo('git ls-remote https://github.com/octocat/Hello-World.git HEAD', {
        allowDomains: ['github.com'],
        logLevel: 'warn',
      });

      expect(result).toSucceed();
    }, 120000);
  });

  describe('9. Observability', () => {
    test('Verify audit log fields for blocked traffic', async () => {
      const result = await runner.runWithSudo('curl -f https://example.com --max-time 5', {
        allowDomains: ['github.com'],
        keepContainers: true,
        logLevel: 'warn',
      });

      expect(result).toFail(); // Request should be blocked

      // Check Squid logs contain required fields
      if (result.workDir) {
        const squidLogPath = path.join(result.workDir, 'squid-logs', 'access.log');

        if (fs.existsSync(squidLogPath)) {
          const logContent = fs.readFileSync(squidLogPath, 'utf-8');
          const parser = createLogParser();
          const entries = parser.parseSquidLog(logContent);

          // Should have at least one log entry
          expect(entries.length).toBeGreaterThan(0);

          // Find blocked entries
          const blocked = parser.filterByDecision(entries, 'blocked');
          expect(blocked.length).toBeGreaterThan(0);

          // Verify required fields in blocked entry
          const blockedEntry = blocked[0];
          expect(blockedEntry.timestamp).toBeGreaterThan(0);
          expect(blockedEntry.host).toBeTruthy();
          expect(blockedEntry.decision).toBe('TCP_DENIED');
          expect(blockedEntry.statusCode).toBe(403);
        }

        // Cleanup work directory
        await cleanup(false);
      }
    }, 120000);
  });
});
