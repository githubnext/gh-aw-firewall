#!/usr/bin/env node
/**
 * Smoke test for the awf binary
 *
 * This script verifies that the packaged binary works correctly by testing:
 * 1. Binary exists and is executable
 * 2. --version returns the expected version
 * 3. --help works and provides valid output
 *
 * Usage: npx tsx scripts/ci/smoke-test-binary.ts <binary-path> <expected-version>
 *
 * Example: npx tsx scripts/ci/smoke-test-binary.ts release/awf-linux-x64 0.7.0
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

function runTest(name: string, testFn: () => void): TestResult {
  try {
    testFn();
    return { name, passed: true, message: 'OK' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name, passed: false, message };
  }
}

function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: smoke-test-binary.ts <binary-path> <expected-version>');
    console.error('Example: npx tsx scripts/ci/smoke-test-binary.ts release/awf-linux-x64 0.7.0');
    process.exit(1);
  }

  const binaryPath = path.resolve(args[0]);
  const expectedVersion = args[1];

  console.log('='.repeat(50));
  console.log('Smoke Testing Binary');
  console.log('='.repeat(50));
  console.log(`Binary: ${binaryPath}`);
  console.log(`Expected version: ${expectedVersion}`);
  console.log('');

  const results: TestResult[] = [];

  // Test 1: Binary exists
  results.push(
    runTest('Binary exists', () => {
      if (!fs.existsSync(binaryPath)) {
        throw new Error(`Binary not found at: ${binaryPath}`);
      }
    })
  );

  // Test 2: Binary is executable
  results.push(
    runTest('Binary is executable', () => {
      try {
        fs.accessSync(binaryPath, fs.constants.X_OK);
      } catch {
        throw new Error(`Binary is not executable: ${binaryPath}`);
      }
    })
  );

  // Test 3: --version works and returns expected version
  results.push(
    runTest('--version works', () => {
      const output = execSync(`${binaryPath} --version`, {
        encoding: 'utf-8',
        timeout: 10000,
      }).trim();

      if (!output.includes(expectedVersion)) {
        throw new Error(
          `Version mismatch: expected "${expectedVersion}" but got "${output}"`
        );
      }
    })
  );

  // Test 4: --help works and contains expected sections
  results.push(
    runTest('--help works', () => {
      const output = execSync(`${binaryPath} --help`, {
        encoding: 'utf-8',
        timeout: 10000,
      });

      const requiredContent = ['--allow-domains', '--log-level', 'awf'];
      const missingContent = requiredContent.filter(
        (content) => !output.includes(content)
      );

      if (missingContent.length > 0) {
        throw new Error(
          `Help output missing expected content: ${missingContent.join(', ')}`
        );
      }
    })
  );

  // Print results
  console.log('Test Results:');
  console.log('-'.repeat(50));

  let allPassed = true;
  for (const result of results) {
    const status = result.passed ? '✓' : '✗';
    console.log(`${status} ${result.name}: ${result.message}`);
    if (!result.passed) {
      allPassed = false;
    }
  }

  console.log('-'.repeat(50));

  // Generate GitHub Actions summary if available
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = results.filter((r) => !r.passed).length;
    const statusEmoji = allPassed ? '✅' : '❌';

    let summary = `## ${statusEmoji} Binary Smoke Test\n\n`;
    summary += `**Binary:** \`${path.basename(binaryPath)}\`\n`;
    summary += `**Version:** ${expectedVersion}\n\n`;
    summary += `**Results:** ${passedCount} passed, ${failedCount} failed\n\n`;
    summary += '| Test | Status | Details |\n';
    summary += '|------|--------|--------|\n';

    for (const result of results) {
      const emoji = result.passed ? '✅' : '❌';
      summary += `| ${result.name} | ${emoji} | ${result.message} |\n`;
    }

    fs.appendFileSync(summaryPath, summary);
    console.log('\nSummary written to GITHUB_STEP_SUMMARY');
  }

  if (allPassed) {
    console.log('\n✅ All smoke tests passed!');
    process.exit(0);
  } else {
    console.log('\n❌ Some smoke tests failed!');
    process.exit(1);
  }
}

main();
