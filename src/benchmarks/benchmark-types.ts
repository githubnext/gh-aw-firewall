/**
 * Type definitions for performance benchmarks
 */

/**
 * Result of a single benchmark run
 */
export interface BenchmarkResult {
  /** Benchmark name */
  name: string;
  /** What the benchmark measures */
  description: string;
  /** Metric name (e.g., 'startup_time', 'memory_mb', 'throughput_rps') */
  metric: string;
  /** Unit of measurement */
  unit: string;
  /** Measured value */
  value: number;
  /** Timestamp when the benchmark was run */
  timestamp: string;
  /** Duration of the benchmark in milliseconds */
  durationMs: number;
  /** Additional metadata */
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Statistical summary of multiple benchmark runs
 */
export interface BenchmarkStats {
  /** Minimum value */
  min: number;
  /** Maximum value */
  max: number;
  /** Mean value */
  mean: number;
  /** Median value */
  median: number;
  /** Standard deviation */
  stdDev: number;
  /** Number of samples */
  samples: number;
}

/**
 * Complete benchmark report
 */
export interface BenchmarkReport {
  /** Report version for future compatibility */
  version: string;
  /** Git commit SHA */
  commitSha: string;
  /** Git branch name */
  branch: string;
  /** Runner environment info */
  environment: {
    os: string;
    nodeVersion: string;
    cpuModel: string;
    cpuCount: number;
    totalMemoryMb: number;
  };
  /** All benchmark results */
  results: BenchmarkResult[];
  /** Statistical summaries for each metric */
  stats: Record<string, BenchmarkStats>;
  /** Report generation timestamp */
  generatedAt: string;
}

/**
 * Threshold configuration for regression detection
 */
export interface RegressionThreshold {
  /** Metric name */
  metric: string;
  /** Maximum allowed increase percentage (e.g., 10 means 10% regression allowed) */
  maxIncreasePercent: number;
  /** Minimum required decrease percentage for improvement (optional) */
  minDecreasePercent?: number;
}

/**
 * Regression detection result
 */
export interface RegressionResult {
  /** Whether a regression was detected */
  hasRegression: boolean;
  /** List of metrics that regressed */
  regressions: Array<{
    metric: string;
    current: number;
    baseline: number;
    changePercent: number;
    threshold: number;
  }>;
  /** List of metrics that improved */
  improvements: Array<{
    metric: string;
    current: number;
    baseline: number;
    changePercent: number;
  }>;
}

/**
 * Options for running benchmarks
 */
export interface BenchmarkOptions {
  /** Number of iterations to run (default: 3) */
  iterations?: number;
  /** Warmup runs before measuring (default: 1) */
  warmupRuns?: number;
  /** Timeout for each benchmark in milliseconds (default: 120000) */
  timeout?: number;
  /** Whether to output verbose logging */
  verbose?: boolean;
}
