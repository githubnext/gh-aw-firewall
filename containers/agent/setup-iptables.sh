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

# Get DNS servers from environment (default to Google DNS)
DNS_SERVERS="${AWF_DNS_SERVERS:-8.8.8.8,8.8.4.4}"
echo "[iptables] Configuring DNS rules for trusted servers: $DNS_SERVERS"

# Allow DNS queries ONLY to trusted DNS servers (prevents DNS exfiltration)
IFS=',' read -ra DNS_ARRAY <<< "$DNS_SERVERS"
for dns_server in "${DNS_ARRAY[@]}"; do
  dns_server=$(echo "$dns_server" | tr -d ' ')
  if [ -n "$dns_server" ]; then
    echo "[iptables] Allow DNS to trusted server: $dns_server"
    iptables -t nat -A OUTPUT -p udp -d "$dns_server" --dport 53 -j RETURN
    iptables -t nat -A OUTPUT -p tcp -d "$dns_server" --dport 53 -j RETURN
  fi
done

# Allow DNS to Docker's embedded DNS server (127.0.0.11) for container name resolution
echo "[iptables] Allow DNS to Docker embedded DNS (127.0.0.11)..."
iptables -t nat -A OUTPUT -p udp -d 127.0.0.11 --dport 53 -j RETURN
iptables -t nat -A OUTPUT -p tcp -d 127.0.0.11 --dport 53 -j RETURN

# Allow return traffic to trusted DNS servers
echo "[iptables] Allow traffic to trusted DNS servers..."
for dns_server in "${DNS_ARRAY[@]}"; do
  dns_server=$(echo "$dns_server" | tr -d ' ')
  if [ -n "$dns_server" ]; then
    iptables -t nat -A OUTPUT -d "$dns_server" -j RETURN
  fi
done

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
