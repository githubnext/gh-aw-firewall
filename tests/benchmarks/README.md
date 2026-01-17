# Performance Benchmarks

This directory contains performance benchmarks for the awf (Agentic Workflow Firewall) tool.

## Overview

The benchmark suite measures key performance metrics to track and prevent performance regressions over time:

- **Container Startup Time**: Time from command invocation to container ready
- **Network Throughput**: Time to make HTTP requests through the proxy
- **Memory Usage**: Combined memory consumption of firewall containers
- **Blocked Domain Performance**: Time for proxy to reject blocked domains

## Running Benchmarks

### Locally

```bash
# Run all benchmarks (requires sudo for iptables)
sudo -E npm run test:benchmark

# View the benchmark report
cat /tmp/awf-benchmark-report.json | jq
```

### In CI

The benchmarks run automatically on:
- Push to `main` branch
- Pull requests to `main` branch

The GitHub Actions workflow (`benchmark.yml`) generates a summary with:
- Performance metrics table
- Environment information
- Comparison with baseline (if available)

## Benchmark Files

| File | Description |
|------|-------------|
| `performance.benchmark.ts` | Main benchmark test file with all performance tests |

## Metrics Tracked

| Metric | Description | Unit |
|--------|-------------|------|
| `startup_time_ms` | Container startup and simple command execution | milliseconds |
| `request_time_ms` | HTTP request time through proxy | milliseconds |
| `download_time_ms` | Small file download through proxy | milliseconds |
| `memory_mb` | Combined container memory usage | megabytes |
| `reject_time_ms` | Time to reject blocked domain | milliseconds |

## Regression Detection

The benchmark suite includes regression detection with configurable thresholds:

```typescript
const thresholds: RegressionThreshold[] = [
  { metric: 'startup_time_ms', maxIncreasePercent: 20 },
  { metric: 'request_time_ms', maxIncreasePercent: 15 },
  { metric: 'memory_mb', maxIncreasePercent: 25 },
];
```

When a metric increases beyond its threshold compared to the baseline, a warning is generated in the CI summary.

## Interpreting Results

### Good Performance Indicators

- **Startup time < 30s**: Fast container initialization
- **Request time < 5s**: Efficient proxy overhead
- **Memory < 200MB**: Low resource footprint

### Common Performance Issues

1. **Slow startup**: May indicate Docker image pull issues or container init problems
2. **High request latency**: Could be DNS resolution or proxy configuration issues
3. **High memory usage**: Check for memory leaks in long-running tests

## Benchmark Report Format

The benchmark report is saved as JSON in `/tmp/awf-benchmark-report.json`:

```json
{
  "version": "1.0.0",
  "commitSha": "abc123",
  "branch": "main",
  "environment": {
    "os": "Linux 5.4.0",
    "nodeVersion": "v20.0.0",
    "cpuModel": "Intel Core i7",
    "cpuCount": 4,
    "totalMemoryMb": 16384
  },
  "results": [...],
  "stats": {
    "startup_time_ms": {
      "min": 5000,
      "max": 6000,
      "mean": 5500,
      "median": 5500,
      "stdDev": 250,
      "samples": 3
    }
  },
  "generatedAt": "2024-01-01T00:00:00.000Z"
}
```

## Adding New Benchmarks

To add a new benchmark:

1. Open `performance.benchmark.ts`
2. Add a new test using the benchmark runner:

```typescript
await benchmarkRunner.run(
  'your_benchmark_name',
  'Description of what this measures',
  'metric_name',
  'unit',
  async () => {
    // Your benchmark code here
    // Return the measured value
    return measuredValue;
  }
);
```

3. Update the threshold configuration if needed
4. Update this README with the new metric

## Best Practices

1. **Run multiple iterations**: The default is 3 iterations to reduce noise
2. **Use warmup runs**: First run often includes cold start overhead
3. **Clean state**: Always clean up between iterations
4. **Minimize variables**: Run on consistent hardware/environment
5. **Track trends**: Compare against historical baselines
