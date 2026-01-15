#!/bin/bash
set -e

echo "[iptables] Setting up NAT redirection to Squid proxy..."
echo "[iptables] NOTE: Host-level DOCKER-USER chain handles egress filtering for all containers on this network"

# Function to check if an IP address is IPv6
is_ipv6() {
  local ip="$1"
  # Check if it contains a colon (IPv6 addresses always contain colons)
  [[ "$ip" == *:* ]]
}

# Function to check if ip6tables is available and functional
has_ip6tables() {
  if command -v ip6tables &>/dev/null && ip6tables -L -n &>/dev/null; then
    return 0
  else
    return 1
  fi
}

# Check ip6tables availability once at the start
IP6TABLES_AVAILABLE=false
if has_ip6tables; then
  IP6TABLES_AVAILABLE=true
  echo "[iptables] ip6tables is available"
else
  echo "[iptables] WARNING: ip6tables is not available, IPv6 rules will be skipped"
fi

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

# Clear existing NAT rules (both IPv4 and IPv6)
iptables -t nat -F OUTPUT 2>/dev/null || true
if [ "$IP6TABLES_AVAILABLE" = true ]; then
  ip6tables -t nat -F OUTPUT 2>/dev/null || true
fi

# Allow localhost traffic (for stdio MCP servers)
echo "[iptables] Allow localhost traffic..."
iptables -t nat -A OUTPUT -o lo -j RETURN
iptables -t nat -A OUTPUT -d 127.0.0.0/8 -j RETURN
if [ "$IP6TABLES_AVAILABLE" = true ]; then
  ip6tables -t nat -A OUTPUT -o lo -j RETURN
  ip6tables -t nat -A OUTPUT -d ::1/128 -j RETURN
fi

# Get DNS servers from environment (default to Google DNS)
DNS_SERVERS="${AWF_DNS_SERVERS:-8.8.8.8,8.8.4.4}"
echo "[iptables] Configuring DNS rules for trusted servers: $DNS_SERVERS"

# Separate IPv4 and IPv6 DNS servers
IPV4_DNS_SERVERS=()
IPV6_DNS_SERVERS=()
IFS=',' read -ra DNS_ARRAY <<< "$DNS_SERVERS"
for dns_server in "${DNS_ARRAY[@]}"; do
  dns_server=$(echo "$dns_server" | tr -d ' ')
  if [ -n "$dns_server" ]; then
    if is_ipv6 "$dns_server"; then
      IPV6_DNS_SERVERS+=("$dns_server")
    else
      IPV4_DNS_SERVERS+=("$dns_server")
    fi
  fi
done

echo "[iptables]   IPv4 DNS servers: ${IPV4_DNS_SERVERS[*]:-none}"
echo "[iptables]   IPv6 DNS servers: ${IPV6_DNS_SERVERS[*]:-none}"

# Allow DNS queries ONLY to trusted IPv4 DNS servers (prevents DNS exfiltration)
for dns_server in "${IPV4_DNS_SERVERS[@]}"; do
  echo "[iptables] Allow DNS to trusted IPv4 server: $dns_server"
  iptables -t nat -A OUTPUT -p udp -d "$dns_server" --dport 53 -j RETURN
  iptables -t nat -A OUTPUT -p tcp -d "$dns_server" --dport 53 -j RETURN
done

# Allow DNS queries ONLY to trusted IPv6 DNS servers
if [ "$IP6TABLES_AVAILABLE" = true ]; then
  for dns_server in "${IPV6_DNS_SERVERS[@]}"; do
    echo "[iptables] Allow DNS to trusted IPv6 server: $dns_server"
    ip6tables -t nat -A OUTPUT -p udp -d "$dns_server" --dport 53 -j RETURN
    ip6tables -t nat -A OUTPUT -p tcp -d "$dns_server" --dport 53 -j RETURN
  done
elif [ ${#IPV6_DNS_SERVERS[@]} -gt 0 ]; then
  echo "[iptables] WARNING: IPv6 DNS servers configured but ip6tables not available"
fi

# Allow DNS to Docker's embedded DNS server (127.0.0.11) for container name resolution
echo "[iptables] Allow DNS to Docker embedded DNS (127.0.0.11)..."
iptables -t nat -A OUTPUT -p udp -d 127.0.0.11 --dport 53 -j RETURN
iptables -t nat -A OUTPUT -p tcp -d 127.0.0.11 --dport 53 -j RETURN

# Allow return traffic to trusted IPv4 DNS servers
echo "[iptables] Allow traffic to trusted DNS servers..."
for dns_server in "${IPV4_DNS_SERVERS[@]}"; do
  iptables -t nat -A OUTPUT -d "$dns_server" -j RETURN
done

# Allow return traffic to trusted IPv6 DNS servers
if [ "$IP6TABLES_AVAILABLE" = true ]; then
  for dns_server in "${IPV6_DNS_SERVERS[@]}"; do
    ip6tables -t nat -A OUTPUT -d "$dns_server" -j RETURN
  done
fi

# Allow traffic to Squid proxy itself (prevent redirect loop)
echo "[iptables] Allow traffic to Squid proxy (${SQUID_IP}:${SQUID_PORT})..."
iptables -t nat -A OUTPUT -d "$SQUID_IP" -j RETURN

# Redirect standard HTTP/HTTPS ports to Squid
# This provides defense-in-depth: iptables enforces port policy, Squid enforces domain policy
echo "[iptables] Redirect HTTP (80) and HTTPS (443) to Squid..."
iptables -t nat -A OUTPUT -p tcp --dport 80 -j DNAT --to-destination "${SQUID_IP}:${SQUID_PORT}"
iptables -t nat -A OUTPUT -p tcp --dport 443 -j DNAT --to-destination "${SQUID_IP}:${SQUID_PORT}"

# If user specified additional ports via --allow-host-ports, redirect those too
if [ -n "$AWF_ALLOW_HOST_PORTS" ]; then
  echo "[iptables] Redirect user-specified ports to Squid..."

  # Parse comma-separated port list
  IFS=',' read -ra PORTS <<< "$AWF_ALLOW_HOST_PORTS"

  for port_spec in "${PORTS[@]}"; do
    # Remove leading/trailing spaces
    port_spec=$(echo "$port_spec" | xargs)

    if [[ $port_spec == *"-"* ]]; then
      # Port range (e.g., "3000-3010")
      echo "[iptables]   Redirect port range $port_spec to Squid..."
      iptables -t nat -A OUTPUT -p tcp -m multiport --dports "$port_spec" -j DNAT --to-destination "${SQUID_IP}:${SQUID_PORT}"
    else
      # Single port (e.g., "3000")
      echo "[iptables]   Redirect port $port_spec to Squid..."
      iptables -t nat -A OUTPUT -p tcp --dport "$port_spec" -j DNAT --to-destination "${SQUID_IP}:${SQUID_PORT}"
    fi
  done
else
  echo "[iptables] No additional ports specified (only 80, 443 allowed)"
fi

# Drop all other TCP traffic (default deny policy)
# This ensures that only explicitly allowed ports can be accessed
echo "[iptables] Drop all non-redirected TCP traffic (default deny)..."
iptables -A OUTPUT -p tcp -j DROP

echo "[iptables] NAT rules applied successfully"
echo "[iptables] Current IPv4 NAT OUTPUT rules:"
iptables -t nat -L OUTPUT -n -v
if [ "$IP6TABLES_AVAILABLE" = true ]; then
  echo "[iptables] Current IPv6 NAT OUTPUT rules:"
  ip6tables -t nat -L OUTPUT -n -v
else
  echo "[iptables] (ip6tables NAT not available)"
fi
