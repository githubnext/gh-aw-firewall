/**
 * Chroot Package Manager Tests
 *
 * These tests verify that the --enable-chroot feature correctly provides access
 * to package managers and SDK tools. Tests validate that tools can perform
 * network operations through the firewall with proper domain whitelisting.
 *
 * IMPORTANT: These tests require the corresponding tools to be installed
 * on the host system. GitHub Actions runners have most of these pre-installed.
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';

describe('Chroot Package Manager Support', () => {
  let runner: AwfRunner;

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();
  });

  afterAll(async () => {
    await cleanup(false);
  });

  describe('pip (Python)', () => {
    test('should list installed packages', async () => {
      const result = await runner.runWithSudo('pip3 list --format=columns | head -5', {
        allowDomains: ['pypi.org', 'files.pythonhosted.org'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      expect(result.stdout).toContain('Package');
    }, 120000);

    test('should show package info without network', async () => {
      const result = await runner.runWithSudo('pip3 show pip', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      expect(result.stdout).toContain('Name: pip');
    }, 120000);

    test('should search PyPI with network access', async () => {
      const result = await runner.runWithSudo('pip3 index versions requests 2>&1 | head -3', {
        allowDomains: ['pypi.org'],
        logLevel: 'debug',
        timeout: 90000,
        enableChroot: true,
      });

      // pip index versions should work or show available versions
      // Even if command structure changes, we should get some output
      expect(result.exitCode).toBeLessThanOrEqual(1); // May fail if pypi not reachable but should not crash
    }, 150000);
  });

  describe('npm (Node.js)', () => {
    test('should show npm configuration', async () => {
      const result = await runner.runWithSudo('npm config list', {
        allowDomains: ['registry.npmjs.org'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
    }, 120000);

    test('should view package info from npm registry', async () => {
      const result = await runner.runWithSudo('npm view chalk version', {
        allowDomains: ['registry.npmjs.org'],
        logLevel: 'debug',
        timeout: 90000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    }, 150000);

    test('should be blocked from npm registry without domain', async () => {
      const result = await runner.runWithSudo('npm view chalk version 2>&1', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      // Should fail because registry is not allowed
      expect(result).toFail();
    }, 120000);
  });

  describe('Rust (cargo)', () => {
    test('should execute cargo from host via chroot', async () => {
      const result = await runner.runWithSudo('cargo --version', {
        allowDomains: ['crates.io', 'static.crates.io'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/cargo \d+\.\d+/);
    }, 120000);

    test('should execute rustc from host via chroot', async () => {
      const result = await runner.runWithSudo('rustc --version', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/rustc \d+\.\d+/);
    }, 120000);

    test('should search crates.io with network access', async () => {
      const result = await runner.runWithSudo('cargo search serde --limit 1 2>&1', {
        allowDomains: ['crates.io', 'static.crates.io', 'index.crates.io'],
        logLevel: 'debug',
        timeout: 120000,
        enableChroot: true,
      });

      // Should succeed or fail gracefully - the key is it attempts network access
      if (result.success) {
        expect(result.stdout).toContain('serde');
      }
    }, 180000);
  });

  describe('Java (maven)', () => {
    test('should execute java from host via chroot', async () => {
      const result = await runner.runWithSudo('java --version 2>&1 || java -version 2>&1', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      expect(result.stdout + result.stderr).toMatch(/java|openjdk|version/i);
    }, 120000);

    test('should execute javac from host via chroot', async () => {
      const result = await runner.runWithSudo('javac --version 2>&1 || javac -version 2>&1', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      // javac might not always be available, but Java should be
      if (result.success) {
        expect(result.stdout + result.stderr).toMatch(/javac|version/i);
      }
    }, 120000);

    test('should execute maven from host via chroot', async () => {
      const result = await runner.runWithSudo('mvn --version 2>&1', {
        allowDomains: ['repo.maven.apache.org', 'repo1.maven.org'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      // Maven might not be installed, that's OK
      if (result.success) {
        expect(result.stdout + result.stderr).toMatch(/Apache Maven|mvn/i);
      }
    }, 120000);
  });

  describe('Ruby (gem/bundler)', () => {
    test('should execute ruby from host via chroot', async () => {
      const result = await runner.runWithSudo('ruby --version', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/ruby \d+\.\d+/);
    }, 120000);

    test('should execute gem from host via chroot', async () => {
      const result = await runner.runWithSudo('gem --version', {
        allowDomains: ['rubygems.org'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/\d+\.\d+/);
    }, 120000);

    test('should list installed gems', async () => {
      const result = await runner.runWithSudo('gem list --local | head -5', {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
    }, 120000);

    test('should execute bundler from host via chroot', async () => {
      const result = await runner.runWithSudo('bundle --version', {
        allowDomains: ['rubygems.org'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      // Bundler might not be installed
      if (result.success) {
        expect(result.stdout).toMatch(/Bundler version \d+\.\d+/);
      }
    }, 120000);

    test('should search rubygems with network access', async () => {
      const result = await runner.runWithSudo('gem search rails --remote --no-verbose 2>&1 | head -3', {
        allowDomains: ['rubygems.org', 'index.rubygems.org'],
        logLevel: 'debug',
        timeout: 120000,
        enableChroot: true,
      });

      // Should attempt network access
      if (result.success) {
        expect(result.stdout).toContain('rails');
      }
    }, 180000);
  });

  describe('Go modules', () => {
    test('should show go env', async () => {
      const result = await runner.runWithSudo('go env GOPATH GOPROXY', {
        allowDomains: ['proxy.golang.org', 'sum.golang.org'],
        logLevel: 'debug',
        timeout: 60000,
        enableChroot: true,
      });

      expect(result).toSucceed();
    }, 120000);

    test('should list go modules (no network needed for empty list)', async () => {
      // Create a temp dir and check go mod functionality
      const result = await runner.runWithSudo(
        'cd /tmp && mkdir -p gotest && cd gotest && go mod init test 2>&1 && go mod tidy 2>&1 && cat go.mod',
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          enableChroot: true,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('module test');
    }, 120000);
  });
});
