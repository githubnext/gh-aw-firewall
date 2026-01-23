#!/bin/bash
set -e

echo "[entrypoint] Agentic Workflow Firewall - Agent Container"
echo "[entrypoint] =================================="

# Adjust awfuser UID/GID to match host user at runtime
# This ensures file ownership is correct regardless of whether using GHCR images or local builds
HOST_UID=${AWF_USER_UID:-$(id -u awfuser)}
HOST_GID=${AWF_USER_GID:-$(id -g awfuser)}
CURRENT_UID=$(id -u awfuser)
CURRENT_GID=$(id -g awfuser)

# Validate UID/GID values to prevent security issues
if ! [[ "$HOST_UID" =~ ^[0-9]+$ ]]; then
  echo "[entrypoint][ERROR] Invalid AWF_USER_UID: must be numeric"
  exit 1
fi

if ! [[ "$HOST_GID" =~ ^[0-9]+$ ]]; then
  echo "[entrypoint][ERROR] Invalid AWF_USER_GID: must be numeric"
  exit 1
fi

# Prevent setting UID/GID to 0 (root) which defeats the privilege drop
if [ "$HOST_UID" -eq 0 ]; then
  echo "[entrypoint][ERROR] Invalid AWF_USER_UID: cannot be 0 (root)"
  exit 1
fi

if [ "$HOST_GID" -eq 0 ]; then
  echo "[entrypoint][ERROR] Invalid AWF_USER_GID: cannot be 0 (root)"
  exit 1
fi

if [ "$CURRENT_UID" != "$HOST_UID" ] || [ "$CURRENT_GID" != "$HOST_GID" ]; then
  echo "[entrypoint] Adjusting awfuser UID:GID from $CURRENT_UID:$CURRENT_GID to $HOST_UID:$HOST_GID"
  
  # Check if target GID is already in use by another group
  EXISTING_GROUP=$(getent group "$HOST_GID" 2>/dev/null | cut -d: -f1 || true)
  if [ -n "$EXISTING_GROUP" ] && [ "$EXISTING_GROUP" != "awfuser" ]; then
    echo "[entrypoint][WARN] Target GID $HOST_GID is already used by group '$EXISTING_GROUP'. Skipping GID change."
  else
    # Change GID first (must be done before UID change)
    if ! groupmod -g "$HOST_GID" awfuser 2>/dev/null; then
      echo "[entrypoint][ERROR] Failed to change GID of awfuser to $HOST_GID"
      exit 1
    fi
  fi
  
  # Check if target UID is already in use by another user
  EXISTING_USER=$(getent passwd "$HOST_UID" 2>/dev/null | cut -d: -f1 || true)
  if [ -n "$EXISTING_USER" ] && [ "$EXISTING_USER" != "awfuser" ]; then
    echo "[entrypoint][WARN] Target UID $HOST_UID is already used by user '$EXISTING_USER'. Skipping UID change."
  else
    # Change UID
    if ! usermod -u "$HOST_UID" awfuser 2>/dev/null; then
      echo "[entrypoint][ERROR] Failed to change UID of awfuser to $HOST_UID"
      exit 1
    fi
  fi
  
  # Fix ownership of awfuser's home directory
  chown -R awfuser:awfuser /home/awfuser 2>/dev/null || true
  echo "[entrypoint] UID/GID adjustment complete"
fi

# Update CA certificates if SSL Bump is enabled
# The CA certificate is mounted at /usr/local/share/ca-certificates/awf-ca.crt
if [ "${AWF_SSL_BUMP_ENABLED}" = "true" ]; then
  echo "[entrypoint] SSL Bump mode detected - updating CA certificates..."
  if [ -f /usr/local/share/ca-certificates/awf-ca.crt ]; then
    update-ca-certificates 2>/dev/null
    echo "[entrypoint] CA certificates updated for SSL Bump"
    echo "[entrypoint] ⚠️  WARNING: HTTPS traffic will be intercepted for URL inspection"
  else
    echo "[entrypoint][WARN] SSL Bump enabled but CA certificate not found"
  fi
fi

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

# Configure git safe directories for awfuser
# Use runuser instead of su to avoid PAM session issues
runuser -u awfuser -- git config --global --add safe.directory '*' 2>/dev/null || true

echo "[entrypoint] =================================="
echo "[entrypoint] Dropping CAP_NET_ADMIN capability and privileges to awfuser (UID: $(id -u awfuser), GID: $(id -g awfuser))"
echo "[entrypoint] Executing command: $@"
echo ""

# Drop CAP_NET_ADMIN capability and privileges, then execute the user command
# This prevents malicious code from modifying iptables rules to bypass the firewall
# Security note: capsh --drop removes the capability from the bounding set,
# preventing any process (even if it escalates to root) from acquiring it
# The order of operations:
# 1. capsh drops CAP_NET_ADMIN from the bounding set (cannot be regained)
# 2. gosu switches to awfuser (drops root privileges)
# 3. exec replaces the current process with the user command
exec capsh --drop=cap_net_admin -- -c "exec gosu awfuser $(printf '%q ' "$@")"
