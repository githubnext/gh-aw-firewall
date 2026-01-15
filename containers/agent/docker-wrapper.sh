#!/bin/bash
# Docker wrapper that injects --network awf-net and proxy env vars to all docker run commands
# This ensures spawned containers are subject to the same firewall rules

NETWORK_NAME="awf-net"
SQUID_PROXY="http://172.30.0.10:3128"
LOG_FILE="/tmp/docker-wrapper.log"

# Log all docker commands
echo "[$(date -Iseconds)] WRAPPER CALLED: docker $@" >> "$LOG_FILE"

# Check if this is a 'docker run' command
if [ "$1" = "run" ]; then
  # Check if --network is already specified and detect --network host
  # Also check for --add-host flag (DNS poisoning attack)
  # Also check for --privileged flag (bypasses all security)
  has_network=false
  network_value=""
  has_add_host=false
  has_privileged=false
  has_unsafe_add_host=false
  declare -a args=("$@")

  for i in "${!args[@]}"; do
    arg="${args[$i]}"

    # Check for --add-host flag and validate it
    if [[ "$arg" == "--add-host="* ]]; then
      has_add_host=true
      add_host_value="${arg#--add-host=}"
      # Only allow host.docker.internal:host-gateway when AWF_ENABLE_HOST_ACCESS is set
      if [[ "$add_host_value" != "host.docker.internal:host-gateway" ]] || [[ "$AWF_ENABLE_HOST_ACCESS" != "true" ]]; then
        has_unsafe_add_host=true
      fi
    elif [[ "$arg" == "--add-host" ]]; then
      has_add_host=true
      # Get next argument as the value
      next_idx=$((i + 1))
      if [ $next_idx -lt ${#args[@]} ]; then
        add_host_value="${args[$next_idx]}"
        # Only allow host.docker.internal:host-gateway when AWF_ENABLE_HOST_ACCESS is set
        if [[ "$add_host_value" != "host.docker.internal:host-gateway" ]] || [[ "$AWF_ENABLE_HOST_ACCESS" != "true" ]]; then
          has_unsafe_add_host=true
        fi
      fi
    fi

    # Check for --privileged flag
    if [[ "$arg" == "--privileged" ]]; then
      has_privileged=true
    fi

    # Handle --network=value format
    if [[ "$arg" == "--network="* ]]; then
      has_network=true
      network_value="${arg#--network=}"
      continue
    elif [[ "$arg" == "--net="* ]]; then
      has_network=true
      network_value="${arg#--net=}"
      continue
    # Handle --network value format
    elif [[ "$arg" == "--network" ]] || [[ "$arg" == "--net" ]]; then
      has_network=true
      # Get next argument as network value
      next_idx=$((i + 1))
      if [ $next_idx -lt ${#args[@]} ]; then
        network_value="${args[$next_idx]}"
      fi
      continue
    fi
  done

  # Block --privileged as it bypasses all security restrictions
  if [ "$has_privileged" = true ]; then
    echo "[$(date -Iseconds)] BLOCKED: --privileged bypasses all firewall restrictions" >> "$LOG_FILE"
    echo "[FIREWALL] ERROR: --privileged is not allowed (bypasses all security)" >&2
    echo "[FIREWALL] This flag grants unrestricted access and can disable firewall rules" >&2
    exit 1
  fi

  # Block --add-host unless it's specifically host.docker.internal:host-gateway with AWF_ENABLE_HOST_ACCESS
  if [ "$has_unsafe_add_host" = true ]; then
    echo "[$(date -Iseconds)] BLOCKED: --add-host enables DNS poisoning to bypass firewall" >> "$LOG_FILE"
    echo "[FIREWALL] ERROR: --add-host is not allowed (enables DNS poisoning)" >&2
    echo "[FIREWALL] This flag can map allowed domains to unauthorized IPs" >&2
    exit 1
  fi

  # Block --network host as it bypasses firewall
  if [ "$has_network" = true ] && [ "$network_value" = "host" ]; then
    echo "[$(date -Iseconds)] BLOCKED: --network host bypasses firewall, forcing --network $NETWORK_NAME" >> "$LOG_FILE"
    echo "[FIREWALL] ERROR: --network host is not allowed (bypasses firewall)" >&2
    echo "[FIREWALL] All containers must use the firewall network" >&2
    exit 1
  fi

  # If --network not specified, inject it along with proxy environment variables
  if [ "$has_network" = false ]; then
    # Build new args: docker run --network awf-net -e HTTP_PROXY -e HTTPS_PROXY <rest of args>
    shift # remove 'run'
    echo "[$(date -Iseconds)] INJECTING --network $NETWORK_NAME and proxy env vars" >> "$LOG_FILE"
    
    # Inject host.docker.internal if AWF_ENABLE_HOST_ACCESS is enabled and not already present
    if [[ "$AWF_ENABLE_HOST_ACCESS" = "true" ]] && [ "$has_add_host" = false ]; then
      echo "[$(date -Iseconds)] INJECTING --add-host host.docker.internal:host-gateway (AWF_ENABLE_HOST_ACCESS=true)" >> "$LOG_FILE"
      exec /usr/bin/docker-real run \
        --network "$NETWORK_NAME" \
        --add-host host.docker.internal:host-gateway \
        -e HTTP_PROXY="$SQUID_PROXY" \
        -e HTTPS_PROXY="$SQUID_PROXY" \
        -e http_proxy="$SQUID_PROXY" \
        -e https_proxy="$SQUID_PROXY" \
        "$@"
    else
      exec /usr/bin/docker-real run \
        --network "$NETWORK_NAME" \
        -e HTTP_PROXY="$SQUID_PROXY" \
        -e HTTPS_PROXY="$SQUID_PROXY" \
        -e http_proxy="$SQUID_PROXY" \
        -e https_proxy="$SQUID_PROXY" \
        "$@"
    fi
  else
    echo "[$(date -Iseconds)] --network $network_value already specified, passing through" >> "$LOG_FILE"
  fi
fi

# For all other commands or if --network already specified, pass through
echo "[$(date -Iseconds)] PASSING THROUGH: /usr/bin/docker-real $@" >> "$LOG_FILE"
exec /usr/bin/docker-real "$@"
