/**
 * Playwright Testing Integration
 *
 * These tests verify that Playwright browser automation works correctly
 * through the firewall with proper domain whitelisting:
 * - Playwright can access allowed domains
 * - Blocked domains are properly blocked
 * - Basic browser automation features work
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';

describe('Playwright Testing', () => {
  let runner: AwfRunner;

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();
  });

  afterAll(async () => {
    await cleanup(false);
  });

  describe('Allowed Domain Access', () => {
    test('should allow Playwright to navigate to allowed domain', async () => {
      // Install Playwright and run a simple navigation test
      const command = `
        npx -y playwright@latest install chromium --with-deps && \
        node -e "
          const { chromium } = require('playwright');
          (async () => {
            const browser = await chromium.launch({ headless: true });
            const page = await browser.newPage();
            await page.goto('https://example.com', { timeout: 30000 });
            const title = await page.title();
            console.log('Page title:', title);
            if (!title || title.length === 0) {
              throw new Error('Failed to get page title');
            }
            await browser.close();
          })();
        "
      `;

      const result = await runner.runWithSudo(
        command,
        {
          allowDomains: ['example.com', 'registry.npmjs.org', 'playwright.azureedge.net'],
          logLevel: 'debug',
          timeout: 120000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('Page title:');
    }, 180000);

    test('should allow navigation to GitHub with Playwright', async () => {
      const command = `
        npx -y playwright@latest install chromium --with-deps && \
        node -e "
          const { chromium } = require('playwright');
          (async () => {
            const browser = await chromium.launch({ headless: true });
            const page = await browser.newPage();
            await page.goto('https://github.com', { timeout: 30000 });
            const title = await page.title();
            console.log('GitHub title:', title);
            if (!title.includes('GitHub')) {
              throw new Error('Expected title to contain GitHub, got: ' + title);
            }
            await browser.close();
            console.log('SUCCESS: GitHub navigation test passed');
          })();
        "
      `;

      const result = await runner.runWithSudo(
        command,
        {
          allowDomains: ['github.com', 'registry.npmjs.org', 'playwright.azureedge.net'],
          logLevel: 'debug',
          timeout: 120000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('GitHub title:');
      expect(result.stdout).toContain('SUCCESS: GitHub navigation test passed');
    }, 180000);
  });

  describe('Blocked Domain Handling', () => {
    test('should block Playwright navigation to non-allowed domain', async () => {
      const command = `
        npx -y playwright@latest install chromium --with-deps && \
        node -e "
          const { chromium } = require('playwright');
          (async () => {
            const browser = await chromium.launch({ headless: true });
            const page = await browser.newPage();
            try {
              await page.goto('https://example.com', { timeout: 10000 });
              console.log('ERROR: Should not have been able to navigate to example.com');
              process.exit(1);
            } catch (error) {
              console.log('EXPECTED: Navigation blocked as expected');
              console.log('Error:', error.message);
            }
            await browser.close();
          })();
        "
      `;

      const result = await runner.runWithSudo(
        command,
        {
          allowDomains: ['github.com', 'registry.npmjs.org', 'playwright.azureedge.net'],
          logLevel: 'debug',
          timeout: 90000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('EXPECTED: Navigation blocked');
    }, 150000);
  });

  describe('Browser Automation Features', () => {
    test('should support page interaction through firewall', async () => {
      const command = `
        npx -y playwright@latest install chromium --with-deps && \
        node -e "
          const { chromium } = require('playwright');
          (async () => {
            const browser = await chromium.launch({ headless: true });
            const page = await browser.newPage();
            await page.goto('https://example.com', { timeout: 30000 });
            
            // Get page content
            const content = await page.content();
            console.log('Page content length:', content.length);
            
            // Check for specific text
            const heading = await page.textContent('h1');
            console.log('Page heading:', heading);
            
            if (content.length === 0) {
              throw new Error('Failed to get page content');
            }
            
            await browser.close();
            console.log('SUCCESS: Page interaction test passed');
          })();
        "
      `;

      const result = await runner.runWithSudo(
        command,
        {
          allowDomains: ['example.com', 'registry.npmjs.org', 'playwright.azureedge.net'],
          logLevel: 'debug',
          timeout: 120000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('Page content length:');
      expect(result.stdout).toContain('SUCCESS: Page interaction test passed');
    }, 180000);

    test('should support multiple page navigation', async () => {
      const command = `
        npx -y playwright@latest install chromium --with-deps && \
        node -e "
          const { chromium } = require('playwright');
          (async () => {
            const browser = await chromium.launch({ headless: true });
            const page = await browser.newPage();
            
            // Navigate to first domain
            await page.goto('https://example.com', { timeout: 30000 });
            const title1 = await page.title();
            console.log('First page title:', title1);
            
            // Navigate to second domain
            await page.goto('https://www.iana.org', { timeout: 30000 });
            const title2 = await page.title();
            console.log('Second page title:', title2);
            
            if (!title1 || !title2) {
              throw new Error('Failed to navigate to both pages');
            }
            
            await browser.close();
            console.log('SUCCESS: Multiple navigation test passed');
          })();
        "
      `;

      const result = await runner.runWithSudo(
        command,
        {
          allowDomains: ['example.com', 'iana.org', 'registry.npmjs.org', 'playwright.azureedge.net'],
          logLevel: 'debug',
          timeout: 120000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('First page title:');
      expect(result.stdout).toContain('Second page title:');
      expect(result.stdout).toContain('SUCCESS: Multiple navigation test passed');
    }, 180000);
  });

  describe('Playwright with MCP-like scenarios', () => {
    test('should handle screenshot capture through firewall', async () => {
      const command = `
        npx -y playwright@latest install chromium --with-deps && \
        node -e "
          const { chromium } = require('playwright');
          (async () => {
            const browser = await chromium.launch({ headless: true });
            const page = await browser.newPage();
            await page.goto('https://example.com', { timeout: 30000 });
            
            // Take screenshot
            const screenshot = await page.screenshot();
            console.log('Screenshot captured, size:', screenshot.length, 'bytes');
            
            if (screenshot.length === 0) {
              throw new Error('Screenshot is empty');
            }
            
            await browser.close();
            console.log('SUCCESS: Screenshot test passed');
          })();
        "
      `;

      const result = await runner.runWithSudo(
        command,
        {
          allowDomains: ['example.com', 'registry.npmjs.org', 'playwright.azureedge.net'],
          logLevel: 'debug',
          timeout: 120000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('Screenshot captured');
      expect(result.stdout).toContain('SUCCESS: Screenshot test passed');
    }, 180000);
  });
});
