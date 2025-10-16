#!/bin/bash
set -e

echo "[iptables] Setting up NAT redirection to Squid proxy..."
echo "[iptables] NOTE: Host-level DOCKER-USER chain handles egress filtering for all containers on this network"

# Get Squid proxy configuration from environment
SQUID_HOST="${SQUID_PROXY_HOST:-squid-proxy}"
SQUID_PORT="${SQUID_PROXY_PORT:-3128}"

echo "[iptables] Squid proxy: ${SQUID_HOST}:${SQUID_PORT}"

# Resolve Squid hostname to IP
SQUID_IP=$(getent hosts "$SQUID_HOST" | awk '{ print $1 }' | head -n 1)
if [ -z "$SQUID_IP" ]; then
  echo "[iptables] ERROR: Could not resolve Squid proxy hostname: $SQUID_HOST"
  exit 1
fi
echo "[iptables] Squid IP resolved to: $SQUID_IP"

# Clear existing NAT rules
iptables -t nat -F OUTPUT 2>/dev/null || true

# Allow localhost traffic (for stdio MCP servers)
echo "[iptables] Allow localhost traffic..."
iptables -t nat -A OUTPUT -o lo -j RETURN
iptables -t nat -A OUTPUT -d 127.0.0.0/8 -j RETURN

# Allow DNS queries to any DNS server (including Docker's 127.0.0.11 and configured DNS servers)
echo "[iptables] Allow DNS queries..."
iptables -t nat -A OUTPUT -p udp --dport 53 -j RETURN
iptables -t nat -A OUTPUT -p tcp --dport 53 -j RETURN

# Explicitly allow DNS servers configured in the container (8.8.8.8, 8.8.4.4)
echo "[iptables] Allow traffic to DNS servers..."
iptables -t nat -A OUTPUT -d 8.8.8.8 -j RETURN
iptables -t nat -A OUTPUT -d 8.8.4.4 -j RETURN

# Allow traffic to Squid proxy itself
echo "[iptables] Allow traffic to Squid proxy (${SQUID_IP}:${SQUID_PORT})..."
iptables -t nat -A OUTPUT -d "$SQUID_IP" -j RETURN

# Redirect HTTP traffic to Squid
echo "[iptables] Redirect HTTP (port 80) to Squid..."
iptables -t nat -A OUTPUT -p tcp --dport 80 -j DNAT --to-destination "${SQUID_IP}:${SQUID_PORT}"

# Redirect HTTPS traffic to Squid
echo "[iptables] Redirect HTTPS (port 443) to Squid..."
iptables -t nat -A OUTPUT -p tcp --dport 443 -j DNAT --to-destination "${SQUID_IP}:${SQUID_PORT}"

echo "[iptables] NAT rules applied successfully"
echo "[iptables] Current NAT OUTPUT rules:"
iptables -t nat -L OUTPUT -n -v
