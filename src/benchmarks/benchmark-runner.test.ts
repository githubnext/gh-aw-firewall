/**
 * Unit tests for benchmark runner utilities
 */

import { describe, test, expect } from '@jest/globals';
import {
  calculateStats,
  detectRegressions,
  formatReportAsMarkdown,
  formatRegressionAsMarkdown,
} from './benchmark-runner';
import { BenchmarkReport, BenchmarkStats, RegressionThreshold } from './benchmark-types';

describe('Benchmark Runner', () => {
  describe('calculateStats', () => {
    test('should calculate correct statistics for simple array', () => {
      const values = [10, 20, 30, 40, 50];
      const stats = calculateStats(values);

      expect(stats.min).toBe(10);
      expect(stats.max).toBe(50);
      expect(stats.mean).toBe(30);
      expect(stats.median).toBe(30);
      expect(stats.samples).toBe(5);
    });

    test('should calculate median correctly for even-length arrays', () => {
      const values = [10, 20, 30, 40];
      const stats = calculateStats(values);

      expect(stats.median).toBe(25); // (20 + 30) / 2
    });

    test('should handle single value', () => {
      const values = [42];
      const stats = calculateStats(values);

      expect(stats.min).toBe(42);
      expect(stats.max).toBe(42);
      expect(stats.mean).toBe(42);
      expect(stats.median).toBe(42);
      expect(stats.stdDev).toBe(0);
      expect(stats.samples).toBe(1);
    });

    test('should handle empty array', () => {
      const values: number[] = [];
      const stats = calculateStats(values);

      expect(stats.min).toBe(0);
      expect(stats.max).toBe(0);
      expect(stats.mean).toBe(0);
      expect(stats.median).toBe(0);
      expect(stats.stdDev).toBe(0);
      expect(stats.samples).toBe(0);
    });

    test('should calculate standard deviation correctly', () => {
      // Values: [2, 4, 4, 4, 5, 5, 7, 9]
      // Mean = 5
      // Variance = ((2-5)² + (4-5)² + (4-5)² + (4-5)² + (5-5)² + (5-5)² + (7-5)² + (9-5)²) / 8
      //          = (9 + 1 + 1 + 1 + 0 + 0 + 4 + 16) / 8 = 32 / 8 = 4
      // StdDev = √4 = 2
      const values = [2, 4, 4, 4, 5, 5, 7, 9];
      const stats = calculateStats(values);

      expect(stats.mean).toBe(5);
      expect(stats.stdDev).toBe(2);
    });
  });

  describe('detectRegressions', () => {
    test('should detect regression when threshold exceeded', () => {
      const current: Record<string, BenchmarkStats> = {
        startup_time_ms: {
          min: 5500,
          max: 6000,
          mean: 5750,
          median: 5750,
          stdDev: 100,
          samples: 3,
        },
      };

      const baseline: Record<string, BenchmarkStats> = {
        startup_time_ms: {
          min: 4500,
          max: 5000,
          mean: 4750,
          median: 4750,
          stdDev: 100,
          samples: 3,
        },
      };

      const thresholds: RegressionThreshold[] = [
        { metric: 'startup_time_ms', maxIncreasePercent: 10 },
      ];

      const result = detectRegressions(current, baseline, thresholds);

      expect(result.hasRegression).toBe(true);
      expect(result.regressions).toHaveLength(1);
      expect(result.regressions[0].metric).toBe('startup_time_ms');
      // Change is (5750 - 4750) / 4750 * 100 = 21.05%
      expect(result.regressions[0].changePercent).toBeCloseTo(21.05, 1);
    });

    test('should not detect regression when within threshold', () => {
      const current: Record<string, BenchmarkStats> = {
        startup_time_ms: {
          min: 4900,
          max: 5100,
          mean: 5000,
          median: 5000,
          stdDev: 50,
          samples: 3,
        },
      };

      const baseline: Record<string, BenchmarkStats> = {
        startup_time_ms: {
          min: 4800,
          max: 5000,
          mean: 4900,
          median: 4900,
          stdDev: 50,
          samples: 3,
        },
      };

      const thresholds: RegressionThreshold[] = [
        { metric: 'startup_time_ms', maxIncreasePercent: 10 },
      ];

      const result = detectRegressions(current, baseline, thresholds);

      expect(result.hasRegression).toBe(false);
      expect(result.regressions).toHaveLength(0);
    });

    test('should detect improvements', () => {
      const current: Record<string, BenchmarkStats> = {
        startup_time_ms: {
          min: 4000,
          max: 4500,
          mean: 4250,
          median: 4250,
          stdDev: 100,
          samples: 3,
        },
      };

      const baseline: Record<string, BenchmarkStats> = {
        startup_time_ms: {
          min: 5000,
          max: 5500,
          mean: 5250,
          median: 5250,
          stdDev: 100,
          samples: 3,
        },
      };

      const thresholds: RegressionThreshold[] = [
        { metric: 'startup_time_ms', maxIncreasePercent: 10, minDecreasePercent: 15 },
      ];

      const result = detectRegressions(current, baseline, thresholds);

      expect(result.hasRegression).toBe(false);
      expect(result.improvements).toHaveLength(1);
      expect(result.improvements[0].metric).toBe('startup_time_ms');
      // Change is (4250 - 5250) / 5250 * 100 = -19.05%
      expect(result.improvements[0].changePercent).toBeCloseTo(-19.05, 1);
    });

    test('should handle missing baseline metrics', () => {
      const current: Record<string, BenchmarkStats> = {
        new_metric: {
          min: 100,
          max: 200,
          mean: 150,
          median: 150,
          stdDev: 25,
          samples: 3,
        },
      };

      const baseline: Record<string, BenchmarkStats> = {};

      const thresholds: RegressionThreshold[] = [
        { metric: 'new_metric', maxIncreasePercent: 10 },
      ];

      const result = detectRegressions(current, baseline, thresholds);

      expect(result.hasRegression).toBe(false);
      expect(result.regressions).toHaveLength(0);
    });
  });

  describe('formatReportAsMarkdown', () => {
    test('should format report correctly', () => {
      const report: BenchmarkReport = {
        version: '1.0.0',
        commitSha: 'abc123def456',
        branch: 'main',
        environment: {
          os: 'Linux 5.4.0',
          nodeVersion: 'v20.0.0',
          cpuModel: 'Intel Core i7',
          cpuCount: 4,
          totalMemoryMb: 16384,
        },
        results: [
          {
            name: 'test_benchmark',
            description: 'Test benchmark',
            metric: 'test_metric_ms',
            unit: 'ms',
            value: 100,
            timestamp: '2024-01-01T00:00:00.000Z',
            durationMs: 1000,
          },
        ],
        stats: {
          test_metric_ms: {
            min: 90,
            max: 110,
            mean: 100,
            median: 100,
            stdDev: 5,
            samples: 3,
          },
        },
        generatedAt: '2024-01-01T00:00:00.000Z',
      };

      const markdown = formatReportAsMarkdown(report);

      expect(markdown).toContain('## 📊 Performance Benchmark Results');
      expect(markdown).toContain('abc123d');
      expect(markdown).toContain('main');
      expect(markdown).toContain('Linux 5.4.0');
      expect(markdown).toContain('test_metric_ms');
      expect(markdown).toContain('100.00 ms');
    });
  });

  describe('formatRegressionAsMarkdown', () => {
    test('should format regression result correctly', () => {
      const result = {
        hasRegression: true,
        regressions: [
          {
            metric: 'startup_time_ms',
            current: 6000,
            baseline: 5000,
            changePercent: 20,
            threshold: 10,
          },
        ],
        improvements: [],
      };

      const thresholds: RegressionThreshold[] = [
        { metric: 'startup_time_ms', maxIncreasePercent: 10 },
      ];

      const markdown = formatRegressionAsMarkdown(result, thresholds);

      expect(markdown).toContain('⚠️ **Performance Regressions Detected:**');
      expect(markdown).toContain('startup_time_ms');
      expect(markdown).toContain('+20.0%');
    });

    test('should format improvements correctly', () => {
      const result = {
        hasRegression: false,
        regressions: [],
        improvements: [
          {
            metric: 'startup_time_ms',
            current: 4000,
            baseline: 5000,
            changePercent: -20,
          },
        ],
      };

      const thresholds: RegressionThreshold[] = [
        { metric: 'startup_time_ms', maxIncreasePercent: 10, minDecreasePercent: 15 },
      ];

      const markdown = formatRegressionAsMarkdown(result, thresholds);

      expect(markdown).toContain('🎉 **Performance Improvements:**');
      expect(markdown).toContain('-20.0%');
    });

    test('should indicate no changes when no regressions or improvements', () => {
      const result = {
        hasRegression: false,
        regressions: [],
        improvements: [],
      };

      const thresholds: RegressionThreshold[] = [];

      const markdown = formatRegressionAsMarkdown(result, thresholds);

      expect(markdown).toContain('✅ **No significant performance changes detected.**');
    });
  });
});
