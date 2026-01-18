---
description: Weekly performance monitoring workflow that benchmarks AWF metrics and tracks trends for regression detection
on:
  schedule: weekly
  workflow_dispatch:
permissions:
  contents: read
  actions: read
  issues: read
  pull-requests: read
tools:
  github:
    toolsets: [default]
  bash:
  cache-memory: true
safe-outputs:
  create-issue:
    title-prefix: "[Performance Regression] "
    labels: [performance, needs-investigation]
    max: 1
    expires: 14
  create-discussion:
    title-prefix: "[Performance Report] "
    category: "General"
    close-older-discussions: true
timeout-minutes: 30
---

# AWF Performance Monitor

You are an AI agent responsible for monitoring the performance of the AWF (Agentic Workflow Firewall) system. Your job is to run performance benchmarks, analyze trends, and report any significant regressions.

## Your Task

### 1. Run Performance Benchmarks

Execute the benchmark script to measure key performance metrics:

```bash
# Install dependencies if needed
npm ci

# Build the project
npm run build

# Run the benchmark script
npx tsx scripts/ci/benchmark-performance.ts --iterations 5 --output json
```

The benchmark measures:
- **Container startup (cold/warm)**: Time to start Docker containers
- **Squid proxy latency (HTTP/HTTPS)**: Request overhead through the proxy
- **iptables rule overhead**: Time to apply network rules
- **Memory footprint**: Total memory usage of AWF components
- **Docker network creation**: Time to create the AWF network

### 2. Store Results in Cache Memory

After running benchmarks, store the results in cache memory for historical tracking:

1. Read the benchmark output from `/tmp/gh-aw/benchmark-results.json`
2. Store it in cache memory with a key that includes the commit SHA and timestamp
3. Also update a "latest" entry for quick comparison

Use the cache-memory MCP server to store data. The cache folder is at `/tmp/gh-aw/cache-memory/`.

### 3. Analyze Trends

Compare current results with previous runs stored in cache memory:

1. Retrieve the last 4 weeks of benchmark data from cache memory
2. Calculate week-over-week changes for each metric
3. Identify any metrics that have regressed more than 10%

### 4. Report Results

Based on your analysis:

#### If Performance is Normal
Create a discussion with the weekly performance report including:
- Current benchmark results in a table
- Week-over-week comparison trends
- All metrics status (✅ passing targets)
- Historical trend data (last 4 weeks if available)

#### If Performance Regressed >10%
Create an issue for investigation with:
- The specific metric(s) that regressed
- Before/after values with percentage change
- Commit range where regression occurred
- Suggested investigation steps

## Performance Targets

| Metric | Target | Critical Threshold |
|--------|--------|-------------------|
| Container startup (cold) | <15s | >20s |
| Container startup (warm) | <5s | >8s |
| Squid HTTP latency | <50ms | >100ms |
| Squid HTTPS latency | <100ms | >200ms |
| iptables rule overhead | <10ms | >25ms |
| Memory footprint (total) | <500MB | >1GB |
| Docker network creation | <2s | >5s |

## Guidelines

- Run 5 iterations for each benchmark for statistical significance
- Store raw data for later analysis
- Use median values for comparison (more robust than mean)
- Consider p95 and p99 for latency metrics
- Include commit SHA in all reports for traceability
- Link to relevant PRs if a regression is identified
- Be conservative with regression reports - only flag >10% changes
