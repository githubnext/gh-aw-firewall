#!/bin/bash
set -e

# setup-mcp-config.sh
# Sets up MCP configuration for GitHub MCP server
#
# Usage: ./setup-mcp-config.sh
#
# Environment variables:
#   GITHUB_PERSONAL_ACCESS_TOKEN - GitHub PAT for MCP server (required)
#
# IMPORTANT: Copilot CLI v0.0.347+ with awf requires:
#   1. Config at ~/.copilot/mcp-config.json
#   2. "tools": ["*"] field to enable all tools
#   3. "type": "local" field
#   4. "env" section with ${VAR} syntax for environment variable interpolation
#   5. Bare variable names in -e args (no $ prefix)
#   6. Use --disable-builtin-mcps and --allow-tool github flags when running copilot
#   7. Run awf with sudo -E to preserve environment variables

CONFIG_DIR="$HOME/.copilot"
MCP_VERSION="${MCP_VERSION:-v0.19.0}"

echo "==========================================="
echo "Setting up MCP Configuration"
echo "==========================================="
echo "MCP Server version: $MCP_VERSION"
echo "Writing config to: $CONFIG_DIR/mcp-config.json"
echo ""

# Create config directory
mkdir -p "$CONFIG_DIR"

# Write MCP configuration
# Note: Environment variables use ${VAR} syntax in env section for interpolation
cat > "$CONFIG_DIR/mcp-config.json" << EOF
{
  "mcpServers": {
    "github": {
      "type": "local",
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "-e",
        "GITHUB_TOOLSETS=default",
        "ghcr.io/github/github-mcp-server:${MCP_VERSION}"
      ],
      "tools": ["*"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "\${GITHUB_PERSONAL_ACCESS_TOKEN}"
      }
    }
  }
}
EOF

echo "-------START MCP CONFIG-----------"
cat "$CONFIG_DIR/mcp-config.json"
echo "-------END MCP CONFIG-----------"
echo ""

# Verify config file exists
if [ -f "$CONFIG_DIR/mcp-config.json" ]; then
  echo "✓ MCP config file created at $CONFIG_DIR/mcp-config.json"
else
  echo "✗ Failed to create MCP config file at $CONFIG_DIR/mcp-config.json"
  exit 1
fi

echo ""
echo "IMPORTANT: When running Copilot CLI through awf:"
echo "  1. Export environment variables:"
echo "       export GITHUB_TOKEN=\"<copilot-cli-token>\""
echo "       export GITHUB_PERSONAL_ACCESS_TOKEN=\"<github-pat>\""
echo ""
echo "  2. Run awf with sudo -E:"
echo "       sudo -E awf \\"
echo "         --allow-domains <domains> \\"
echo "         \"npx @github/copilot@0.0.347 \\"
echo "           --disable-builtin-mcps \\"
echo "           --allow-tool github \\"
echo "           --prompt 'your prompt'\""
echo ""
echo "Key flags:"
echo "  --disable-builtin-mcps    (disables read-only remote GitHub MCP)"
echo "  --allow-tool github       (enables all tools from 'github' MCP server)"
echo ""
echo "Common GitHub MCP tools (100+ available):"
echo "  get_me, search_issues, list_issues, create_issue, get_issue, update_issue,"
echo "  add_issue_comment, get_label, list_label, search_repositories,"
echo "  get_file_contents, list_pull_requests, create_pull_request"
echo ""
echo "See https://github.com/github/github-mcp-server for full list"
echo "==========================================="
