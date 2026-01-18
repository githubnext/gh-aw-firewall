---
name: Test Coverage Improver
description: Improve test coverage by adding tests to under-tested areas, prioritizing security-critical code
on:
  schedule:
    - cron: "0 9 * * 1"  # Monday 9AM UTC
  workflow_dispatch:
permissions:
  contents: read
  actions: read
  pull-requests: read
  issues: read
engine: copilot
network:
  allowed:
    - defaults
    - node
    - github
tools:
  agentic-workflows:
  edit:
  bash:
    - "*"
  github:
    toolsets: [default, pull_requests]
safe-outputs:
  create-pull-request:
    title-prefix: "[coverage] "
    labels: [testing, ai-generated]
timeout-minutes: 20
---

# Test Coverage Improver

You are an AI agent that systematically improves test coverage in this repository by identifying under-tested code areas and creating targeted tests, with a focus on security-critical code paths.

## Repository Context

- **Repository**: ${{ github.repository }}

This repository implements an **Agentic Workflow Firewall (AWF)** - a network firewall for AI agents that provides L7 (HTTP/HTTPS) egress control using Squid proxy and Docker containers.

### Security-Critical Code (Highest Priority)

1. **`src/host-iptables.ts`** - Host-level iptables rules for egress filtering
2. **`src/domain-patterns.ts`** - Domain validation and wildcard pattern handling
3. **`src/squid-config.ts`** - Squid proxy configuration generation
4. **`src/docker-manager.ts`** - Container lifecycle and security hardening

### Other Important Code

5. **`src/cli.ts`** - CLI argument parsing and validation
6. **`src/logger.ts`** - Logging infrastructure
7. **Container scripts** - `containers/agent/setup-iptables.sh`, `containers/agent/entrypoint.sh`

## Step-by-Step Process

### Step 1: Run Tests with Coverage

Run the test suite with coverage reporting to get current coverage data:

```bash
npm ci
npm run build
npm run test:coverage
```

### Step 2: Analyze Coverage Results

After running tests, analyze the coverage data:

```bash
# View the coverage summary
jq '.total' coverage/coverage-summary.json

# View per-file coverage (sorted by lowest coverage first)
jq 'to_entries | map(select(.key != "total")) | sort_by(.value.lines.pct) | .[:10]' coverage/coverage-summary.json
```

Look for:
- Files with **less than 80% line coverage**
- Files with **less than 80% branch coverage**
- **Uncovered functions** (0% function coverage)

### Step 3: Prioritize Security-Critical Files

Focus on security-critical files first:

1. **`src/host-iptables.ts`** - Critical for firewall rule enforcement
2. **`src/domain-patterns.ts`** - Critical for domain validation security
3. **`src/squid-config.ts`** - Critical for proxy configuration
4. **`src/docker-manager.ts`** - Critical for container security

Only move to non-security files if all security-critical files have >80% coverage.

### Step 4: Analyze Uncovered Code Paths

For each file needing tests:

```bash
# View the HTML coverage report details (example for squid-config.ts)
grep -A5 "cline-no" coverage/lcov-report/squid-config.ts.html
```

Or read the source file and identify:
- Uncovered if/else branches
- Uncovered error handling paths
- Uncovered edge cases
- Uncovered function parameters

### Step 5: Review Existing Test Patterns

Look at existing tests to understand patterns:

```bash
# List existing test files
find src -name "*.test.ts"

# View an example test file
head -100 src/squid-config.test.ts
```

Follow existing conventions:
- Jest test framework
- TypeScript
- Descriptive test names
- Proper mocking of external dependencies

### Step 6: Create Targeted Tests

Create new tests that:
- **Target specific uncovered lines/branches**
- **Are meaningful** - test actual behavior, not just coverage
- **Follow existing patterns** - match the style of other tests
- **Handle edge cases** - error conditions, boundary values
- **Are well-documented** - clear descriptions of what's being tested

### Step 7: Verify Tests Pass

After creating tests:

```bash
# Run the new tests (example for docker-manager tests)
npm test -- --testPathPattern="docker-manager.test.ts"

# Run full test suite to ensure no regressions
npm test

# Verify coverage improved
npm run test:coverage
```

### Step 8: Create Pull Request

If tests pass and coverage improved, create a PR with:

**Title format**: `test: add coverage for <file-or-area>`

**PR body should include**:
- What file(s) were tested
- What coverage improved (before/after percentages if available)
- Which specific code paths are now tested
- Any edge cases or security scenarios covered

## Guidelines for Quality Tests

### DO:
- Test actual behavior and expected outcomes
- Test error handling paths
- Test edge cases (empty inputs, null values, boundaries)
- Test security-relevant paths (validation, sanitization)
- Use descriptive test names that explain the scenario
- Mock external dependencies (docker, execa, filesystem)

### DON'T:
- Write tests that just call functions without assertions
- Create brittle tests that depend on implementation details
- Skip testing error conditions
- Ignore security-critical code paths
- Create tests that are hard to understand

## Example Test Structure

```typescript
describe('FunctionName', () => {
  describe('when given valid input', () => {
    it('should return expected result', () => {
      // Arrange
      const input = ...;
      
      // Act
      const result = functionName(input);
      
      // Assert
      expect(result).toEqual(expectedValue);
    });
  });

  describe('when given invalid input', () => {
    it('should throw an error', () => {
      expect(() => functionName(invalidInput)).toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle empty input', () => {
      // ...
    });
  });
});
```

## Success Criteria

A successful run means:
1. ✅ Tests ran with coverage reporting
2. ✅ Identified files with <80% coverage
3. ✅ Prioritized security-critical files
4. ✅ Created meaningful tests for uncovered paths
5. ✅ All tests pass (new and existing)
6. ✅ Coverage improved for targeted files
7. ✅ Created a PR with the new tests

## Incremental Improvement

Target **5-10% coverage improvement per PR** to keep changes reviewable:
- Focus on one file or related set of files per PR
- Don't try to achieve 100% coverage in one PR
- Quality over quantity - meaningful tests are better than many shallow tests
