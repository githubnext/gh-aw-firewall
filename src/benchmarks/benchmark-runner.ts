/**
 * Benchmark Runner Utility
 *
 * Provides infrastructure for running and measuring performance benchmarks
 * for the awf firewall.
 */

import * as os from 'os';
import execa = require('execa');
import {
  BenchmarkResult,
  BenchmarkStats,
  BenchmarkReport,
  BenchmarkOptions,
  RegressionThreshold,
  RegressionResult,
} from './benchmark-types';

/**
 * Get current git commit SHA
 */
async function getGitCommitSha(): Promise<string> {
  try {
    const { stdout } = await execa('git', ['rev-parse', 'HEAD']);
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Get current git branch name
 */
async function getGitBranch(): Promise<string> {
  try {
    const { stdout } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Get CPU model string
 */
function getCpuModel(): string {
  const cpus = os.cpus();
  return cpus.length > 0 ? cpus[0].model : 'unknown';
}

/**
 * Calculate statistical summary from an array of numbers
 */
export function calculateStats(values: number[]): BenchmarkStats {
  if (values.length === 0) {
    return {
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      stdDev: 0,
      samples: 0,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;

  // Calculate median
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  // Calculate standard deviation
  const squaredDiffs = sorted.map((v) => Math.pow(v - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / sorted.length;
  const stdDev = Math.sqrt(avgSquaredDiff);

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    median,
    stdDev,
    samples: sorted.length,
  };
}

/**
 * Benchmark runner class
 */
export class BenchmarkRunner {
  private results: BenchmarkResult[] = [];
  private options: Required<BenchmarkOptions>;

  constructor(options: BenchmarkOptions = {}) {
    this.options = {
      iterations: options.iterations ?? 3,
      warmupRuns: options.warmupRuns ?? 1,
      timeout: options.timeout ?? 120000,
      verbose: options.verbose ?? false,
    };
  }

  private log(message: string): void {
    if (this.options.verbose) {
      console.log(`[Benchmark] ${message}`);
    }
  }

  /**
   * Run a benchmark function and record the result
   *
   * @param name - Benchmark name
   * @param description - What the benchmark measures
   * @param metric - Metric name (e.g., 'startup_time_ms')
   * @param unit - Unit of measurement
   * @param fn - Function that returns the measured value
   */
  async run(
    name: string,
    description: string,
    metric: string,
    unit: string,
    fn: () => Promise<number>
  ): Promise<BenchmarkResult[]> {
    const iterationResults: BenchmarkResult[] = [];

    // Warmup runs
    for (let i = 0; i < this.options.warmupRuns; i++) {
      this.log(`${name}: Warmup run ${i + 1}/${this.options.warmupRuns}`);
      try {
        await fn();
      } catch (error) {
        this.log(`${name}: Warmup run ${i + 1} failed: ${error}`);
      }
    }

    // Measured runs
    for (let i = 0; i < this.options.iterations; i++) {
      this.log(`${name}: Iteration ${i + 1}/${this.options.iterations}`);
      const startTime = Date.now();

      try {
        const value = await fn();
        const durationMs = Date.now() - startTime;

        const result: BenchmarkResult = {
          name,
          description,
          metric,
          unit,
          value,
          timestamp: new Date().toISOString(),
          durationMs,
          metadata: {
            iteration: i + 1,
          },
        };

        iterationResults.push(result);
        this.results.push(result);
        this.log(`${name}: Iteration ${i + 1} completed - ${value} ${unit}`);
      } catch (error) {
        this.log(`${name}: Iteration ${i + 1} failed: ${error}`);
      }
    }

    return iterationResults;
  }

  /**
   * Get all collected results
   */
  getResults(): BenchmarkResult[] {
    return [...this.results];
  }

  /**
   * Calculate statistics for all metrics
   */
  calculateAllStats(): Record<string, BenchmarkStats> {
    const statsByMetric: Record<string, BenchmarkStats> = {};

    // Group results by metric
    const valuesByMetric: Record<string, number[]> = {};
    for (const result of this.results) {
      if (!valuesByMetric[result.metric]) {
        valuesByMetric[result.metric] = [];
      }
      valuesByMetric[result.metric].push(result.value);
    }

    // Calculate stats for each metric
    for (const [metric, values] of Object.entries(valuesByMetric)) {
      statsByMetric[metric] = calculateStats(values);
    }

    return statsByMetric;
  }

  /**
   * Generate a complete benchmark report
   */
  async generateReport(): Promise<BenchmarkReport> {
    const [commitSha, branch] = await Promise.all([
      getGitCommitSha(),
      getGitBranch(),
    ]);

    return {
      version: '1.0.0',
      commitSha,
      branch,
      environment: {
        os: `${os.type()} ${os.release()}`,
        nodeVersion: process.version,
        cpuModel: getCpuModel(),
        cpuCount: os.cpus().length,
        totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
      },
      results: this.getResults(),
      stats: this.calculateAllStats(),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Clear all collected results
   */
  clear(): void {
    this.results = [];
  }
}

/**
 * Detect regressions by comparing current stats to baseline
 */
export function detectRegressions(
  current: Record<string, BenchmarkStats>,
  baseline: Record<string, BenchmarkStats>,
  thresholds: RegressionThreshold[]
): RegressionResult {
  const regressions: RegressionResult['regressions'] = [];
  const improvements: RegressionResult['improvements'] = [];

  for (const threshold of thresholds) {
    const currentStats = current[threshold.metric];
    const baselineStats = baseline[threshold.metric];

    if (!currentStats || !baselineStats || baselineStats.mean === 0) {
      continue;
    }

    const changePercent =
      ((currentStats.mean - baselineStats.mean) / baselineStats.mean) * 100;

    if (changePercent > threshold.maxIncreasePercent) {
      regressions.push({
        metric: threshold.metric,
        current: currentStats.mean,
        baseline: baselineStats.mean,
        changePercent,
        threshold: threshold.maxIncreasePercent,
      });
    } else if (
      threshold.minDecreasePercent !== undefined &&
      changePercent < -threshold.minDecreasePercent
    ) {
      improvements.push({
        metric: threshold.metric,
        current: currentStats.mean,
        baseline: baselineStats.mean,
        changePercent,
      });
    }
  }

  return {
    hasRegression: regressions.length > 0,
    regressions,
    improvements,
  };
}

/**
 * Format benchmark report as Markdown for GitHub Actions summary
 */
export function formatReportAsMarkdown(report: BenchmarkReport): string {
  let md = '## 📊 Performance Benchmark Results\n\n';

  md += `**Commit:** \`${report.commitSha.substring(0, 7)}\`\n`;
  md += `**Branch:** \`${report.branch}\`\n`;
  md += `**Generated:** ${report.generatedAt}\n\n`;

  md += '### Environment\n\n';
  md += `| Property | Value |\n`;
  md += `|----------|-------|\n`;
  md += `| OS | ${report.environment.os} |\n`;
  md += `| Node.js | ${report.environment.nodeVersion} |\n`;
  md += `| CPU | ${report.environment.cpuModel} |\n`;
  md += `| CPU Cores | ${report.environment.cpuCount} |\n`;
  md += `| Memory | ${report.environment.totalMemoryMb} MB |\n\n`;

  md += '### Benchmark Results\n\n';
  md += '| Metric | Mean | Min | Max | Std Dev | Samples |\n';
  md += '|--------|------|-----|-----|---------|--------|\n';

  for (const [metric, stats] of Object.entries(report.stats)) {
    // Find a result to get the unit
    const result = report.results.find((r) => r.metric === metric);
    const unit = result?.unit ?? '';

    md += `| ${metric} | ${stats.mean.toFixed(2)} ${unit} | `;
    md += `${stats.min.toFixed(2)} ${unit} | `;
    md += `${stats.max.toFixed(2)} ${unit} | `;
    md += `${stats.stdDev.toFixed(2)} | `;
    md += `${stats.samples} |\n`;
  }

  md += '\n';

  return md;
}

/**
 * Format regression result as Markdown
 */
export function formatRegressionAsMarkdown(
  result: RegressionResult,
  _thresholds: RegressionThreshold[]
): string {
  let md = '### Regression Analysis\n\n';

  if (!result.hasRegression && result.improvements.length === 0) {
    md += '✅ **No significant performance changes detected.**\n\n';
    return md;
  }

  if (result.hasRegression) {
    md += '⚠️ **Performance Regressions Detected:**\n\n';
    md += '| Metric | Current | Baseline | Change | Threshold |\n';
    md += '|--------|---------|----------|--------|----------|\n';

    for (const reg of result.regressions) {
      md += `| ${reg.metric} | ${reg.current.toFixed(2)} | `;
      md += `${reg.baseline.toFixed(2)} | `;
      md += `+${reg.changePercent.toFixed(1)}% | `;
      md += `${reg.threshold}% |\n`;
    }

    md += '\n';
  }

  if (result.improvements.length > 0) {
    md += '🎉 **Performance Improvements:**\n\n';
    md += '| Metric | Current | Baseline | Change |\n';
    md += '|--------|---------|----------|--------|\n';

    for (const imp of result.improvements) {
      md += `| ${imp.metric} | ${imp.current.toFixed(2)} | `;
      md += `${imp.baseline.toFixed(2)} | `;
      md += `${imp.changePercent.toFixed(1)}% |\n`;
    }

    md += '\n';
  }

  return md;
}
