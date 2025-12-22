#!/bin/bash
# Example: Debug mode with log inspection
#
# This example shows how to use debug logging and keep containers
# running after command execution for inspection.
#
# Usage: sudo ./examples/debugging.sh

set -e

echo "=== AWF Debugging Example ==="
echo ""

echo "Running with debug logging enabled..."
echo "Use --log-level debug to see detailed output"
echo "Use --keep-containers to preserve containers after execution"
echo ""

# Run with debug logging
# --log-level debug: Shows configuration details, iptables rules, etc.
# --keep-containers: Keeps containers running for inspection after command exits
sudo awf \
  --allow-domains github.com \
  --log-level debug \
  -- curl -s https://api.github.com/zen

echo ""
echo "=== Inspecting Logs ==="
echo ""

# After a run, logs are automatically preserved
# Note: These paths are based on awf's default behavior and may change in future versions
echo "Agent logs are saved to: /tmp/awf-agent-logs-<timestamp>"
echo "Squid logs are saved to: /tmp/squid-logs-<timestamp>"
echo ""

# List preserved log directories
echo "Available log directories:"
ls -d /tmp/awf-agent-logs-* /tmp/squid-logs-* 2>/dev/null || echo "  (no logs found - run a command first)"

echo ""
echo "To view live logs from a running container (with --keep-containers):"
echo "  docker logs awf-squid     # View proxy logs"
echo "  docker logs awf-agent     # View agent logs"
echo ""
echo "To view preserved Squid access logs:"
echo "  sudo cat /tmp/squid-logs-*/access.log"
echo ""
echo "To find blocked requests:"
echo "  sudo grep 'TCP_DENIED' /tmp/squid-logs-*/access.log"
echo ""
echo "=== Example Complete ==="
