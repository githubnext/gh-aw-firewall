#!/bin/bash
set -e

# test-copilot-everything-mcp.sh
# Tests Copilot CLI with @modelcontextprotocol/server-everything through firewall
#
# Usage: ./test-copilot-everything-mcp.sh
#
# Environment variables:
#   GITHUB_TOKEN - GitHub token for Copilot CLI (required)
#   COPILOT_VERSION - Copilot CLI version to use (default: 0.0.347)
#
# IMPORTANT: Copilot CLI v0.0.347+ requires:
#   - MCP config at ~/.copilot/mcp-config.json (set up via setup-everything-mcp-config.sh)
#   - --disable-builtin-mcps flag to disable built-in remote MCPs
#   - --allow-tool 'everything' to enable all tools from the everything MCP server

set -o pipefail

COPILOT_VERSION="${COPILOT_VERSION:-0.0.347}"
ALLOWED_DOMAINS="api.github.com,api.anthropic.com,api.enterprise.githubcopilot.com,registry.npmjs.org,statsig.anthropic.com"

echo "==========================================="
echo "Copilot CLI + Everything MCP Server Test"
echo "==========================================="
echo "Environment variables:"
echo "  GITHUB_TOKEN: ${GITHUB_TOKEN:0:20}..."
echo "  HOME: $HOME"
echo "  COPILOT_VERSION: $COPILOT_VERSION"
echo ""
echo "MCP Configuration:"
echo "  Location: ~/.copilot/mcp-config.json (or ~/.config/mcp-config.json)"
echo "  Server: @modelcontextprotocol/server-everything"
echo "  Flags: --disable-builtin-mcps --allow-tool <tool-name> (for each tool)"
echo "  Allowed tools: echo, add, longRunningOperation, printEnv, sampleLLM,"
echo "                 getTinyImage, annotatedMessage, getResourceReference,"
echo "                 startElicitation, structuredContent, listRoots"
echo ""

# Clean up any leftover Docker resources from previous runs
echo "-------------------------------------------"
echo "Cleaning up leftover Docker resources..."
echo "-------------------------------------------"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/cleanup.sh"
echo ""

# Create log directories for Copilot debug logs
mkdir -p /tmp/copilot-logs-everything-test1
mkdir -p /tmp/copilot-logs-everything-test2

echo "-------------------------------------------"
echo "Test 1: Simple MCP prompt with everything server"
echo "-------------------------------------------"
echo "Testing @modelcontextprotocol/server-everything with --disable-builtin-mcps"
echo "Debug logs will be saved to /tmp/copilot-logs-everything-test1"
echo ""

timeout 60s sudo -E awf \
  --allow-domains "$ALLOWED_DOMAINS" \
  --log-level debug \
  "npx @github/copilot@${COPILOT_VERSION} --log-dir /tmp/copilot-logs-everything-test1 --log-level debug --disable-builtin-mcps --allow-all-paths --allow-tool everything --prompt 'List the available tools from the everything MCP server. Use the everything MCP server to respond.'" \
  2>&1 | tee /tmp/copilot-everything-test1.log || true

echo ""
echo "-------------------------------------------"
echo "Test 2: Testing MCP server tools"
echo "-------------------------------------------"
echo "Testing actual tool usage from the everything MCP server"
echo "Debug logs will be saved to /tmp/copilot-logs-everything-test2"
echo ""

PROMPT="Use the everything MCP server to perform a simple test. Tell me what capabilities the everything server provides and demonstrate one of its tools."

# Run copilot CLI through the firewall with everything MCP server
sudo -E awf \
  --allow-domains "$ALLOWED_DOMAINS" \
  --log-level debug \
  "npx @github/copilot@${COPILOT_VERSION} --log-dir /tmp/copilot-logs-everything-test2 --log-level debug --disable-builtin-mcps --allow-all-paths --allow-tool everything --prompt \"$PROMPT\"" \
  2>&1 | tee /tmp/copilot-everything-test2.log

echo ""
echo "-------------------------------------------"
echo "Log Analysis"
echo "-------------------------------------------"
echo "Checking logs for everything MCP server usage indicators..."
if grep -qi "everything\|modelcontextprotocol/server-everything\|MCP client for everything" /tmp/copilot-everything-test1.log /tmp/copilot-everything-test2.log 2>/dev/null; then
  echo "✓ Found evidence of everything MCP server usage in logs"
else
  echo "⚠ No clear evidence of everything MCP server usage found in logs"
  echo "  This may indicate the MCP server is not being used"
fi

echo ""
echo "Checking for built-in MCP usage (should NOT be present)..."
if grep -qi "builtin.*mcp\|remote MCP" /tmp/copilot-everything-test1.log /tmp/copilot-everything-test2.log 2>/dev/null; then
  echo "⚠ WARNING: Found evidence of built-in MCP server"
  echo "  The --disable-builtin-mcps flag may not be working correctly"
else
  echo "✓ No evidence of built-in MCPs (good!)"
fi

echo ""
echo "Checking for new debug features (copilot@0.0.347+)..."

# Check for API request IDs in debug logs
if find /tmp/copilot-logs-everything-test1/ /tmp/copilot-logs-everything-test2/ -type f -exec grep -l "request.*id\|x-request-id" {} + 2>/dev/null | head -1 > /dev/null; then
  echo "✓ Found API request IDs in debug logs"
else
  echo "⚠ No API request IDs found in debug logs"
fi

# Check for stack traces in debug logs
if find /tmp/copilot-logs-everything-test1/ /tmp/copilot-logs-everything-test2/ -type f -exec grep -l "stack\|trace\|Error:" {} + 2>/dev/null | head -1 > /dev/null; then
  echo "✓ Found stack trace information in debug logs"
else
  echo "✓ No errors with stack traces (this is good)"
fi

echo ""
echo "Listing Copilot debug logs..."
echo "Test 1 logs:"
ls -lah /tmp/copilot-logs-everything-test1/ || echo "No logs found for test 1"
echo ""
echo "Test 2 logs:"
ls -lah /tmp/copilot-logs-everything-test2/ || echo "No logs found for test 2"

echo ""
echo "==========================================="
echo "Test Complete"
echo "==========================================="
echo "Output files:"
echo "  - /tmp/copilot-everything-test1.log"
echo "  - /tmp/copilot-everything-test2.log"
echo "  - /tmp/copilot-logs-everything-test1/"
echo "  - /tmp/copilot-logs-everything-test2/"
echo "==========================================="
