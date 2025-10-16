#!/bin/bash
set -e

# test-copilot-playwright-mcp.sh
# Tests Copilot CLI with Playwright MCP server through firewall
#
# Usage: ./test-copilot-playwright-mcp.sh
#
# Environment variables:
#   GITHUB_TOKEN - GitHub token for Copilot CLI (required)
#   COPILOT_VERSION - Copilot CLI version to use (default: 0.0.347)
#   PLAYWRIGHT_IMAGE - Playwright Docker image to use (optional)
#
# IMPORTANT: Copilot CLI v0.0.347+ requires:
#   - MCP config at ~/.copilot/mcp-config.json (set up via setup-playwright-mcp-config.sh)
#   - --disable-builtin-mcps flag to disable built-in remote MCPs
#   - --allow-tool flags to explicitly enable specific Playwright MCP tools

set -o pipefail

COPILOT_VERSION="${COPILOT_VERSION:-0.0.347}"
PLAYWRIGHT_IMAGE="${PLAYWRIGHT_IMAGE:-mcp/playwright@sha256:17a1383b6880169e8f53ab15f8aa3ba71df006592498410370c4cebc86e758d8}"
ALLOWED_DOMAINS="api.github.com,api.anthropic.com,api.enterprise.githubcopilot.com,registry.npmjs.org,statsig.anthropic.com,docker.io,registry-1.docker.io,auth.docker.io,production.cloudflare.docker.com,example.com"

echo "==========================================="
echo "Copilot CLI + Playwright MCP Server Test"
echo "==========================================="
echo "Environment variables:"
echo "  GITHUB_TOKEN: ${GITHUB_TOKEN:0:20}..."
echo "  HOME: $HOME"
echo "  COPILOT_VERSION: $COPILOT_VERSION"
echo "  PLAYWRIGHT_IMAGE: $PLAYWRIGHT_IMAGE"
echo ""
echo "MCP Configuration:"
echo "  Location: ~/.copilot/mcp-config.json (or ~/.config/mcp-config.json)"
echo "  Server: Playwright MCP (Docker)"
echo "  Flags: --disable-builtin-mcps --allow-tool <tool-name> (for each tool)"
echo "  Enabled tools: All 32 Playwright browser automation tools"
echo "    (browser_navigate, browser_click, browser_close, browser_take_screenshot,"
echo "     browser_fill_form, browser_type, browser_hover, etc.)"
echo ""

# Clean up any leftover Docker resources from previous runs
echo "-------------------------------------------"
echo "Cleaning up leftover Docker resources..."
echo "-------------------------------------------"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/cleanup.sh"
echo ""

# Create log directories for Copilot debug logs
mkdir -p /tmp/copilot-logs-playwright-test1
mkdir -p /tmp/copilot-logs-playwright-test2

echo "-------------------------------------------"
echo "Test 1: Simple MCP prompt with Playwright server"
echo "-------------------------------------------"
echo "Testing Playwright MCP server with --disable-builtin-mcps"
echo "Debug logs will be saved to /tmp/copilot-logs-playwright-test1"
echo ""

timeout 60s sudo -E awf \
  --allow-domains "$ALLOWED_DOMAINS" \
  --log-level debug \
  "npx @github/copilot@${COPILOT_VERSION} --log-dir /tmp/copilot-logs-playwright-test1 --log-level debug --disable-builtin-mcps --allow-all-paths --allow-tool browser_navigate --allow-tool browser_click --allow-tool browser_close --allow-tool browser_console_messages --allow-tool browser_drag --allow-tool browser_evaluate --allow-tool browser_file_upload --allow-tool browser_fill_form --allow-tool browser_handle_dialog --allow-tool browser_hover --allow-tool browser_navigate_back --allow-tool browser_network_requests --allow-tool browser_press_key --allow-tool browser_resize --allow-tool browser_select_option --allow-tool browser_snapshot --allow-tool browser_take_screenshot --allow-tool browser_type --allow-tool browser_wait_for --allow-tool browser_tabs --allow-tool browser_install --allow-tool browser_mouse_click_xy --allow-tool browser_mouse_drag_xy --allow-tool browser_mouse_move_xy --allow-tool browser_pdf_save --allow-tool browser_generate_locator --allow-tool browser_verify_element_visible --allow-tool browser_verify_list_visible --allow-tool browser_verify_text_visible --allow-tool browser_verify_value --allow-tool browser_start_tracing --allow-tool browser_stop_tracing --prompt 'List the available tools from the playwright MCP server. Use the playwright MCP server to respond.'" \
  2>&1 | tee /tmp/copilot-playwright-test1.log || true

echo ""
echo "-------------------------------------------"
echo "Test 2: Testing Playwright browser automation"
echo "-------------------------------------------"
echo "Testing browser automation capabilities via Playwright MCP"
echo "Debug logs will be saved to /tmp/copilot-logs-playwright-test2"
echo ""

