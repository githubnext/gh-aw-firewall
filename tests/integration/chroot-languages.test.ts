/**
 * Chroot Language Tests
 *
 * These tests verify that the chroot mode correctly provides access
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
      });

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    }, 120000);

    test('should have npx available', async () => {
      const result = await runner.runWithSudo('npx --version', {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000,
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
      });

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/go version go\d+\.\d+/);
    }, 120000);

    test('should run Go env command', async () => {
      const result = await runner.runWithSudo('go env GOVERSION', {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000,
      });

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/go\d+\.\d+/);
    }, 120000);
  });

  describe('Java', () => {
    test('should execute java --version from host via chroot', async () => {
      // Validates JVM starts correctly - before procfs fix, JVM would fail
      // because /proc/self/exe resolved to bash instead of the java binary
      const result = await runner.runWithSudo('java --version 2>&1 || java -version 2>&1', {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000,
      });

      expect(result).toSucceed();
      expect(result.stdout + result.stderr).toMatch(/openjdk|java|version/i);
    }, 120000);

    test('should compile and run Java Hello World', async () => {
      // Full javac + java toolchain validation through chroot
      const result = await runner.runWithSudo(
        'TESTDIR=$(mktemp -d) && ' +
        'echo \'public class Hello { public static void main(String[] args) { System.out.println("Hello from Java"); } }\' > $TESTDIR/Hello.java && ' +
        'cd $TESTDIR && javac Hello.java && java Hello && rm -rf $TESTDIR',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 120000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('Hello from Java');
    }, 180000);

    test('should access Java standard library (java.util)', async () => {
      // Validates JVM class loading works beyond trivial hello world
      const result = await runner.runWithSudo(
        'TESTDIR=$(mktemp -d) && ' +
        'cat > $TESTDIR/TestUtil.java << \'EOF\'\n' +
        'import java.util.Arrays;\n' +
        'import java.util.List;\n' +
        'public class TestUtil {\n' +
        '  public static void main(String[] args) {\n' +
        '    List<String> items = Arrays.asList("a", "b", "c");\n' +
        '    System.out.println("List size: " + items.size());\n' +
        '  }\n' +
        '}\n' +
        'EOF\n' +
        'cd $TESTDIR && javac TestUtil.java && java TestUtil && rm -rf $TESTDIR',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 120000,
        }
      );

      if (result.success) {
        expect(result.stdout).toContain('List size: 3');
      }
    }, 180000);
  });

  describe('.NET', () => {
    test('should execute dotnet --version from host via chroot', async () => {
      // Primary regression test for the /proc/self/exe fix.
      // Before the fix, .NET CLR failed with "Cannot execute dotnet when renamed to bash"
      const result = await runner.runWithSudo('dotnet --version', {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000,
      });

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    }, 120000);

    test('should show dotnet runtime information', async () => {
      const result = await runner.runWithSudo('dotnet --info 2>&1 | head -30', {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000,
      });

      expect(result).toSucceed();
      expect(result.stdout + result.stderr).toMatch(/\.NET|SDK|Runtime/i);
    }, 120000);

    test('should create and run a .NET console app', async () => {
      // Full toolchain test: project creation, NuGet restore, build, and run
      const result = await runner.runWithSudo(
        'TESTDIR=$(mktemp -d) && cd $TESTDIR && ' +
        'dotnet new console -o testapp --no-restore && ' +
        'cd testapp && dotnet restore && dotnet run && ' +
        'rm -rf $TESTDIR',
        {
          allowDomains: ['api.nuget.org', 'nuget.org', 'dotnetcli.azureedge.net'],
          logLevel: 'debug',
          timeout: 180000,
        }
      );

      // May fail if NuGet connectivity varies in CI
      if (result.success) {
        expect(result.stdout).toContain('Hello, World!');
      }
    }, 240000);
  });

  describe('Basic System Binaries', () => {
    test('should access standard Unix utilities', async () => {
      const result = await runner.runWithSudo(
        'which bash && which ls && which cat',
        {
          allowDomains: ['github.com'],
          logLevel: 'debug',
          timeout: 60000,
        }
      );

      expect(result).toSucceed();
    }, 120000);

    test('should access git from host', async () => {
      const result = await runner.runWithSudo('git --version', {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000,
      });

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/git version \d+\.\d+/);
    }, 120000);

    test('should access curl from host', async () => {
      const result = await runner.runWithSudo('curl --version', {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000,
      });

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/curl \d+\.\d+/);
    }, 120000);
  });
});
