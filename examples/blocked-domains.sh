#!/bin/bash
# Example: Domain blocking with allowlist and blocklist
#
# This example demonstrates how to use both allow and block lists.
# Blocked domains take precedence over allowed domains, enabling
# fine-grained control over network access.
#
# Usage: sudo ./examples/blocked-domains.sh

set -e

echo "=== AWF Domain Blocking Example ==="
echo ""

echo "1. Allow github.com but block a specific subdomain..."
echo ""
echo "   Allowing: github.com (includes all subdomains)"
echo "   Blocking: gist.github.com"
echo ""

# Block gist.github.com specifically while allowing other github.com subdomains
# api.github.com should work, gist.github.com should be blocked
echo "Attempting to access api.github.com (should succeed):"
sudo awf \
  --allow-domains github.com \
  --block-domains gist.github.com \
  --build-local \
  -- curl -s -o /dev/null -w "%{http_code}" https://api.github.com && echo " - OK"

echo ""
echo "Attempting to access gist.github.com (should be blocked):"
sudo awf \
  --allow-domains github.com \
  --block-domains gist.github.com \
  --build-local \
  -- curl -f --max-time 10 https://gist.github.com 2>&1 || echo " - Blocked (expected)"

echo ""
echo "2. Using wildcard patterns in blocklist..."
echo ""

# Block all subdomains matching a pattern
# Note: awf supports wildcards (*) in domain patterns
# Patterns are converted to regex internally (e.g., * becomes .*)
echo "Blocking all internal-* subdomains while allowing example.com:"
sudo awf \
  --allow-domains example.com \
  --block-domains 'internal-*.example.com' \
  --build-local \
  -- 'echo "Firewall configured with wildcard blocklist"'

echo ""
echo "=== Example Complete ==="