PROMPT="Use the playwright MCP server to demonstrate browser automation. Navigate to https://example.com and tell me what you see on the page. Describe the capabilities that the Playwright MCP server provides."

# Run copilot CLI through the firewall with Playwright MCP server
sudo -E awf \
  --allow-domains "$ALLOWED_DOMAINS" \
  --log-level debug \
  "npx @github/copilot@${COPILOT_VERSION} --log-dir /tmp/copilot-logs-playwright-test2 --log-level debug --disable-builtin-mcps --allow-all-paths --allow-tool browser_navigate --allow-tool browser_click --allow-tool browser_close --allow-tool browser_console_messages --allow-tool browser_drag --allow-tool browser_evaluate --allow-tool browser_file_upload --allow-tool browser_fill_form --allow-tool browser_handle_dialog --allow-tool browser_hover --allow-tool browser_navigate_back --allow-tool browser_network_requests --allow-tool browser_press_key --allow-tool browser_resize --allow-tool browser_select_option --allow-tool browser_snapshot --allow-tool browser_take_screenshot --allow-tool browser_type --allow-tool browser_wait_for --allow-tool browser_tabs --allow-tool browser_install --allow-tool browser_mouse_click_xy --allow-tool browser_mouse_drag_xy --allow-tool browser_mouse_move_xy --allow-tool browser_pdf_save --allow-tool browser_generate_locator --allow-tool browser_verify_element_visible --allow-tool browser_verify_list_visible --allow-tool browser_verify_text_visible --allow-tool browser_verify_value --allow-tool browser_start_tracing --allow-tool browser_stop_tracing --prompt \"$PROMPT\"" \
  2>&1 | tee /tmp/copilot-playwright-test2.log

echo ""
echo "-------------------------------------------"
echo "Log Analysis"
echo "-------------------------------------------"
echo "Checking logs for Playwright MCP server usage indicators..."
if grep -qi "playwright\|mcp/playwright\|MCP client for playwright" /tmp/copilot-playwright-test1.log /tmp/copilot-playwright-test2.log 2>/dev/null; then
  echo "✓ Found evidence of Playwright MCP server usage in logs"
else
  echo "⚠ No clear evidence of Playwright MCP server usage found in logs"
  echo "  This may indicate the MCP server is not being used"
fi

echo ""
echo "Checking for built-in MCP usage (should NOT be present)..."
if grep -qi "builtin.*mcp\|remote MCP" /tmp/copilot-playwright-test1.log /tmp/copilot-playwright-test2.log 2>/dev/null; then
  echo "⚠ WARNING: Found evidence of built-in MCP server"
  echo "  The --disable-builtin-mcps flag may not be working correctly"
else
  echo "✓ No evidence of built-in MCPs (good!)"
fi

echo ""
echo "Checking for browser automation indicators..."
if grep -qi "browser\|navigate\|example.com\|page\|screenshot" /tmp/copilot-playwright-test1.log /tmp/copilot-playwright-test2.log 2>/dev/null; then
  echo "✓ Found browser automation activity in logs"
else
  echo "⚠ No clear browser automation activity found"
fi

echo ""
echo "Checking for new debug features (copilot@0.0.347+)..."

# Check for API request IDs in debug logs
if find /tmp/copilot-logs-playwright-test1/ /tmp/copilot-logs-playwright-test2/ -type f -exec grep -l "request.*id\|x-request-id" {} + 2>/dev/null | head -1 > /dev/null; then
  echo "✓ Found API request IDs in debug logs"
else
  echo "⚠ No API request IDs found in debug logs"
fi

# Check for stack traces in debug logs
if find /tmp/copilot-logs-playwright-test1/ /tmp/copilot-logs-playwright-test2/ -type f -exec grep -l "stack\|trace\|Error:" {} + 2>/dev/null | head -1 > /dev/null; then
  echo "✓ Found stack trace information in debug logs"
else
  echo "✓ No errors with stack traces (this is good)"
fi

echo ""
echo "Listing Copilot debug logs..."
echo "Test 1 logs:"
ls -lah /tmp/copilot-logs-playwright-test1/ || echo "No logs found for test 1"
echo ""
echo "Test 2 logs:"
ls -lah /tmp/copilot-logs-playwright-test2/ || echo "No logs found for test 2"

echo ""
echo "==========================================="
echo "Test Complete"
echo "==========================================="
echo "Output files:"
echo "  - /tmp/copilot-playwright-test1.log"
echo "  - /tmp/copilot-playwright-test2.log"
echo "  - /tmp/copilot-logs-playwright-test1/"
echo "  - /tmp/copilot-logs-playwright-test2/"
echo "==========================================="
