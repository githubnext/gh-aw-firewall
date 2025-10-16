#!/bin/bash
set -e

echo "[entrypoint] Firewall Wrapper - Copilot Container"
echo "[entrypoint] =================================="

# Setup iptables rules
/usr/local/bin/setup-iptables.sh

# Print proxy environment
echo "[entrypoint] Proxy configuration:"
echo "[entrypoint]   HTTP_PROXY=$HTTP_PROXY"
echo "[entrypoint]   HTTPS_PROXY=$HTTPS_PROXY"

# Print network information
echo "[entrypoint] Network information:"
echo "[entrypoint]   IP address: $(hostname -I)"
echo "[entrypoint]   Hostname: $(hostname)"

# Test connectivity to Squid
echo "[entrypoint] Testing connectivity to Squid proxy..."
if curl -s -o /dev/null -w "%{http_code}" --proxy "$HTTP_PROXY" --max-time 5 http://www.google.com > /dev/null 2>&1; then
  echo "[entrypoint] ✓ Squid proxy is reachable"
else
  echo "[entrypoint] ✗ WARNING: Could not reach Squid proxy (this may be expected if domains are restricted)"
fi

echo "[entrypoint] =================================="
echo "[entrypoint] Executing command: $@"
echo ""

# Execute the provided command
exec "$@"
