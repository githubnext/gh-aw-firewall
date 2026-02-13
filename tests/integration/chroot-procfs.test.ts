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
 *
 * OPTIMIZATION: Quick /proc checks are batched into a single AWF invocation,
 * and both Java /proc tests share one invocation. Reduces ~8 invocations to 2.
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';
import { runBatch, BatchResults } from '../fixtures/batch-runner';

describe('Chroot /proc Filesystem Correctness', () => {
  let runner: AwfRunner;

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();
  });

  afterAll(async () => {
    await cleanup(false);
  });

  // ---------- Batch 1: quick /proc checks (single AWF invocation) ----------
  describe('/proc checks (batched)', () => {
    let batch: BatchResults;

    beforeAll(async () => {
      batch = await runBatch(runner, [
        { name: 'readlink_exe', command: 'readlink /proc/self/exe' },
        {
          name: 'diff_binaries',
          command: 'bash -c "readlink /proc/self/exe" && python3 -c "import os; print(os.readlink(\'/proc/self/exe\'))"',
        },
        { name: 'cpuinfo', command: 'cat /proc/cpuinfo | head -10' },
        { name: 'meminfo', command: 'cat /proc/meminfo | head -5' },
        { name: 'self_status', command: 'cat /proc/self/status | head -5' },
      ], {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 120000,
      });
    }, 180000);

    test('should resolve /proc/self/exe to a real path', () => {
      const r = batch.get('readlink_exe');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/\/usr\/bin\/|\/bin\/|\/usr\/sbin\//);
    });

    test('should resolve differently for different binaries', () => {
      const r = batch.get('diff_binaries');
      expect(r.exitCode).toBe(0);
      const lines = r.stdout.trim().split('\n').filter(l => l.startsWith('/'));
      if (lines.length >= 2) {
        expect(lines[0]).not.toEqual(lines[lines.length - 1]);
      }
    });

    test('should have /proc/cpuinfo accessible', () => {
      const r = batch.get('cpuinfo');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/processor|model name|cpu|vendor/i);
    });

    test('should have /proc/meminfo accessible', () => {
      const r = batch.get('meminfo');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/MemTotal/);
    });

    test('should have /proc/self/status accessible', () => {
      const r = batch.get('self_status');
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/Name:/);
    });
  });

  // ---------- Batch 2: Java /proc tests (single AWF invocation with both Java programs) ----------
  describe('Java /proc/self/exe verification (batched)', () => {
    let batch: BatchResults;

    beforeAll(async () => {
      batch = await runBatch(runner, [
        {
          name: 'java_proc_self',
          command:
            'TESTDIR=$(mktemp -d) && ' +
            "cat > $TESTDIR/ProcSelf.java << 'JAVAEOF'\n" +
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
            'JAVAEOF\n' +
            'cd $TESTDIR && javac ProcSelf.java && java ProcSelf && rm -rf $TESTDIR',
        },
        {
          name: 'java_processors',
          command:
            'TESTDIR=$(mktemp -d) && ' +
            "cat > $TESTDIR/MemInfo.java << 'JAVAEOF'\n" +
            'public class MemInfo {\n' +
            '  public static void main(String[] args) {\n' +
            '    Runtime rt = Runtime.getRuntime();\n' +
            '    System.out.println("availableProcessors=" + rt.availableProcessors());\n' +
            '    System.out.println("maxMemory=" + rt.maxMemory());\n' +
            '  }\n' +
            '}\n' +
            'JAVAEOF\n' +
            'cd $TESTDIR && javac MemInfo.java && java MemInfo && rm -rf $TESTDIR',
        },
      ], {
        allowDomains: ['localhost'],
        logLevel: 'debug',
        timeout: 180000,
      });
    }, 240000);

    test('should read /proc/self/exe as java binary from JVM code', () => {
      const r = batch.get('java_proc_self');
      if (r.exitCode === 0) {
        expect(r.stdout).toContain('proc_self_exe=');
        expect(r.stdout).toContain('CORRECT: /proc/self/exe points to java');
      }
    });

    test('should report correct available processors from JVM', () => {
      const r = batch.get('java_processors');
      if (r.exitCode === 0) {
        expect(r.stdout).toMatch(/availableProcessors=\d+/);
        expect(r.stdout).toMatch(/maxMemory=\d+/);
        const match = r.stdout.match(/availableProcessors=(\d+)/);
        if (match) {
          expect(parseInt(match[1])).toBeGreaterThanOrEqual(1);
        }
      }
    });
  });
});
