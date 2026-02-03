/**
 * Chroot Language Tests
 *
 * These tests verify that the --enable-chroot feature correctly provides access
 * to host binaries for different programming languages. This is critical for
 * GitHub Actions runners where tools are installed on the host.
 *
 * IMPORTANT: These tests require the corresponding languages to be installed
 * on the host system (GitHub Actions runners have Python, Node, Go pre-installed).
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';

describe('Chroot Language Support', () => {
  let runner: AwfRunner;

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();
  });

  afterAll(async () => {
    await cleanup(false);
  });

  describe('Python', () => {
    test('should execute Python from host via chroot', async () => {
      const result = await runner.runWithSudo('python3 --version', {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      expect(result.stdout + result.stderr).toMatch(/Python 3\.\d+\.\d+/);
    }, 120000);

    test('should run Python inline script', async () => {
      const result = await runner.runWithSudo(
        'python3 -c "print(2 + 2)"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
          enableChroot: true,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('4');
    }, 120000);

    test('should access Python standard library modules', async () => {
      const result = await runner.runWithSudo(
        'python3 -c "import json, os, sys; print(json.dumps({\'test\': True}))"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
          enableChroot: true,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('{"test": true}');
    }, 120000);

    test('should have pip available', async () => {
      const result = await runner.runWithSudo('pip3 --version', {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      expect(result.stdout + result.stderr).toMatch(/pip \d+\.\d+/);
    }, 120000);
  });

  describe('Node.js', () => {
    test('should execute Node.js from host via chroot', async () => {
      const result = await runner.runWithSudo('node --version', {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/v\d+\.\d+\.\d+/);
    }, 120000);

    test('should run Node.js inline script', async () => {
      const result = await runner.runWithSudo(
        'node -e "console.log(2 + 2)"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
          enableChroot: true,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('4');
    }, 120000);

    test('should access Node.js built-in modules', async () => {
      const result = await runner.runWithSudo(
        'node -e "const os = require(\'os\'); console.log(os.platform())"',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
          enableChroot: true,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('linux');
    }, 120000);

    test('should have npm available', async () => {
      const result = await runner.runWithSudo('npm --version', {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    }, 120000);

    test('should have npx available', async () => {
      const result = await runner.runWithSudo('npx --version', {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    }, 120000);
  });

  describe('Go', () => {
    test('should execute Go from host via chroot', async () => {
      const result = await runner.runWithSudo('go version', {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/go version go\d+\.\d+/);
    }, 120000);

    test('should run Go env command', async () => {
      const result = await runner.runWithSudo('go env GOVERSION', {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/go\d+\.\d+/);
    }, 120000);
  });

  describe('Basic System Binaries', () => {
    test('should access standard Unix utilities', async () => {
      const result = await runner.runWithSudo(
        'which bash && which ls && which cat',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
          enableChroot: true,
        }
      );

      expect(result).toSucceed();
    }, 120000);

    test('should access git from host', async () => {
      const result = await runner.runWithSudo('git --version', {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/git version \d+\.\d+/);
    }, 120000);

    test('should access curl from host', async () => {
      const result = await runner.runWithSudo('curl --version', {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/curl \d+\.\d+/);
    }, 120000);
  });
});
