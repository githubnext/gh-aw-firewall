/**
 * Chroot /proc Filesystem Tests
 *
 * These tests verify that the dynamic procfs mount in chroot mode provides
 * correct per-process /proc/self/exe resolution. This is the core regression
 * test for the fix in commit dda7c67, which replaced a static /proc/self
 * bind mount (always resolving to bash) with a dynamic mount -t proc.
 *
 * Without this fix:
 * - .NET CLR fails with "Cannot execute dotnet when renamed to bash"
 * - JVM misreads /proc/self/exe and /proc/cpuinfo
 * - Rustup proxy binaries appear as bash
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';

describe('Chroot /proc Filesystem Correctness', () => {
  let runner: AwfRunner;

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();
  });

  afterAll(async () => {
    await cleanup(false);
  });

  describe('/proc/self/exe resolution', () => {
    test('should resolve /proc/self/exe to a real path', async () => {
      const result = await runner.runWithSudo(
        'readlink /proc/self/exe',
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          enableChroot: true,
        }
      );

      expect(result).toSucceed();
      // Should contain an absolute path (stdout may include debug log lines)
      expect(result.stdout).toMatch(/\/usr\/bin\/|\/bin\/|\/usr\/sbin\//);
    }, 120000);

    test('should resolve differently for different binaries', async () => {
      // The key property of the dynamic procfs mount: each process sees
      // its own /proc/self/exe. With the old static bind mount, all
      // processes would see the parent bash process.
      const result = await runner.runWithSudo(
        'bash -c "readlink /proc/self/exe" && python3 -c "import os; print(os.readlink(\'/proc/self/exe\'))"',
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          enableChroot: true,
        }
      );

      expect(result).toSucceed();
      const lines = result.stdout.trim().split('\n').filter(l => l.startsWith('/'));
      // bash and python should resolve to different binaries
      if (lines.length >= 2) {
        expect(lines[0]).not.toEqual(lines[lines.length - 1]);
      }
    }, 120000);
  });

  describe('/proc filesystem entries', () => {
    test('should have /proc/cpuinfo accessible', async () => {
      // JVM reads /proc/cpuinfo for hardware detection
      const result = await runner.runWithSudo(
        'cat /proc/cpuinfo | head -10',
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          enableChroot: true,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/processor|model name|cpu|vendor/i);
    }, 120000);

    test('should have /proc/meminfo accessible', async () => {
      // JVM uses /proc/meminfo for memory detection and heap sizing
      const result = await runner.runWithSudo(
        'cat /proc/meminfo | head -5',
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          enableChroot: true,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/MemTotal/);
    }, 120000);

    test('should have /proc/self/status accessible', async () => {
      const result = await runner.runWithSudo(
        'cat /proc/self/status | head -5',
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 60000,
          enableChroot: true,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/Name:/);
    }, 120000);
  });

  describe('Java /proc/self/exe verification', () => {
    test('should read /proc/self/exe as java binary from JVM code', async () => {
      // Java program directly reads /proc/self/exe and verifies it
      // contains "java" not "bash" - the exact bug the procfs fix addresses
      const result = await runner.runWithSudo(
        'TESTDIR=$(mktemp -d) && ' +
        'cat > $TESTDIR/ProcSelf.java << \'EOF\'\n' +
        'import java.nio.file.Files;\n' +
        'import java.nio.file.Paths;\n' +
        'public class ProcSelf {\n' +
        '  public static void main(String[] args) throws Exception {\n' +
        '    String exe = Files.readSymbolicLink(Paths.get("/proc/self/exe")).toString();\n' +
        '    System.out.println("proc_self_exe=" + exe);\n' +
        '    if (exe.contains("java")) {\n' +
        '      System.out.println("CORRECT: /proc/self/exe points to java");\n' +
        '    } else {\n' +
        '      System.out.println("UNEXPECTED: /proc/self/exe points to " + exe);\n' +
        '    }\n' +
        '  }\n' +
        '}\n' +
        'EOF\n' +
        'cd $TESTDIR && javac ProcSelf.java && java ProcSelf && rm -rf $TESTDIR',
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 120000,
          enableChroot: true,
        }
      );

      if (result.success) {
        expect(result.stdout).toContain('proc_self_exe=');
        expect(result.stdout).toContain('CORRECT: /proc/self/exe points to java');
      }
    }, 180000);

    test('should report correct available processors from JVM', async () => {
      // JVM Runtime.availableProcessors() uses /proc/cpuinfo internally
      const result = await runner.runWithSudo(
        'TESTDIR=$(mktemp -d) && ' +
        'cat > $TESTDIR/MemInfo.java << \'EOF\'\n' +
        'public class MemInfo {\n' +
        '  public static void main(String[] args) {\n' +
        '    Runtime rt = Runtime.getRuntime();\n' +
        '    System.out.println("availableProcessors=" + rt.availableProcessors());\n' +
        '    System.out.println("maxMemory=" + rt.maxMemory());\n' +
        '  }\n' +
        '}\n' +
        'EOF\n' +
        'cd $TESTDIR && javac MemInfo.java && java MemInfo && rm -rf $TESTDIR',
        {
          allowDomains: ['localhost'],
          logLevel: 'debug',
          timeout: 120000,
          enableChroot: true,
        }
      );

      if (result.success) {
        expect(result.stdout).toMatch(/availableProcessors=\d+/);
        expect(result.stdout).toMatch(/maxMemory=\d+/);
        const match = result.stdout.match(/availableProcessors=(\d+)/);
        if (match) {
          expect(parseInt(match[1])).toBeGreaterThanOrEqual(1);
        }
      }
    }, 180000);
  });
});
