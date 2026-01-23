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
      // Create a test script that uses Playwright
      const testScript = `
cat > /tmp/playwright-test.js << 'TESTEOF'
const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.goto('https://example.com', { timeout: 30000 });
    const title = await page.title();
    console.log('Page title:', title);
    if (!title || title.length === 0) {
      process.exit(1);
    }
    await browser.close();
    console.log('SUCCESS: Test passed');
    process.exit(0);
  } catch (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
  }
})();
TESTEOF

npx -y playwright@latest install chromium && node /tmp/playwright-test.js
      `;

      const result = await runner.runWithSudo(
        testScript,
        {
          allowDomains: [
            'example.com', 
            'registry.npmjs.org', 
            'playwright.azureedge.net',
            'npmjs.com'
          ],
          logLevel: 'debug',
          timeout: 180000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('Page title:');
      expect(result.stdout).toContain('SUCCESS: Test passed');
    }, 240000);

    test('should allow navigation to GitHub with Playwright', async () => {
      const testScript = `
cat > /tmp/playwright-github-test.js << 'TESTEOF'
const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.goto('https://github.com', { timeout: 30000 });
    const title = await page.title();
    console.log('GitHub title:', title);
    if (!title.includes('GitHub')) {
      console.error('Expected title to contain GitHub, got:', title);
      process.exit(1);
    }
    await browser.close();
    console.log('SUCCESS: GitHub navigation test passed');
    process.exit(0);
  } catch (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
  }
})();
TESTEOF

npx -y playwright@latest install chromium && node /tmp/playwright-github-test.js
      `;

      const result = await runner.runWithSudo(
        testScript,
        {
          allowDomains: [
            'github.com', 
            'registry.npmjs.org', 
            'playwright.azureedge.net',
            'npmjs.com'
          ],
          logLevel: 'debug',
          timeout: 180000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('GitHub title:');
      expect(result.stdout).toContain('SUCCESS: GitHub navigation test passed');
    }, 240000);
  });

  describe('Blocked Domain Handling', () => {
    test('should block Playwright navigation to non-allowed domain', async () => {
      const testScript = `
cat > /tmp/playwright-blocked-test.js << 'TESTEOF'
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  try {
    await page.goto('https://example.com', { timeout: 10000 });
    console.log('ERROR: Should not have been able to navigate to example.com');
    await browser.close();
    process.exit(1);
  } catch (error) {
    console.log('EXPECTED: Navigation blocked as expected');
    console.log('Error:', error.message);
    await browser.close();
    process.exit(0);
  }
})();
TESTEOF

npx -y playwright@latest install chromium && node /tmp/playwright-blocked-test.js
      `;

      const result = await runner.runWithSudo(
        testScript,
        {
          allowDomains: [
            'github.com', 
            'registry.npmjs.org', 
            'playwright.azureedge.net',
            'npmjs.com'
          ],
          logLevel: 'debug',
          timeout: 180000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('EXPECTED: Navigation blocked');
    }, 240000);
  });

  describe('Browser Automation Features', () => {
    test('should support page interaction through firewall', async () => {
      const testScript = `
cat > /tmp/playwright-interaction-test.js << 'TESTEOF'
const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.goto('https://example.com', { timeout: 30000 });
    
    const content = await page.content();
    console.log('Page content length:', content.length);
    
    const heading = await page.textContent('h1');
    console.log('Page heading:', heading);
    
    if (content.length === 0) {
      throw new Error('Failed to get page content');
    }
    
    await browser.close();
    console.log('SUCCESS: Page interaction test passed');
    process.exit(0);
  } catch (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
  }
})();
TESTEOF

npx -y playwright@latest install chromium && node /tmp/playwright-interaction-test.js
      `;

      const result = await runner.runWithSudo(
        testScript,
        {
          allowDomains: [
            'example.com', 
            'registry.npmjs.org', 
            'playwright.azureedge.net',
            'npmjs.com'
          ],
          logLevel: 'debug',
          timeout: 180000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('Page content length:');
      expect(result.stdout).toContain('SUCCESS: Page interaction test passed');
    }, 240000);

    test('should support multiple page navigation', async () => {
      const testScript = `
cat > /tmp/playwright-multi-nav-test.js << 'TESTEOF'
const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    await page.goto('https://example.com', { timeout: 30000 });
    const title1 = await page.title();
    console.log('First page title:', title1);
    
    await page.goto('https://www.iana.org', { timeout: 30000 });
    const title2 = await page.title();
    console.log('Second page title:', title2);
    
    if (!title1 || !title2) {
      throw new Error('Failed to navigate to both pages');
    }
    
    await browser.close();
    console.log('SUCCESS: Multiple navigation test passed');
    process.exit(0);
  } catch (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
  }
})();
TESTEOF

npx -y playwright@latest install chromium && node /tmp/playwright-multi-nav-test.js
      `;

      const result = await runner.runWithSudo(
        testScript,
        {
          allowDomains: [
            'example.com', 
            'iana.org', 
            'registry.npmjs.org', 
            'playwright.azureedge.net',
            'npmjs.com'
          ],
          logLevel: 'debug',
          timeout: 180000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('First page title:');
      expect(result.stdout).toContain('Second page title:');
      expect(result.stdout).toContain('SUCCESS: Multiple navigation test passed');
    }, 240000);
  });

  describe('Playwright with MCP-like scenarios', () => {
    test('should handle screenshot capture through firewall', async () => {
      const testScript = `
cat > /tmp/playwright-screenshot-test.js << 'TESTEOF'
const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.goto('https://example.com', { timeout: 30000 });
    
    const screenshot = await page.screenshot();
    console.log('Screenshot captured, size:', screenshot.length, 'bytes');
    
    if (screenshot.length === 0) {
      throw new Error('Screenshot is empty');
    }
    
    await browser.close();
    console.log('SUCCESS: Screenshot test passed');
    process.exit(0);
  } catch (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
  }
})();
TESTEOF

npx -y playwright@latest install chromium && node /tmp/playwright-screenshot-test.js
      `;

      const result = await runner.runWithSudo(
        testScript,
        {
          allowDomains: [
            'example.com', 
            'registry.npmjs.org', 
            'playwright.azureedge.net',
            'npmjs.com'
          ],
          logLevel: 'debug',
          timeout: 180000,
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('Screenshot captured');
      expect(result.stdout).toContain('SUCCESS: Screenshot test passed');
    }, 240000);
  });
});
