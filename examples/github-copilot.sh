#!/bin/bash
# Example: Using GitHub Copilot CLI with the firewall
#
# This example shows how to run GitHub Copilot CLI through the firewall.
# Copilot requires access to several GitHub domains.
#
# Prerequisites:
# - GitHub Copilot CLI installed: npm install -g @github/copilot
# - GITHUB_TOKEN environment variable set
#
# Usage: sudo -E ./examples/github-copilot.sh

set -e

echo "=== AWF GitHub Copilot CLI Example ==="
echo ""

# Check for GITHUB_TOKEN
if [ -z "$GITHUB_TOKEN" ]; then
  echo "Error: GITHUB_TOKEN environment variable is not set"
  echo "Set it with: export GITHUB_TOKEN='your_token'"
  exit 1
fi

echo "Running GitHub Copilot CLI through the firewall..."
echo ""

# Run Copilot CLI with required domains
# Use sudo -E to preserve environment variables (especially GITHUB_TOKEN)
# Required domains:
# - github.com: GitHub API access
# - api.github.com: GitHub REST API
# - api.enterprise.githubcopilot.com: Copilot API endpoint
# - registry.npmjs.org: NPM package registry (for npx)
sudo -E awf \
  --allow-domains github.com,api.github.com,api.enterprise.githubcopilot.com,registry.npmjs.org \
  --build-local \
  -- 'npx @github/copilot --prompt "What is 2+2?" --no-mcp'

echo ""
echo "=== Example Complete ==="
