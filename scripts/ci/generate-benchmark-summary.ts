#!/usr/bin/env node
/**
 * Generate GitHub Actions job summary from benchmark test output
 * This script parses benchmark output and creates a markdown summary
 * with performance metrics and statistics.
 */

import * as fs from 'fs';
import * as path from 'path';

interface BenchmarkMetric {
  name: string;
  metric: string;
  unit: string;
  values: number[];
}

interface ParsedResults {
  metrics: BenchmarkMetric[];
  passed: number;
  failed: number;
  duration: string;
}

function parseJestOutput(output: string): ParsedResults {
  const lines = output.split('\n');
  const metrics: BenchmarkMetric[] = [];
  let passed = 0;
  let failed = 0;
  let duration = 'unknown';

  // Parse test results
  const testsLine = lines.find(line => line.startsWith('Tests:'));
  if (testsLine) {
    const passedMatch = testsLine.match(/(\d+) passed/);
    const failedMatch = testsLine.match(/(\d+) failed/);
    passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
    failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
  }

  // Parse duration
  const timeLine = lines.find(line => line.match(/Time:\s+[\d.]+\s*s/));
  if (timeLine) {
    const timeMatch = timeLine.match(/Time:\s+([\d.]+\s*s)/);
    if (timeMatch) {
      duration = timeMatch[1];
    }
  }

  // Parse benchmark-specific output
  // Look for lines like: "container_startup: Iteration 1 completed - 5234 ms"
  const benchmarkPattern = /\[Benchmark\] (\w+): Iteration \d+ completed - ([\d.]+) (\w+)/g;
  let match;
  while ((match = benchmarkPattern.exec(output)) !== null) {
    const [, name, value, unit] = match;
    const existingMetric = metrics.find(m => m.name === name);
    if (existingMetric) {
      existingMetric.values.push(parseFloat(value));
    } else {
      metrics.push({
        name,
        metric: name,
        unit,
        values: [parseFloat(value)],
      });
    }
  }

  return { metrics, passed, failed, duration };
}

function calculateStats(values: number[]): { min: number; max: number; mean: number; stdDev: number } {
  if (values.length === 0) {
    return { min: 0, max: 0, mean: 0, stdDev: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;

  const squaredDiffs = sorted.map(v => Math.pow(v - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / sorted.length;
  const stdDev = Math.sqrt(avgSquaredDiff);

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    stdDev,
  };
}

function generateSummary(output: string): string {
  const results = parseJestOutput(output);
  const statusEmoji = results.failed === 0 ? '✅' : '❌';

  let summary = `## ${statusEmoji} Performance Benchmark Results\n\n`;
  summary += `**Results:** ${results.passed} passed, ${results.failed} failed in ${results.duration}\n\n`;

  if (results.metrics.length > 0) {
    summary += '### Benchmark Metrics\n\n';
    summary += '| Metric | Mean | Min | Max | Std Dev | Samples |\n';
    summary += '|--------|------|-----|-----|---------|--------|\n';

    for (const metric of results.metrics) {
      const stats = calculateStats(metric.values);
      summary += `| ${metric.name} | ${stats.mean.toFixed(2)} ${metric.unit} | `;
      summary += `${stats.min.toFixed(2)} ${metric.unit} | `;
      summary += `${stats.max.toFixed(2)} ${metric.unit} | `;
      summary += `${stats.stdDev.toFixed(2)} | `;
      summary += `${metric.values.length} |\n`;
    }

    summary += '\n';
  }

  // Add interpretation section
  summary += '### Metric Descriptions\n\n';
  summary += '| Metric | Description |\n';
  summary += '|--------|-------------|\n';
  summary += '| startup_time_ms | Time to start containers and execute a simple command |\n';
  summary += '| request_time_ms | Time to make an HTTP request through the proxy |\n';
  summary += '| download_time_ms | Time to download a small file through the proxy |\n';
  summary += '| memory_mb | Combined memory usage of containers |\n';
  summary += '| reject_time_ms | Time for proxy to reject a blocked domain request |\n';
  summary += '\n';

  // Try to load the full JSON report if available
  const reportPath = '/tmp/awf-benchmark-report.json';
  if (fs.existsSync(reportPath)) {
    try {
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
      summary += '### Environment\n\n';
      summary += `- **OS:** ${report.environment?.os || 'unknown'}\n`;
      summary += `- **Node.js:** ${report.environment?.nodeVersion || 'unknown'}\n`;
      summary += `- **CPU:** ${report.environment?.cpuModel || 'unknown'}\n`;
      summary += `- **CPU Cores:** ${report.environment?.cpuCount || 'unknown'}\n`;
      summary += `- **Memory:** ${report.environment?.totalMemoryMb || 'unknown'} MB\n`;
      summary += `- **Commit:** \`${(report.commitSha || 'unknown').substring(0, 7)}\`\n`;
      summary += '\n';
    } catch (error) {
      // Ignore parse errors
    }
  }

  return summary;
}

function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: generate-benchmark-summary.ts <output-file>');
    process.exit(1);
  }

  const outputFile = args[0];

  // Read benchmark output from file
  let benchmarkOutput: string;
  if (fs.existsSync(outputFile)) {
    benchmarkOutput = fs.readFileSync(outputFile, 'utf-8');
  } else {
    console.error(`Error: Output file not found: ${outputFile}`);
    process.exit(1);
  }

  // Generate summary
  const summary = generateSummary(benchmarkOutput);

  // Write to GITHUB_STEP_SUMMARY or stdout
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    fs.appendFileSync(summaryPath, summary);
    console.log('Benchmark summary generated successfully');
  } else {
    console.error('Warning: GITHUB_STEP_SUMMARY not set. Running outside GitHub Actions?');
    console.log('\n--- Benchmark Summary ---');
    console.log(summary);
  }
}

main();
