#!/bin/bash
# Example: Using a domains file for allowed domains
#
# Instead of specifying domains on the command line, you can use a file
# containing the list of allowed domains. This is useful for:
# - Managing large domain lists
# - Sharing domain configurations across teams
# - Version controlling domain allowlists
#
# Usage: sudo ./examples/using-domains-file.sh

set -e

echo "=== AWF Using Domains File Example ==="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOMAINS_FILE="$SCRIPT_DIR/domains.txt"

echo "Using domains file: $DOMAINS_FILE"
echo ""
echo "Contents of domains file:"
echo "---"
cat "$DOMAINS_FILE"
echo "---"
echo ""

# Use --allow-domains-file to specify domains from a file
sudo awf \
  --allow-domains-file "$DOMAINS_FILE" \
  -- curl -s https://api.github.com | head -10

echo ""
echo "=== Example Complete ==="
