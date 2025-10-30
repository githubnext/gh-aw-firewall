import { AwfResult } from './awf-runner';
import { LogParser, SquidLogEntry } from './log-parser';

/**
 * Custom Jest matchers for firewall tests
 * Type declarations are in tests/types/jest-custom-matchers.d.ts
 */

export function setupCustomMatchers(): void {
  expect.extend({
    /**
     * Check if a domain was allowed in Squid logs
     */
    toAllowDomain(result: AwfResult, domain: string) {
      if (!result.workDir) {
        return {
          pass: false,
          message: () => 'Work directory not found in awf result. Cannot check Squid logs.',
        };
      }

      const parser = new LogParser();
      const entries: SquidLogEntry[] = [];

      // Synchronously read the log file (Jest matchers must be sync)
      try {
        const fs = require('fs');
        const path = require('path');
        const logPath = path.join(result.workDir, 'squid-logs', 'access.log');
        const content = fs.readFileSync(logPath, 'utf-8');
        entries.push(...parser.parseSquidLog(content));
      } catch (error) {
        return {
          pass: false,
          message: () => `Failed to read Squid logs: ${error}`,
        };
      }

      const allowed = parser.wasAllowed(entries, domain);

      if (allowed) {
        return {
          pass: true,
          message: () => `Expected domain "${domain}" to be blocked, but it was allowed`,
        };
      } else {
        return {
          pass: false,
          message: () => `Expected domain "${domain}" to be allowed, but it was blocked or not accessed`,
        };
      }
    },

    /**
     * Check if a domain was blocked in Squid logs
     */
    toBlockDomain(result: AwfResult, domain: string) {
      if (!result.workDir) {
        return {
          pass: false,
          message: () => 'Work directory not found in awf result. Cannot check Squid logs.',
        };
      }

      const parser = new LogParser();
      const entries: SquidLogEntry[] = [];

      try {
        const fs = require('fs');
        const path = require('path');
        const logPath = path.join(result.workDir, 'squid-logs', 'access.log');
        const content = fs.readFileSync(logPath, 'utf-8');
        entries.push(...parser.parseSquidLog(content));
      } catch (error) {
        return {
          pass: false,
          message: () => `Failed to read Squid logs: ${error}`,
        };
      }

      const blocked = parser.wasBlocked(entries, domain);

      if (blocked) {
        return {
          pass: true,
          message: () => `Expected domain "${domain}" to be allowed, but it was blocked`,
        };
      } else {
        return {
          pass: false,
          message: () => `Expected domain "${domain}" to be blocked, but it was allowed or not accessed`,
        };
      }
    },

    /**
     * Check if awf exited with a specific code
     */
    toExitWithCode(result: AwfResult, expectedCode: number) {
      const pass = result.exitCode === expectedCode;

      if (pass) {
        return {
          pass: true,
          message: () => `Expected awf to exit with code ${expectedCode}, and it did`,
        };
      } else {
        return {
          pass: false,
          message: () =>
            `Expected awf to exit with code ${expectedCode}, but it exited with code ${result.exitCode}\n` +
            `stdout: ${result.stdout}\n` +
            `stderr: ${result.stderr}`,
        };
      }
    },

    /**
     * Check if awf succeeded (exit code 0)
     */
    toSucceed(result: AwfResult) {
      const pass = result.success;

      if (pass) {
        return {
          pass: true,
          message: () => 'Expected awf to fail, but it succeeded',
        };
      } else {
        return {
          pass: false,
          message: () =>
            `Expected awf to succeed, but it failed with exit code ${result.exitCode}\n` +
            `stdout: ${result.stdout}\n` +
            `stderr: ${result.stderr}`,
        };
      }
    },

    /**
     * Check if awf failed (non-zero exit code)
     */
    toFail(result: AwfResult) {
      const pass = !result.success;

      if (pass) {
        return {
          pass: true,
          message: () => 'Expected awf to succeed, but it failed',
        };
      } else {
        return {
          pass: false,
          message: () => 'Expected awf to fail, but it succeeded',
        };
      }
    },

    /**
     * Check if awf timed out
     */
    toTimeout(result: AwfResult) {
      const pass = result.timedOut;

      if (pass) {
        return {
          pass: true,
          message: () => 'Expected awf not to timeout, but it did',
        };
      } else {
        return {
          pass: false,
          message: () => 'Expected awf to timeout, but it completed',
        };
      }
    },
  });
}
