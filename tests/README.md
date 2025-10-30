# Integration Tests

TypeScript-based integration tests for the awf (Agentic Workflow Firewall) CLI.

## Overview

This directory contains comprehensive integration tests that verify firewall behavior across multiple scenarios:

- **Basic Firewall Functionality** (`integration/basic-firewall.test.ts`) - 9 tests
  - Domain whitelisting
  - Subdomain matching
  - Exit code propagation
  - DNS resolution
  - Localhost connectivity
  - Container lifecycle management

- **Robustness Tests** - 20 tests split across 3 files for parallel execution:
  - `integration/robustness-basics.test.ts` (9 tests)
    - Happy-path basics (exact domains, subdomains, case insensitivity)
    - Deny cases (IP literals, non-standard ports)
    - Redirect behavior (cross-domain vs same-domain)
  - `integration/robustness-protocol.test.ts` (7 tests)
    - Protocol & transport edges (HTTP/2, DoH, bypass attempts)
    - Security corner cases
  - `integration/robustness-advanced.test.ts` (4 tests)
    - IPv4/IPv6 parity
    - Git operations
    - Observability (audit log validation)

- **Docker Egress Tests** - 19 tests split across 3 files for parallel execution:
  - `integration/docker-egress-basic.test.ts` (6 tests)
    - Basic container egress (allow/block)
    - Network modes (bridge, host, none, custom)
  - `integration/docker-egress-intermediate.test.ts` (6 tests)
    - DNS controls from containers
    - Proxy pivot attempts
    - Container-to-container bounce
    - UDP, QUIC, multicast from containers
  - `integration/docker-egress-advanced.test.ts` (7 tests)
    - Metadata & link-local protection
    - Privilege & capability abuse
    - Direct IP and SNI/Host mismatch
    - IPv6 from containers

## Test Structure

```
tests/
├── integration/          # Integration test suites
│   ├── basic-firewall.test.ts
│   ├── robustness-basics.test.ts
│   ├── robustness-protocol.test.ts
│   ├── robustness-advanced.test.ts
│   ├── docker-egress-basic.test.ts
│   ├── docker-egress-intermediate.test.ts
│   └── docker-egress-advanced.test.ts
├── fixtures/             # Reusable test utilities
│   ├── cleanup.ts        # Docker resource cleanup
│   ├── awf-runner.ts     # Execute awf commands
│   ├── docker-helper.ts  # Docker operations
│   ├── log-parser.ts     # Parse Squid/iptables logs
│   └── assertions.ts     # Custom Jest matchers
├── setup/
│   └── jest.integration.config.js  # Jest configuration
└── README.md             # This file
```

## Running Tests

### Prerequisites

1. **Build the project:**
   ```bash
   npm run build
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Ensure Docker is running:**
   ```bash
   docker ps
   ```

4. **Ensure sudo access:**
   Tests require sudo for iptables manipulation.

### Run All Tests

```bash
# Unit tests + Integration tests
npm run test:all
```

### Run Unit Tests Only

```bash
npm test:unit
```

### Run Integration Tests Only

```bash
npm run test:integration
```

### Run Specific Test Suite

```bash
# Run basic firewall tests
npm run test:integration -- basic-firewall

# Run all Docker egress tests
npm run test:integration -- docker-egress

# Run all robustness tests
npm run test:integration -- robustness

# Run specific split test suites
npm run test:integration -- robustness-basics
npm run test:integration -- robustness-protocol
npm run test:integration -- docker-egress-basic
```

### Run Single Test

```bash
npm run test:integration -- -t "Test 1: Basic connectivity"
```

## Test Fixtures

### AwfRunner

Helper for executing awf commands:

```typescript
import { createRunner } from '../fixtures/awf-runner';

const runner = createRunner();

// Run with sudo (required for iptables)
const result = await runner.runWithSudo('curl https://github.com', {
  allowDomains: ['github.com'],
  logLevel: 'debug',
  keepContainers: false,
});

