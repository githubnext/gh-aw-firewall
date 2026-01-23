#!/bin/bash
# Example: Using Playwright browser automation through the firewall
#
# This example demonstrates how to run Playwright tests with domain restrictions.
# Playwright is a browser automation tool commonly used for testing web applications.

set -e

echo "🎭 Playwright Browser Automation Example"
echo "========================================"
echo ""

# Create a simple Playwright test script
cat > /tmp/playwright-example.js << 'EOF'
const { chromium } = require('playwright');

(async () => {
  console.log('🚀 Launching browser...');
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  console.log('📄 Creating new page...');
  const page = await browser.newPage();
  
  console.log('🌐 Navigating to GitHub...');
  await page.goto('https://github.com', { timeout: 30000 });
  
  const title = await page.title();
  console.log('✅ Page title:', title);
  
  if (!title.includes('GitHub')) {
    throw new Error('Expected title to contain "GitHub"');
  }
  
  console.log('📸 Taking screenshot...');
  await page.screenshot({ path: '/tmp/github-screenshot.png' });
  console.log('💾 Screenshot saved to /tmp/github-screenshot.png');
  
  await browser.close();
  console.log('✨ Test completed successfully!');
})();
EOF

echo "Created test script at /tmp/playwright-example.js"
echo ""
echo "Running Playwright test through firewall..."
echo "Allowed domains: github.com, registry.npmjs.org, playwright.azureedge.net, npmjs.com"
echo ""

# Run the test through the firewall
# Note: Requires sudo for iptables manipulation
sudo -E awf \
  --allow-domains github.com,registry.npmjs.org,playwright.azureedge.net,npmjs.com \
  --log-level info \
  -- bash -c "npx -y playwright@latest install chromium && node /tmp/playwright-example.js"

echo ""
echo "✅ Example completed!"
echo ""
echo "💡 Tips:"
echo "  - Add more domains to --allow-domains as needed for your tests"
echo "  - playwright.azureedge.net is needed for browser downloads"
echo "  - registry.npmjs.org and npmjs.com are needed for npm packages"
echo "  - Use --log-level debug to see detailed firewall logs"
