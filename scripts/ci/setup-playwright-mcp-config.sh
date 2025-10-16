#!/bin/bash
set -e

# setup-playwright-mcp-config.sh
# Sets up MCP configuration for Playwright MCP server in Docker
#
# Usage: ./setup-playwright-mcp-config.sh
#
# IMPORTANT: Copilot CLI v0.0.347+ requires:
#   1. Config at mcp-config.json (trying both ~/.copilot/ and ~/.config/)
#   2. "tools": ["*"] field to enable all tools
#   3. No "type" field
#   4. Use --disable-builtin-mcps flag when running copilot

# Write to both possible locations since documentation is unclear
CONFIG_DIR_1="$HOME/.copilot"
CONFIG_DIR_2="$HOME/.config"
PLAYWRIGHT_IMAGE="${PLAYWRIGHT_IMAGE:-mcp/playwright@sha256:17a1383b6880169e8f53ab15f8aa3ba71df006592498410370c4cebc86e758d8}"

echo "==========================================="
echo "Setting up MCP Configuration (Playwright)"
echo "==========================================="
echo "MCP Server: Playwright (Docker)"
echo "Image: $PLAYWRIGHT_IMAGE"
echo "Writing config to both possible locations:"
echo "  - $CONFIG_DIR_1/mcp-config.json"
echo "  - $CONFIG_DIR_2/mcp-config.json"
echo ""

# Create config directories
mkdir -p "$CONFIG_DIR_1"
mkdir -p "$CONFIG_DIR_2"

# Write MCP configuration to first location (~/.copilot/)
cat > "$CONFIG_DIR_1/mcp-config.json" << EOF
{
  "mcpServers": {
    "playwright": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "$PLAYWRIGHT_IMAGE"
      ],
      "tools": ["*"]
    }
  }
}
EOF

# Write MCP configuration to second location (~/.config/)
cat > "$CONFIG_DIR_2/mcp-config.json" << EOF
{
  "mcpServers": {
    "playwright": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "$PLAYWRIGHT_IMAGE"
      ],
      "tools": ["*"]
    }
  }
}
EOF

echo "-------START MCP CONFIG-----------"
cat "$CONFIG_DIR_1/mcp-config.json"
echo "-------END MCP CONFIG-----------"
echo ""

# Verify config files exist
SUCCESS=true
if [ -f "$CONFIG_DIR_1/mcp-config.json" ]; then
  echo "✓ MCP config file created at $CONFIG_DIR_1/mcp-config.json"
else
  echo "✗ Failed to create MCP config file at $CONFIG_DIR_1/mcp-config.json"
  SUCCESS=false
fi

if [ -f "$CONFIG_DIR_2/mcp-config.json" ]; then
  echo "✓ MCP config file created at $CONFIG_DIR_2/mcp-config.json"
else
  echo "✗ Failed to create MCP config file at $CONFIG_DIR_2/mcp-config.json"
  SUCCESS=false
fi

if [ "$SUCCESS" = false ]; then
  exit 1
fi

echo ""
echo "IMPORTANT: When running Copilot CLI, use:"
echo "  --disable-builtin-mcps                         (disables built-in remote MCPs)"
echo "  --allow-tool <tool-name>                       (explicitly enable specific tools)"
echo ""
echo "Available Playwright MCP tools (32 total):"
echo "  browser_navigate, browser_click, browser_close, browser_take_screenshot,"
echo "  browser_fill_form, browser_type, browser_hover, browser_select_option,"
echo "  browser_evaluate, browser_snapshot, browser_console_messages, etc."
echo ""
echo "See https://github.com/microsoft/playwright-mcp for full list"
echo ""
echo "Example:"
echo "  npx @github/copilot@0.0.347 \\"
echo "    --disable-builtin-mcps \\"
echo "    --allow-tool browser_navigate \\"
echo "    --allow-tool browser_click \\"
echo "    --allow-tool browser_take_screenshot \\"
echo "    --prompt 'your prompt'"
echo ""
echo "==========================================="
