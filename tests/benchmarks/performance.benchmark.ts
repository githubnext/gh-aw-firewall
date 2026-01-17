/**
 * Performance Benchmark Tests
 *
 * This file contains performance benchmarks for the awf firewall.
 * Key metrics tracked:
 * - Container startup time
 * - Network throughput (allowed domains)
 * - Memory usage
 * - Cold start vs warm start comparison
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { BenchmarkRunner, formatReportAsMarkdown } from '../../src/benchmarks/benchmark-runner';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Performance Benchmarks', () => {
  let runner: AwfRunner;
  let benchmarkRunner: BenchmarkRunner;
  const iterations = 3; // Number of iterations for each benchmark

  beforeAll(async () => {
    // Ensure clean state
    await cleanup(false);

    runner = createRunner();
    benchmarkRunner = new BenchmarkRunner({
      iterations,
      warmupRuns: 1,
      verbose: true,
    });
  });

  afterAll(async () => {
    // Generate and save benchmark report
    const report = await benchmarkRunner.generateReport();
    const reportPath = path.join(os.tmpdir(), 'awf-benchmark-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nBenchmark report saved to: ${reportPath}`);

    // Print markdown summary
    console.log('\n' + formatReportAsMarkdown(report));

    // Clean up after all tests
    await cleanup(false);
  });

  describe('1. Container Startup Time', () => {
    test('measures time to start containers and execute simple command', async () => {
      const results = await benchmarkRunner.run(
        'container_startup',
        'Time from command invocation to container ready and simple command executed',
        'startup_time_ms',
        'ms',
        async () => {
          const startTime = Date.now();

          const result = await runner.runWithSudo('echo "ready"', {
            allowDomains: ['github.com'],
            logLevel: 'error', // Minimize log overhead
            timeout: 60000,
          });

          const elapsed = Date.now() - startTime;

          // Ensure the command succeeded
          expect(result.exitCode).toBe(0);
          expect(result.stdout).toContain('ready');

          // Clean up for next iteration
          await cleanup(false);

          return elapsed;
        }
      );

      expect(results.length).toBe(iterations);

      // Sanity check: startup should take less than 60 seconds
      for (const result of results) {
        expect(result.value).toBeLessThan(60000);
      }
    }, 300000); // 5 min timeout
  });

  describe('2. Network Throughput', () => {
    test('measures time to make HTTP request through proxy', async () => {
      const results = await benchmarkRunner.run(
        'http_request_time',
        'Time to make an HTTP request to an allowed domain through the proxy',
        'request_time_ms',
        'ms',
        async () => {
          const startTime = Date.now();

          // Use curl with timing info
          const result = await runner.runWithSudo(
            'curl -s -o /dev/null -w "%{time_total}" https://api.github.com',
            {
              allowDomains: ['github.com'],
              logLevel: 'error',
              timeout: 60000,
            }
          );

          const elapsed = Date.now() - startTime;

          expect(result.exitCode).toBe(0);

          // Clean up for next iteration
          await cleanup(false);

          // Return the curl-reported time in ms
          const curlTime = parseFloat(result.stdout.trim()) * 1000;
          return isNaN(curlTime) ? elapsed : curlTime;
        }
      );

      expect(results.length).toBe(iterations);
    }, 300000);

    test('measures time to download small file', async () => {
      const results = await benchmarkRunner.run(
        'download_time',
        'Time to download a small file (robots.txt) through the proxy',
        'download_time_ms',
        'ms',
        async () => {
          const startTime = Date.now();

          const result = await runner.runWithSudo(
            'curl -s -o /dev/null -w "%{time_total}" https://github.com/robots.txt',
            {
              allowDomains: ['github.com'],
              logLevel: 'error',
              timeout: 60000,
            }
          );

          const elapsed = Date.now() - startTime;

          expect(result.exitCode).toBe(0);

          await cleanup(false);

          const curlTime = parseFloat(result.stdout.trim()) * 1000;
          return isNaN(curlTime) ? elapsed : curlTime;
        }
      );

      expect(results.length).toBe(iterations);
    }, 300000);
  });

  describe('3. Memory Usage', () => {
    test('measures container memory usage during idle', async () => {
      const results = await benchmarkRunner.run(
        'memory_usage_idle',
        'Memory usage of containers while idle',
        'memory_mb',
        'MB',
        async () => {
          // Start containers and keep them running
          const result = await runner.runWithSudo(
            // Wait a bit then output container memory stats
            'sleep 2 && cat /proc/meminfo | grep MemAvailable',
            {
              allowDomains: ['github.com'],
              keepContainers: true,
              logLevel: 'error',
              timeout: 60000,
            }
          );

          // Get memory stats from Docker
          let memoryMb = 0;
          try {
            const execa = require('execa');
            const { stdout } = await execa('docker', [
              'stats',
              '--no-stream',
              '--format',
              '{{.MemUsage}}',
              'awf-squid',
              'awf-agent',
            ]);

            // Parse memory usage (format: "15.2MiB / 1.9GiB")
            const lines = stdout.trim().split('\n');
            for (const line of lines) {
              const match = line.match(/^([\d.]+)(MiB|GiB|MB|GB)/);
              if (match) {
                const value = parseFloat(match[1]);
                const unit = match[2];
                if (unit === 'GiB' || unit === 'GB') {
                  memoryMb += value * 1024;
                } else {
                  memoryMb += value;
                }
              }
            }
          } catch (error) {
            console.log('Failed to get memory stats:', error);
          }

          // Clean up
          await cleanup(false);

          return memoryMb;
        }
      );

      expect(results.length).toBe(iterations);

      // Sanity check: memory should be reasonable (less than 1GB total)
      for (const result of results) {
        expect(result.value).toBeLessThan(1024);
      }
    }, 300000);
  });

  describe('4. Blocked Domain Performance', () => {
    test('measures time for proxy to reject blocked domain', async () => {
      const results = await benchmarkRunner.run(
        'blocked_domain_time',
        'Time for proxy to reject a request to a non-allowed domain',
        'reject_time_ms',
        'ms',
        async () => {
          const startTime = Date.now();

          // This should fail quickly since example.com is not allowed
          const result = await runner.runWithSudo(
            'curl -s -o /dev/null -w "%{time_total}" --max-time 10 https://example.com || true',
            {
              allowDomains: ['github.com'],
              logLevel: 'error',
              timeout: 60000,
            }
          );

          const elapsed = Date.now() - startTime;

          await cleanup(false);

          // Return curl time if available, otherwise elapsed
          const curlTime = parseFloat(result.stdout.trim()) * 1000;
          return isNaN(curlTime) ? elapsed : curlTime;
        }
      );

      expect(results.length).toBe(iterations);
    }, 300000);
  });
});
