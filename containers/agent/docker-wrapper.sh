#!/bin/bash
# Docker wrapper that injects --network awf-net and proxy env vars to all docker run commands
# This ensures spawned containers are subject to the same firewall rules
#
# Security: This wrapper also injects NAT rules into child containers to prevent proxy bypass.
# Applications that ignore HTTP_PROXY environment variables will still have their traffic
# redirected to Squid via iptables NAT rules.

NETWORK_NAME="awf-net"
SQUID_PROXY="http://172.30.0.10:3128"
SQUID_IP="172.30.0.10"
SQUID_PORT="3128"
LOG_FILE="/tmp/docker-wrapper.log"

# NAT setup script that will be injected into child containers
# This script redirects HTTP/HTTPS traffic to Squid proxy using iptables
# It's designed to be minimal and work with busybox/alpine shells
# Note: The script ends with a semicolon to ensure proper command separation
NAT_SETUP_SCRIPT='if command -v iptables >/dev/null 2>&1; then iptables -t nat -F OUTPUT 2>/dev/null || true; iptables -t nat -A OUTPUT -o lo -j RETURN; iptables -t nat -A OUTPUT -d 127.0.0.0/8 -j RETURN; iptables -t nat -A OUTPUT -p udp -d 127.0.0.11 --dport 53 -j RETURN; iptables -t nat -A OUTPUT -p tcp -d 127.0.0.11 --dport 53 -j RETURN; iptables -t nat -A OUTPUT -p udp -d 8.8.8.8 --dport 53 -j RETURN; iptables -t nat -A OUTPUT -p tcp -d 8.8.8.8 --dport 53 -j RETURN; iptables -t nat -A OUTPUT -p udp -d 8.8.4.4 --dport 53 -j RETURN; iptables -t nat -A OUTPUT -p tcp -d 8.8.4.4 --dport 53 -j RETURN; iptables -t nat -A OUTPUT -d 8.8.8.8 -j RETURN; iptables -t nat -A OUTPUT -d 8.8.4.4 -j RETURN; iptables -t nat -A OUTPUT -d '"$SQUID_IP"' -j RETURN; iptables -t nat -A OUTPUT -p tcp --dport 80 -j DNAT --to-destination '"$SQUID_IP:$SQUID_PORT"'; iptables -t nat -A OUTPUT -p tcp --dport 443 -j DNAT --to-destination '"$SQUID_IP:$SQUID_PORT"'; fi; '

# Function to escape a command argument for use in sh -c
# Uses printf %q for robust escaping of all shell metacharacters
escape_for_shell() {
  local arg="$1"
  # Use printf %q for proper shell escaping
  printf '%q' "$arg"
}

# Function to build escaped command string from array of arguments
build_escaped_cmd() {
  local escaped=""
  for arg in "$@"; do
    if [ -n "$escaped" ]; then
      escaped="$escaped "
    fi
    escaped="$escaped$(escape_for_shell "$arg")"
  done
  echo "$escaped"
}

# Function to check if an argument is a Docker option that takes a value
is_docker_option_with_value() {
  local arg="$1"
  case "$arg" in
    -e|--env|-l|--label|-v|--volume|-p|--publish|--name|--hostname|\
    --user|-u|--workdir|-w|--mount|--network-alias|--dns|--dns-search|\
    --dns-option|--cpus|--memory|-m|--memory-swap|--memory-reservation|\
    --kernel-memory|--cpu-shares|--cpu-period|--cpu-quota|--cpuset-cpus|\
    --cpuset-mems|--blkio-weight|--device|--device-cgroup-rule|\
    --device-read-bps|--device-read-iops|--device-write-bps|\
    --device-write-iops|--cap-add|--cap-drop|--security-opt|--ulimit|\
    --sysctl|--restart|--stop-signal|--stop-timeout|--health-cmd|\
    --health-interval|--health-retries|--health-start-period|\
    --health-timeout|--log-driver|--log-opt|--storage-opt|\
    --tmpfs|--ipc|--pid|--userns|--uts|--runtime|--isolation|\
    --platform|--pull|--shm-size|--group-add|--cidfile|--cgroup-parent|\
    --init|--read-only|--gpus|--link|--link-local-ip|--ip|--ip6|\
    --mac-address|--expose|--domainname|--add-host|--annotation)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# Function to parse docker run arguments and extract options, image, and command
