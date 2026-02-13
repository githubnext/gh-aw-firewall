#!/bin/bash
# Example: Basic curl request through the firewall
#
# This example demonstrates the simplest use case: making an HTTP request
# through the firewall with a specific domain allowlist.
#
# Usage: sudo ./examples/basic-curl.sh

set -e

echo "=== AWF Basic Curl Example ==="
echo ""
echo "Making a request to api.github.com (allowed)"
echo ""

# Simple curl request to GitHub API
# The --allow-domains flag specifies which domains are accessible
# Subdomains are automatically included (github.com includes api.github.com)
sudo awf \
  --allow-domains github.com \
  --build-local \
  -- curl -s https://api.github.com | head -20

echo ""
echo "=== Example Complete ==="
