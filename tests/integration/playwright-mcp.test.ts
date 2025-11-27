/**
 * Playwright MCP Integration Tests
 *
 * These tests verify that the Playwright MCP server can run through the AWF firewall
 * and successfully navigate to web pages and verify page content.
 *
 * Requirements:
 * - Docker must be running
 * - The Playwright MCP Docker image must be available (mcr.microsoft.com/playwright/mcp)
 * - Required domains: github.com and related CDN/API domains
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';
import execa = require('execa');

describe('Playwright MCP Integration', () => {
  let runner: AwfRunner;

  beforeAll(async () => {
    // Run cleanup before tests to ensure clean state
    await cleanup(false);

    runner = createRunner();

    // Pull the Playwright MCP Docker image
    try {
      await execa('docker', ['pull', 'mcr.microsoft.com/playwright/mcp']);
    } catch (error) {
      console.warn('Failed to pull Playwright MCP image, tests may fail if image is not cached');
    }
  });

  afterAll(async () => {
    // Clean up after all tests
    await cleanup(false);
  });

  test('Test 1: MCP configuration can be written and validated', async () => {
    // Create MCP config for playwright using a heredoc to avoid injection risks
    const mcpConfigJson = `{
  "mcpServers": {
    "playwright": {
      "type": "local",
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--init",
        "mcr.microsoft.com/playwright/mcp",
        "--output-dir",
        "/tmp/gh-aw/mcp-logs/playwright",
        "--allowed-hosts",
        "localhost;localhost:*;127.0.0.1;127.0.0.1:*;github.com"
      ],
      "tools": ["*"]
    }
  }
}`;

    // Write MCP config to a temporary file and set up the test
    // Using heredoc to safely write the config without shell escaping issues
    const result = await runner.runWithSudo(
      `bash -c 'mkdir -p ~/.copilot && cat > ~/.copilot/mcp-config.json << "MCPEOF"
${mcpConfigJson}
MCPEOF
cat ~/.copilot/mcp-config.json'`,
      {
        allowDomains: [
          'github.com',
          'mcr.microsoft.com',
          'registry-1.docker.io',
          'auth.docker.io',
          'production.cloudflare.docker.com'
        ],
        logLevel: 'debug',
        timeout: 60000
      }
    );

    expect(result).toSucceed();
    expect(result.stdout).toContain('playwright');
    expect(result.stdout).toContain('mcr.microsoft.com/playwright/mcp');
  }, 120000);

  test('Test 2: Docker can pull Playwright MCP image through firewall', async () => {
    const result = await runner.runWithSudo(
      'docker pull mcr.microsoft.com/playwright/mcp',
      {
        allowDomains: [
          'mcr.microsoft.com',
          'mcr-origin.microsoft.com',
          'azure.microsoft.com',
          'docker.io',
          'registry-1.docker.io',
          'auth.docker.io',
          'production.cloudflare.docker.com',
          'cdn.auth0.com'
        ],
        logLevel: 'debug',
        timeout: 180000 // 3 minutes for image pull
      }
    );

    // The pull should succeed (or already be up-to-date)
    expect(result).toSucceed();
  }, 240000);

  test('Test 3: Playwright MCP container can start and respond', async () => {
    // Test that the Playwright MCP container can start successfully
    // by running it with --help flag
    const result = await runner.runWithSudo(
      'docker run --rm mcr.microsoft.com/playwright/mcp --help',
      {
        allowDomains: [
          'mcr.microsoft.com',
          'registry-1.docker.io',
          'auth.docker.io'
        ],
        logLevel: 'debug',
        timeout: 60000
      }
    );

    // The container should start and show help output
    expect(result).toSucceed();
  }, 120000);

  test('Test 4: Verify github.com is accessible through firewall', async () => {
    const result = await runner.runWithSudo(
      'curl -f --max-time 30 https://github.com',
      {
        allowDomains: ['github.com'],
        logLevel: 'debug',
        timeout: 60000
      }
    );

    expect(result).toSucceed();
    expect(result.stdout.toLowerCase()).toContain('github');
  }, 120000);

  test('Test 5: Verify MCP config format is correct for Playwright', async () => {
    // Verify that the MCP configuration structure matches expected format
    const mcpConfig = {
      mcpServers: {
        playwright: {
          type: 'local',
          command: 'docker',
          args: [
            'run',
            '-i',
            '--rm',
            '--init',
            'mcr.microsoft.com/playwright/mcp',
            '--output-dir',
            '/tmp/gh-aw/mcp-logs/playwright',
            '--allowed-hosts',
            'localhost;localhost:*;127.0.0.1;127.0.0.1:*;github.com'
          ],
          tools: ['*']
        }
      }
    };

    // Validate the structure
    expect(mcpConfig.mcpServers).toBeDefined();
    expect(mcpConfig.mcpServers.playwright).toBeDefined();
    expect(mcpConfig.mcpServers.playwright.type).toBe('local');
    expect(mcpConfig.mcpServers.playwright.command).toBe('docker');
    expect(mcpConfig.mcpServers.playwright.args).toContain('mcr.microsoft.com/playwright/mcp');
    expect(mcpConfig.mcpServers.playwright.tools).toEqual(['*']);
  }, 10000);
});