# Sets global variables: PARSED_DOCKER_OPTS, PARSED_IMAGE, PARSED_USER_CMD
parse_docker_run_args() {
  local include_network="$1"
  shift
  
  PARSED_DOCKER_OPTS=()
  PARSED_USER_CMD=()
  PARSED_IMAGE=""
  local parsing_opts=true
  local skip_next=false
  
  for arg in "$@"; do
    if [ "$skip_next" = true ]; then
      PARSED_DOCKER_OPTS+=("$arg")
      skip_next=false
      continue
    fi
    
    if [ "$parsing_opts" = true ]; then
      # Check for --entrypoint flag (we track this but don't use it currently)
      if [ "$arg" = "--entrypoint" ]; then
        PARSED_DOCKER_OPTS+=("$arg")
        skip_next=true
        continue
      fi
      if [[ "$arg" == "--entrypoint="* ]]; then
        PARSED_DOCKER_OPTS+=("$arg")
        continue
      fi
      
      # Check if it's a Docker option that takes a value
      if is_docker_option_with_value "$arg"; then
        PARSED_DOCKER_OPTS+=("$arg")
        skip_next=true
        continue
      fi
      
      # Handle --network and --net specially if we need to include them
      if [ "$include_network" = "true" ]; then
        if [ "$arg" = "--network" ] || [ "$arg" = "--net" ]; then
          PARSED_DOCKER_OPTS+=("$arg")
          skip_next=true
          continue
        fi
      fi
      
      # Docker options that are flags (no value) or have = format
      if [[ "$arg" == -* ]]; then
        PARSED_DOCKER_OPTS+=("$arg")
        continue
      fi
      
      # First non-option argument is the image name
      PARSED_IMAGE="$arg"
      parsing_opts=false
    else
      # Everything after the image name is the command
      PARSED_USER_CMD+=("$arg")
    fi
  done
}

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
  declare -a args=("$@")

  for i in "${!args[@]}"; do
    arg="${args[$i]}"

    # Check for --add-host flag
    if [[ "$arg" == "--add-host="* ]] || [[ "$arg" == "--add-host" ]]; then
      has_add_host=true
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

  # Block --add-host as it enables DNS poisoning attacks
  if [ "$has_add_host" = true ]; then
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

  # If --network not specified, inject it along with proxy environment variables and NAT rules
  if [ "$has_network" = false ]; then
    shift # remove 'run'
    echo "[$(date -Iseconds)] INJECTING --network $NETWORK_NAME, proxy env vars, and NAT rules" >> "$LOG_FILE"
    
    # Parse docker run arguments
    parse_docker_run_args "false" "$@"
    
    # If no image was found, just pass through
    if [ -z "$PARSED_IMAGE" ]; then
      echo "[$(date -Iseconds)] ERROR: Could not find image name, passing through" >> "$LOG_FILE"
      exec /usr/bin/docker-real run "$@"
    fi
    
    echo "[$(date -Iseconds)] Image: $PARSED_IMAGE, Command: ${PARSED_USER_CMD[*]:-<default>}" >> "$LOG_FILE"
    
    # Build the wrapped command that sets up NAT rules then runs the user's command
    if [ ${#PARSED_USER_CMD[@]} -gt 0 ]; then
      # User specified a command - wrap it with NAT setup
      escaped_cmd=$(build_escaped_cmd "${PARSED_USER_CMD[@]}")
      wrapped_cmd="${NAT_SETUP_SCRIPT}exec ${escaped_cmd}"
      
      # Execute with NAT wrapper
      exec /usr/bin/docker-real run \
        --network "$NETWORK_NAME" \
        --cap-add NET_ADMIN \
        -e HTTP_PROXY="$SQUID_PROXY" \
        -e HTTPS_PROXY="$SQUID_PROXY" \
        -e http_proxy="$SQUID_PROXY" \
        -e https_proxy="$SQUID_PROXY" \
        -e SQUID_PROXY_IP="$SQUID_IP" \
        -e SQUID_PROXY_PORT="$SQUID_PORT" \
        "${PARSED_DOCKER_OPTS[@]}" \
        --entrypoint sh \
        "$PARSED_IMAGE" \
        -c "$wrapped_cmd"
    else
      # No user command - can't easily wrap the default entrypoint
      echo "[$(date -Iseconds)] WARNING: No command specified, NAT rules may not apply to default entrypoint" >> "$LOG_FILE"
      exec /usr/bin/docker-real run \
        --network "$NETWORK_NAME" \
        --cap-add NET_ADMIN \
        -e HTTP_PROXY="$SQUID_PROXY" \
        -e HTTPS_PROXY="$SQUID_PROXY" \
        -e http_proxy="$SQUID_PROXY" \
        -e https_proxy="$SQUID_PROXY" \
        -e SQUID_PROXY_IP="$SQUID_IP" \
        -e SQUID_PROXY_PORT="$SQUID_PORT" \
        "${PARSED_DOCKER_OPTS[@]}" \
        "$PARSED_IMAGE"
    fi
  else
    # Network is already specified (and not host) - still inject NAT rules and proxy env vars
    echo "[$(date -Iseconds)] --network $network_value already specified, injecting NAT rules and proxy env vars" >> "$LOG_FILE"
    
    shift # remove 'run'
    
    # Parse docker run arguments (include network options in docker_opts)
    parse_docker_run_args "true" "$@"
    
    # If no image was found, just pass through
    if [ -z "$PARSED_IMAGE" ]; then
      echo "[$(date -Iseconds)] ERROR: Could not find image name, passing through" >> "$LOG_FILE"
      exec /usr/bin/docker-real run "$@"
    fi
    
    echo "[$(date -Iseconds)] Image: $PARSED_IMAGE, Command: ${PARSED_USER_CMD[*]:-<default>}" >> "$LOG_FILE"
    
    # Build the wrapped command
    if [ ${#PARSED_USER_CMD[@]} -gt 0 ]; then
      escaped_cmd=$(build_escaped_cmd "${PARSED_USER_CMD[@]}")
      wrapped_cmd="${NAT_SETUP_SCRIPT}exec ${escaped_cmd}"
      
      exec /usr/bin/docker-real run \
        --cap-add NET_ADMIN \
        -e HTTP_PROXY="$SQUID_PROXY" \
        -e HTTPS_PROXY="$SQUID_PROXY" \
        -e http_proxy="$SQUID_PROXY" \
        -e https_proxy="$SQUID_PROXY" \
        -e SQUID_PROXY_IP="$SQUID_IP" \
        -e SQUID_PROXY_PORT="$SQUID_PORT" \
        "${PARSED_DOCKER_OPTS[@]}" \
        --entrypoint sh \
        "$PARSED_IMAGE" \
        -c "$wrapped_cmd"
    else
      # No command specified - pass through with proxy env vars
      exec /usr/bin/docker-real run \
        --cap-add NET_ADMIN \
        -e HTTP_PROXY="$SQUID_PROXY" \
        -e HTTPS_PROXY="$SQUID_PROXY" \
        -e http_proxy="$SQUID_PROXY" \
        -e https_proxy="$SQUID_PROXY" \
        -e SQUID_PROXY_IP="$SQUID_IP" \
        -e SQUID_PROXY_PORT="$SQUID_PORT" \
        "${PARSED_DOCKER_OPTS[@]}" \
        "$PARSED_IMAGE"
    fi
  fi
fi

# For all other commands (not docker run), pass through
echo "[$(date -Iseconds)] PASSING THROUGH: /usr/bin/docker-real $@" >> "$LOG_FILE"
exec /usr/bin/docker-real "$@"
