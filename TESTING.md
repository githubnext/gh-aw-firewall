# Testing Guide

This document describes the testing infrastructure and coverage goals for the GitHub Agentic Workflow Firewall project.

## Overview

The project uses Jest as the testing framework with TypeScript support via ts-jest and Babel for ESM module transformation. All tests are located in the `src/` directory alongside their corresponding source files using the `.test.ts` suffix.

### ESM Module Support

The test infrastructure is configured to handle ESM-only dependencies (like chalk 5.x, execa 9.x, commander 14.x) through:

- **babel.config.js**: Transforms ESM syntax to CommonJS for Jest compatibility
- **jest.config.js**: Includes `transformIgnorePatterns` to transform ESM packages in node_modules
- **babel-jest**: Handles JavaScript module transformation
- **@babel/preset-env**: Targets current Node.js version for optimal transformation

This configuration allows the project to:
- Use modern ESM-only npm packages in tests
- Mock ESM modules with Jest's standard mocking API
- Maintain compatibility with the existing TypeScript + CommonJS codebase

## Running Tests

### Basic Test Commands

```bash
# Run all tests
npm test

# Run tests in watch mode (auto-rerun on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run a specific test file
npm test -- src/logger.test.ts

# Run tests matching a pattern
npm test -- --testNamePattern="should log debug messages"
```

### Build and Lint

```bash
# Build TypeScript to JavaScript
npm run build

# Run linter
npm run lint

# Clean build artifacts
npm run clean
```

## Coverage Reports

The project generates comprehensive coverage reports in multiple formats:

### Viewing Coverage

After running `npm run test:coverage`, coverage reports are available in the `coverage/` directory:

- **HTML Report**: Open `coverage/index.html` in a browser for an interactive view
- **Terminal**: Coverage summary is displayed in the console after test run
- **LCOV**: `coverage/lcov.info` for integration with CI/CD tools
- **JSON**: `coverage/coverage-summary.json` for programmatic access

### CI/CD Coverage Reporting

The project includes automated test coverage reporting via GitHub Actions (`.github/workflows/test-coverage.yml`):

- **Automatic PR Comments**: Coverage reports are automatically posted as comments on pull requests
- **GitHub Actions Summary**: Each workflow run includes a coverage summary in the job output
- **Coverage Artifacts**: Full coverage reports are uploaded as artifacts for 30 days
- **Update Strategy**: Existing coverage comments are updated on subsequent pushes to avoid comment spam

The coverage workflow runs on:
- All pull requests to `main`
- All pushes to `main`

Required permissions:
- `contents: read` - To checkout the repository
- `pull-requests: write` - To post/update PR comments
- `checks: write` - To update check status

### Coverage Thresholds

The project maintains the following minimum coverage thresholds (configured in `jest.config.js`):

| Metric     | Threshold |
|-----------|-----------|
| Statements | 38%       |
| Branches   | 30%       |
| Functions  | 35%       |
| Lines      | 38%       |

Tests will fail if coverage drops below these thresholds.

## Current Coverage Status

As of the latest update:

| File              | Statements | Branches | Functions | Lines  | Status |
|-------------------|------------|----------|-----------|--------|--------|
| cli-workflow.ts   | 100%       | 100%     | 100%      | 100%   | ✅     |
| squid-config.ts   | 100%       | 100%     | 100%      | 100%   | ✅     |
| logger.ts         | 100%       | 100%     | 100%      | 100%   | ✅     |
| host-iptables.ts  | 83.63%     | 55.55%   | 100%      | 83.63% | ⚠️     |
| docker-manager.ts | 18%        | 22.22%   | 4%        | 17.15% | ❌     |
| cli.ts            | 0%         | 0%       | 0%        | 0%     | ❌     |
| **Overall**       | **38.39%** | **31.78%** | **37.03%** | **38.31%** | ⚠️ |

### Coverage Goals

- ✅ **Excellent** (>80%): Functions and modules with high coverage
- ⚠️ **Good** (50-80%): Acceptable coverage, improvement recommended
- ❌ **Needs Improvement** (<50%): Priority areas for adding tests

## Test Structure

### Test File Naming

- Tests are colocated with source files
- Test files use the `.test.ts` extension
- Example: `logger.ts` → `logger.test.ts`

### Test Organization

Tests follow this structure:

```typescript
import { functionToTest } from './module';

describe('module name', () => {
  describe('function or class name', () => {
    it('should do something specific', () => {
      // Test implementation
      expect(result).toBe(expected);
    });
  });
});
```

### Mocking

The project uses Jest's built-in mocking capabilities:

