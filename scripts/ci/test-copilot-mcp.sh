#!/bin/bash
set -e

# test-copilot-mcp.sh
# Tests Copilot CLI with GitHub MCP server through firewall
#
# Usage: ./test-copilot-mcp.sh
#
# Environment variables:
#   GITHUB_TOKEN - GitHub token for Copilot CLI (required)
#   GITHUB_PERSONAL_ACCESS_TOKEN - GitHub PAT for MCP server (required)
#   COPILOT_VERSION - Copilot CLI version to use (default: 0.0.347)
#   GITHUB_REPOSITORY - Repository slug for issue creation (default: githubnext/gh-aw-firewall)
#   GITHUB_RUN_ID - Workflow run ID for issue body (optional)
#   GITHUB_SERVER_URL - GitHub server URL for issue body (optional)
#
# IMPORTANT: Copilot CLI v0.0.347+ requires:
#   - MCP config at ~/.copilot/mcp-config.json (set up via setup-mcp-config.sh)
#   - --disable-builtin-mcps flag to disable read-only remote GitHub MCP
#   - --allow-tool github-local to enable the local MCP server

set -o pipefail

COPILOT_VERSION="${COPILOT_VERSION:-0.0.347}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-githubnext/gh-aw-firewall}"
ALLOWED_DOMAINS="raw.githubusercontent.com,api.github.com,github.com,api.anthropic.com,api.enterprise.githubcopilot.com,registry.npmjs.org,statsig.anthropic.com,ghcr.io,docker.io,registry-1.docker.io,auth.docker.io,production.cloudflare.docker.com"

echo "==========================================="
echo "Copilot CLI + Local MCP Server Test"
echo "==========================================="
echo "Environment variables:"
echo "  GITHUB_TOKEN: ${GITHUB_TOKEN:0:20}..."
echo "  GITHUB_PERSONAL_ACCESS_TOKEN: ${GITHUB_PERSONAL_ACCESS_TOKEN:0:20}..."
echo "  HOME: $HOME"
echo "  COPILOT_VERSION: $COPILOT_VERSION"
echo ""
echo "MCP Configuration:"
echo "  Location: ~/.copilot/mcp-config.json (or ~/.config/mcp-config.json)"
echo "  Flags: --disable-builtin-mcps --allow-tool github-local"
echo ""

# Clean up any leftover Docker resources from previous runs
echo "-------------------------------------------"
echo "Cleaning up leftover Docker resources..."
echo "-------------------------------------------"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/cleanup.sh"
echo ""

# Create log directories for Copilot debug logs
mkdir -p /tmp/copilot-logs-test1
mkdir -p /tmp/copilot-logs-test2

echo "-------------------------------------------"
echo "Test 1: Simple MCP prompt with local server"
echo "-------------------------------------------"
echo "Testing local github MCP server with --disable-builtin-mcps"
echo "Debug logs will be saved to /tmp/copilot-logs-test1"
echo ""

timeout 60s sudo -E awf \
  --allow-domains "$ALLOWED_DOMAINS" \
  --log-level debug \
  "npx @github/copilot@${COPILOT_VERSION} --log-dir /tmp/copilot-logs-test1 --log-level debug --disable-builtin-mcps --allow-all-paths --allow-tool github --prompt \"What is my GitHub username? Use the github MCP server to find out.\"" \
  2>&1 | tee /tmp/copilot-simple-prompt.log || true

echo ""
echo "-------------------------------------------"
echo "Test 2: Issue creation with local MCP server"
echo "-------------------------------------------"
echo "Using --allow-tool github to enable all MCP tools"
echo "Debug logs will be saved to /tmp/copilot-logs-test2"
echo ""

# Define the prompt for creating a test issue
WORKFLOW_INFO=""
if [ -n "$GITHUB_RUN_ID" ] && [ -n "$GITHUB_SERVER_URL" ]; then
  WORKFLOW_INFO="The workflow run that created this issue: $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
fi

PROMPT="Create a test issue in the repository $GITHUB_REPOSITORY with the following details:
- Title: 'Test Issue from Firewall CI'
- Body: 'This is an automated test issue created by the firewall CI test at $(date -u +"%Y-%m-%d %H:%M:%S UTC"). This test validates that Copilot CLI can access the local github MCP server through the firewall to create issues. $WORKFLOW_INFO'
- Labels: 'test', 'automated'

After creating the issue, confirm the issue number and URL."

# Run copilot CLI through the firewall with local MCP server
sudo -E awf \
  --allow-domains "$ALLOWED_DOMAINS" \
  --log-level debug \
  "npx @github/copilot@${COPILOT_VERSION} --log-dir /tmp/copilot-logs-test2 --log-level debug --disable-builtin-mcps --allow-all-paths --allow-tool github --prompt \"$PROMPT\"" \
  2>&1 | tee /tmp/copilot-output.log

echo ""
echo "-------------------------------------------"
echo "Log Analysis"
echo "-------------------------------------------"
echo "Checking logs for local MCP server usage indicators..."
if grep -qi "github\|docker.*github-mcp-server\|MCP client for github" /tmp/copilot-output.log /tmp/copilot-simple-prompt.log 2>/dev/null; then
  echo "✓ Found evidence of local github MCP server usage in logs"
else
  echo "⚠ No clear evidence of local MCP server usage found in logs"
  echo "  This may indicate the local MCP server is not being used"
  echo "  Check if remote read-only MCP is being used instead"
fi

echo ""
echo "Checking for read-only remote MCP usage (should NOT be present)..."
if grep -qi "mcp/readonly\|remote MCP client for github-mcp-server" /tmp/copilot-output.log /tmp/copilot-simple-prompt.log 2>/dev/null; then
  echo "⚠ WARNING: Found evidence of read-only remote MCP server"
  echo "  The --disable-builtin-mcps flag may not be working correctly"
else
  echo "✓ No evidence of read-only remote MCP (good!)"
fi

echo ""
echo "Checking for new debug features (copilot@0.0.347+)..."

# Check for API request IDs in debug logs
if find /tmp/copilot-logs-test1/ /tmp/copilot-logs-test2/ -type f -exec grep -l "request.*id\|x-request-id" {} + 2>/dev/null | head -1 > /dev/null; then
  echo "✓ Found API request IDs in debug logs"
else
  echo "⚠ No API request IDs found in debug logs"
fi

# Check for stack traces in debug logs
if find /tmp/copilot-logs-test1/ /tmp/copilot-logs-test2/ -type f -exec grep -l "stack\|trace\|Error:" {} + 2>/dev/null | head -1 > /dev/null; then
  echo "✓ Found stack trace information in debug logs"
else
  echo "✓ No errors with stack traces (this is good)"
fi

echo ""
echo "Listing Copilot debug logs..."
echo "Test 1 logs:"
ls -lah /tmp/copilot-logs-test1/ || echo "No logs found for test 1"
echo ""
echo "Test 2 logs:"
ls -lah /tmp/copilot-logs-test2/ || echo "No logs found for test 2"

echo ""
echo "==========================================="
echo "Test Complete"
echo "==========================================="
echo "Output files:"
echo "  - /tmp/copilot-simple-prompt.log"
echo "  - /tmp/copilot-output.log"
echo "  - /tmp/copilot-logs-test1/"
echo "  - /tmp/copilot-logs-test2/"
echo "==========================================="
