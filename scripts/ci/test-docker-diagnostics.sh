#!/bin/bash
set -e

# test-docker-diagnostics.sh
# Runs Docker and MCP diagnostics inside the copilot container
#
# Usage: ./test-docker-diagnostics.sh
#
# Environment variables:
#   GITHUB_TOKEN - GitHub token for Copilot CLI
#   GITHUB_PERSONAL_ACCESS_TOKEN - GitHub PAT for MCP server

ALLOWED_DOMAINS="${ALLOWED_DOMAINS:-raw.githubusercontent.com,api.github.com,github.com,registry.npmjs.org}"
LOG_FILE="${LOG_FILE:-/tmp/docker-mcp-diagnostics.log}"

echo "==========================================="
echo "Docker & MCP Diagnostics Test"
echo "==========================================="
echo "Testing Docker access and MCP config inside copilot container"
echo "Allowed domains: $ALLOWED_DOMAINS"
echo "Log file: $LOG_FILE"
echo ""

# Create the diagnostic command
DIAGNOSTIC_CMD='bash -c '"'"'
echo "=== Environment Variables ==="
echo "HOME: $HOME"
echo "GITHUB_TOKEN: ${GITHUB_TOKEN:0:20}..."
echo "GITHUB_PERSONAL_ACCESS_TOKEN: ${GITHUB_PERSONAL_ACCESS_TOKEN:0:20}..."
echo ""

echo "=== MCP Config File Check ==="
echo "NOTE: Copilot CLI v0.0.347+ requires config at ~/.copilot/mcp-config.json"
if [ -f "$HOME/.copilot/mcp-config.json" ]; then
  echo "✓ Found at $HOME/.copilot/mcp-config.json"
  cat "$HOME/.copilot/mcp-config.json"
else
  echo "✗ MCP config not found at $HOME/.copilot/mcp-config.json"
  echo "Checking possible locations:"
  ls -la "$HOME/.copilot/" 2>/dev/null || echo "No $HOME/.copilot/ directory"
  ls -la "$HOME/.config/copilot/" 2>/dev/null || echo "No $HOME/.config/copilot/ directory (old location)"
fi
echo ""

echo "=== Docker Access Test ==="
if command -v docker &> /dev/null; then
  echo "✓ docker command is available"
  docker --version
  echo ""
  echo "Testing docker ps..."
  docker ps || echo "✗ docker ps failed"
  echo ""
  echo "Testing if we can run a simple container..."
  docker run --rm hello-world || echo "✗ Failed to run hello-world container"
else
  echo "✗ docker command not found"
fi
echo ""

echo "=== GitHub MCP Server Docker Image ==="
docker images | grep github-mcp-server || echo "GitHub MCP server image not pulled"
echo ""

echo "=== Try to run MCP server manually ==="
echo '"'"'{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}'"'"' | timeout 10s docker run -i --rm \
  -e GITHUB_PERSONAL_ACCESS_TOKEN="${GITHUB_PERSONAL_ACCESS_TOKEN}" \
  -e GITHUB_TOOLSETS=all \
  ghcr.io/github/github-mcp-server:v0.18.0 2>&1 || echo "✗ Manual MCP server test failed"
'"'"

# Run diagnostics through awf
sudo awf \
  --allow-domains "$ALLOWED_DOMAINS" \
  --log-level debug \
  --keep-containers \
  "$DIAGNOSTIC_CMD" 2>&1 | tee "$LOG_FILE" || true

echo ""
echo "==========================================="
echo "Diagnostic logs saved to $LOG_FILE"
echo "==========================================="