```typescript
// Mock external dependencies
jest.mock('execa');

// Mock console output in tests
const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

// Mock chalk for cleaner test output
jest.mock('chalk', () => ({
  gray: jest.fn((text) => text),
  blue: jest.fn((text) => text),
  // ... other colors
}));
```

## Writing New Tests

### Best Practices

1. **Test Behavior, Not Implementation**: Focus on what the code does, not how it does it
2. **Clear Test Names**: Use descriptive test names that explain the expected behavior
3. **Arrange-Act-Assert**: Structure tests in three clear sections
4. **Test Edge Cases**: Include tests for boundary conditions and error cases
5. **Mock External Dependencies**: Isolate the unit under test from external systems
6. **Clean Up**: Use `beforeEach` and `afterEach` to reset state between tests

### Example Test

```typescript
describe('logger', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    logger.setLevel('info');
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('should log info messages when level is info', () => {
    logger.info('test message');
    expect(consoleErrorSpy).toHaveBeenCalledWith('[INFO] test message');
  });
});
```

## Continuous Integration

The project runs tests automatically on:

- Pull request creation and updates
- Pushes to main branch
- Scheduled daily runs

CI checks include:

1. Linting with ESLint
2. TypeScript compilation
3. Full test suite execution
4. Coverage report generation
5. Coverage threshold validation

### Test Parallelization Strategy

The project uses a multi-level parallelization strategy to optimize CI time:

#### Unit Tests (Jest Workers)
- Unit tests run in parallel using Jest's worker pool
- Configuration: `maxWorkers: '50%'` uses half of available CPU cores
- Tests are isolated and have no shared state, making them safe to parallelize
- Run time: ~6-8 seconds for 549 tests

#### Integration Tests (GitHub Actions Matrix)
- Integration tests run in separate GitHub Actions runners using a matrix strategy
- Each test file runs in its own isolated environment to avoid Docker conflicts
- Test files run in parallel across multiple runners:
  - `basic-firewall.test.ts` - Core firewall functionality
  - `robustness.test.ts` - Comprehensive edge cases
  - `volume-mounts.test.ts` - Volume mount functionality
  - `container-workdir.test.ts` - Working directory configuration
  - `no-docker.test.ts` - Docker-in-Docker removal verification

**Why Integration Tests Can't Use Jest Workers:**
- Integration tests use Docker containers that share network resources
- Running multiple tests simultaneously would cause:
  - Docker network subnet pool exhaustion
  - Container name conflicts
  - Port binding conflicts
- The `maxWorkers: 1` setting in `jest.integration.config.js` ensures sequential execution within each runner

**Benefits of Matrix Strategy:**
- Each test file runs on a dedicated runner (full isolation)
- All test files run in parallel (reduces wall-clock time)
- `fail-fast: false` ensures all tests complete even if one fails
- Individual test artifacts are captured for failed tests

## Debugging Tests

### Running Tests in Debug Mode

```bash
# Run tests with Node debugger
node --inspect-brk node_modules/.bin/jest --runInBand

# Run tests with increased timeout
npm test -- --testTimeout=10000
```

### Common Issues

1. **Test Timeout**: Increase timeout for slow tests using `jest.setTimeout(10000)` in test file
2. **Mock Not Working**: Ensure mocks are defined before imports using `jest.mock()`
3. **Async Tests Failing**: Make sure to `await` async operations and use `done()` callback if needed
4. **Coverage Not Generated**: Check that files match patterns in `collectCoverageFrom` in jest.config.js

## Test Files

The project includes the following test files:

- `cli-workflow.test.ts`: Tests for the main workflow orchestration
- `cli.test.ts`: Tests for CLI argument parsing and command execution
- `docker-manager.test.ts`: Tests for Docker container management
- `host-iptables.test.ts`: Tests for iptables firewall configuration
- `jest-esm-config.test.ts`: Tests for Jest ESM configuration and module transformation
- `logger.test.ts`: Tests for logging functionality
- `squid-config.test.ts`: Tests for Squid proxy configuration generation

## Coverage Improvement Strategy

To improve coverage in low-coverage areas:

1. **docker-manager.ts** (Current: 18%)
   - Add tests for container lifecycle functions
   - Test error handling paths
   - Mock Docker API interactions

2. **cli.ts** (Current: 0%)
   - Test CLI entry point with various argument combinations
   - Test error handling and validation
   - Mock subprocess execution

3. **host-iptables.ts** (Current: 83.63%)
   - Test remaining edge cases
   - Add tests for error conditions
   - Test cleanup scenarios

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [ts-jest Documentation](https://kulshekhar.github.io/ts-jest/)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