// Check result
expect(result).toSucceed();
expect(result.exitCode).toBe(0);
```

### DockerHelper

Helper for Docker operations:

```typescript
import { createDockerHelper } from '../fixtures/docker-helper';

const docker = createDockerHelper();

// Pull image
await docker.pullImage('curlimages/curl:latest');

// Run container
await docker.run({
  image: 'curlimages/curl:latest',
  command: ['curl', 'https://github.com'],
  rm: true,
});

// Inspect container
const info = await docker.inspect('awf-squid');
const isRunning = await docker.isRunning('awf-squid');
```

### LogParser

Parser for Squid and iptables logs:

```typescript
import { createLogParser } from '../fixtures/log-parser';

const parser = createLogParser();

// Read and parse Squid logs
const entries = await parser.readSquidLog(workDir);

// Filter by decision
const allowed = parser.filterByDecision(entries, 'allowed');
const blocked = parser.filterByDecision(entries, 'blocked');

// Check if domain was allowed/blocked
const wasAllowed = parser.wasAllowed(entries, 'github.com');
const wasBlocked = parser.wasBlocked(entries, 'example.com');
```

### Cleanup

Cleanup utility for Docker resources:

```typescript
import { cleanup } from '../fixtures/cleanup';

// Run full cleanup
await cleanup(true); // true = verbose output
```

### Custom Matchers

Custom Jest matchers for firewall assertions:

```typescript
import { setupCustomMatchers } from '../fixtures/assertions';

setupCustomMatchers();

// Use custom matchers
expect(result).toSucceed();
expect(result).toFail();
expect(result).toExitWithCode(42);
expect(result).toAllowDomain('github.com');
expect(result).toBlockDomain('example.com');
expect(result).toTimeout();
```

## Configuration

Jest configuration for integration tests is in `tests/setup/jest.integration.config.js`:

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/../integration'],
  testMatch: ['**/*.test.ts'],
  testTimeout: 120000, // 2 minutes per test
  maxWorkers: 1, // Run tests serially to avoid Docker conflicts
};
```

## CI/CD Integration

Tests are designed to run in GitHub Actions. See `.github/workflows/test.yml` for the workflow configuration.

Key considerations:
- Tests run with `sudo -E` to preserve environment variables
- Docker images are pre-pulled to avoid timeouts
- Cleanup runs before and after tests to prevent resource leaks
- Artifacts (logs, reports) are collected on failure

## Troubleshooting

### Tests Fail with "Permission denied"

Ensure you're running with sudo:
```bash
sudo npm run test:integration
```

### Tests Timeout

Increase test timeout in `jest.integration.config.js`:
```javascript
testTimeout: 300000, // 5 minutes
```

### Docker Network Conflicts

Run cleanup before tests:
```bash
./scripts/ci/cleanup.sh
npm run test:integration
```

### Image Pull Timeouts

Pre-pull Docker images:
```bash
docker pull curlimages/curl:latest
docker pull alpine:latest
docker pull dannydirect/tinyproxy:latest
```

## Test Suite

The project uses TypeScript-based integration tests that run in CI via `.github/workflows/test-integration.yml`:

**Integration test suites:**
- `tests/integration/basic-firewall.test.ts` - Core firewall functionality (9 tests)
- `tests/integration/robustness-basics.test.ts` - Happy path & deny cases (9 tests)
- `tests/integration/robustness-protocol.test.ts` - Protocol edges & security (7 tests)
- `tests/integration/robustness-advanced.test.ts` - IPv6, Git, observability (4 tests)
- `tests/integration/docker-egress-basic.test.ts` - Basic container egress (6 tests)
- `tests/integration/docker-egress-intermediate.test.ts` - DNS, proxy, bounce (6 tests)
- `tests/integration/docker-egress-advanced.test.ts` - Security, IPv6 (7 tests)

**CI workflow:**
- Tests run in 7 parallel jobs for faster feedback
- All tests run with `sudo -E` for iptables manipulation
- Tests run serially within each job to avoid Docker resource conflicts
- Automatic cleanup before and after test runs
- Test logs uploaded as artifacts on failure
