#!/bin/bash
set -e

# setup-everything-mcp-config.sh
# Sets up MCP configuration for @modelcontextprotocol/server-everything
#
# Usage: ./setup-everything-mcp-config.sh
#
# IMPORTANT: Copilot CLI v0.0.347+ requires:
#   1. Config at mcp-config.json (trying both ~/.copilot/ and ~/.config/)
#   2. "tools": ["*"] field to enable all tools
#   3. No "type" field
#   4. Use --disable-builtin-mcps flag when running copilot

# Write to both possible locations since documentation is unclear
CONFIG_DIR_1="$HOME/.copilot"
CONFIG_DIR_2="$HOME/.config"

echo "==========================================="
echo "Setting up MCP Configuration (Everything)"
echo "==========================================="
echo "MCP Server: @modelcontextprotocol/server-everything"
echo "Writing config to both possible locations:"
echo "  - $CONFIG_DIR_1/mcp-config.json"
echo "  - $CONFIG_DIR_2/mcp-config.json"
echo ""

# Create config directories
mkdir -p "$CONFIG_DIR_1"
mkdir -p "$CONFIG_DIR_2"

# Write MCP configuration to first location (~/.copilot/)
cat > "$CONFIG_DIR_1/mcp-config.json" << 'EOF'
{
  "mcpServers": {
    "everything": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-everything"
      ],
      "tools": ["*"]
    }
  }
}
EOF

# Write MCP configuration to second location (~/.config/)
cat > "$CONFIG_DIR_2/mcp-config.json" << 'EOF'
{
  "mcpServers": {
    "everything": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-everything"
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
echo "Available tools from everything MCP server:"
echo "  echo, add, longRunningOperation, printEnv, sampleLLM, getTinyImage,"
echo "  annotatedMessage, getResourceReference, startElicitation, structuredContent, listRoots"
echo ""
echo "Example:"
echo "  npx @github/copilot@0.0.347 \\"
echo "    --disable-builtin-mcps \\"
echo "    --allow-tool echo \\"
echo "    --allow-tool add \\"
echo "    --allow-tool printEnv \\"
echo "    --prompt 'your prompt'"
echo ""
echo "==========================================="
