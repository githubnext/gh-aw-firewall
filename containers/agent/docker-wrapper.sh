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
NAT_SETUP_SCRIPT='
if command -v iptables >/dev/null 2>&1; then
  iptables -t nat -F OUTPUT 2>/dev/null || true
  iptables -t nat -A OUTPUT -o lo -j RETURN
  iptables -t nat -A OUTPUT -d 127.0.0.0/8 -j RETURN
  iptables -t nat -A OUTPUT -p udp -d 127.0.0.11 --dport 53 -j RETURN
  iptables -t nat -A OUTPUT -p tcp -d 127.0.0.11 --dport 53 -j RETURN
  iptables -t nat -A OUTPUT -p udp -d 8.8.8.8 --dport 53 -j RETURN
  iptables -t nat -A OUTPUT -p tcp -d 8.8.8.8 --dport 53 -j RETURN
  iptables -t nat -A OUTPUT -p udp -d 8.8.4.4 --dport 53 -j RETURN
  iptables -t nat -A OUTPUT -p tcp -d 8.8.4.4 --dport 53 -j RETURN
  iptables -t nat -A OUTPUT -d 8.8.8.8 -j RETURN
  iptables -t nat -A OUTPUT -d 8.8.4.4 -j RETURN
  iptables -t nat -A OUTPUT -d '"$SQUID_IP"' -j RETURN
  iptables -t nat -A OUTPUT -p tcp --dport 80 -j DNAT --to-destination '"$SQUID_IP:$SQUID_PORT"'
  iptables -t nat -A OUTPUT -p tcp --dport 443 -j DNAT --to-destination '"$SQUID_IP:$SQUID_PORT"'
fi
'

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
    
    # We need to parse the remaining arguments to find where the image and command are
    # Docker run format: docker run [OPTIONS] IMAGE [COMMAND] [ARG...]
    # We'll inject our security flags and then wrap the command with NAT setup
    
    # Parse remaining arguments to extract:
    # 1. Docker options (flags that start with - or their values)
    # 2. Image name
    # 3. Command and its arguments
    declare -a docker_opts=()
    declare -a user_cmd=()
    image_name=""
    parsing_opts=true
    skip_next=false
    has_rm=false
    has_entrypoint=false
    
    for arg in "$@"; do
      if [ "$skip_next" = true ]; then
        docker_opts+=("$arg")
        skip_next=false
        continue
      fi
      
      if [ "$parsing_opts" = true ]; then
        # Check for --rm flag
        if [ "$arg" = "--rm" ]; then
          has_rm=true
          docker_opts+=("$arg")
          continue
        fi
        
        # Check for --entrypoint flag (we need to handle this specially)
        if [ "$arg" = "--entrypoint" ]; then
          has_entrypoint=true
          docker_opts+=("$arg")
          skip_next=true
          continue
        fi
        if [[ "$arg" == "--entrypoint="* ]]; then
          has_entrypoint=true
          docker_opts+=("$arg")
          continue
        fi
        
        # Docker options that take a value on the next argument
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
            docker_opts+=("$arg")
            skip_next=true
            continue
            ;;
        esac
        
        # Docker options that are flags (no value)
        if [[ "$arg" == -* ]]; then
          docker_opts+=("$arg")
          continue
        fi
        
        # First non-option argument is the image name
        image_name="$arg"
        parsing_opts=false
      else
        # Everything after the image name is the command
        user_cmd+=("$arg")
      fi
    done
    
    # If no image was found, just pass through
    if [ -z "$image_name" ]; then
      echo "[$(date -Iseconds)] ERROR: Could not find image name, passing through" >> "$LOG_FILE"
      exec /usr/bin/docker-real run "$@"
    fi
    
    echo "[$(date -Iseconds)] Image: $image_name, Command: ${user_cmd[*]:-<default>}, HasEntrypoint: $has_entrypoint" >> "$LOG_FILE"
    
    # Build the wrapped command that sets up NAT rules then runs the user's command
    # If user specified a command, wrap it; otherwise let the image's default run
    if [ ${#user_cmd[@]} -gt 0 ]; then
      # User specified a command - wrap it with NAT setup
      # Escape the user command for embedding in sh -c
      escaped_cmd=""
      for cmd_part in "${user_cmd[@]}"; do
        # Escape single quotes in the command
        escaped_part="${cmd_part//\'/\'\\\'\'}"
        escaped_cmd="$escaped_cmd '$escaped_part'"
      done
      
      wrapped_cmd="$NAT_SETUP_SCRIPT exec $escaped_cmd"
    else
      # No user command - NAT setup only, then exit (image entrypoint will not run with our wrapper)
      # For this case, we can't easily wrap the default entrypoint, so just set up NAT and warn
      echo "[$(date -Iseconds)] WARNING: No command specified, NAT rules may not apply to default entrypoint" >> "$LOG_FILE"
      # Pass through without wrapping - NAT won't apply but proxy env vars will
      exec /usr/bin/docker-real run \
        --network "$NETWORK_NAME" \
        --cap-add NET_ADMIN \
        -e HTTP_PROXY="$SQUID_PROXY" \
        -e HTTPS_PROXY="$SQUID_PROXY" \
        -e http_proxy="$SQUID_PROXY" \
        -e https_proxy="$SQUID_PROXY" \
        -e SQUID_PROXY_IP="$SQUID_IP" \
        -e SQUID_PROXY_PORT="$SQUID_PORT" \
        "${docker_opts[@]}" \
        "$image_name"
    fi
    
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
      "${docker_opts[@]}" \
      --entrypoint sh \
      "$image_name" \
      -c "$wrapped_cmd"
  else
    # Network is already specified (and not host) - still inject NAT rules and proxy env vars
    echo "[$(date -Iseconds)] --network $network_value already specified, injecting NAT rules and proxy env vars" >> "$LOG_FILE"
    
    shift # remove 'run'
    
    # Parse remaining arguments similar to above
    declare -a docker_opts2=()
    declare -a user_cmd2=()
    image_name2=""
    parsing_opts2=true
    skip_next2=false
    
    for arg in "$@"; do
      if [ "$skip_next2" = true ]; then
        docker_opts2+=("$arg")
        skip_next2=false
        continue
      fi
      
      if [ "$parsing_opts2" = true ]; then
        # Docker options that take a value on the next argument
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
          --mac-address|--expose|--domainname|--add-host|--annotation|\
          --network|--net)
            docker_opts2+=("$arg")
            skip_next2=true
            continue
            ;;
        esac
        
        # Docker options that are flags (no value) or have = format
        if [[ "$arg" == -* ]]; then
          docker_opts2+=("$arg")
          continue
        fi
        
        # First non-option argument is the image name
        image_name2="$arg"
        parsing_opts2=false
      else
        # Everything after the image name is the command
        user_cmd2+=("$arg")
      fi
    done
    
    # If no image was found, just pass through
    if [ -z "$image_name2" ]; then
      echo "[$(date -Iseconds)] ERROR: Could not find image name, passing through" >> "$LOG_FILE"
      exec /usr/bin/docker-real run "$@"
    fi
    
    echo "[$(date -Iseconds)] Image: $image_name2, Command: ${user_cmd2[*]:-<default>}" >> "$LOG_FILE"
    
    # Build the wrapped command
    if [ ${#user_cmd2[@]} -gt 0 ]; then
      escaped_cmd2=""
      for cmd_part in "${user_cmd2[@]}"; do
        escaped_part2="${cmd_part//\'/\'\\\'\'}"
        escaped_cmd2="$escaped_cmd2 '$escaped_part2'"
      done
      
      wrapped_cmd2="$NAT_SETUP_SCRIPT exec $escaped_cmd2"
      
      exec /usr/bin/docker-real run \
        --cap-add NET_ADMIN \
        -e HTTP_PROXY="$SQUID_PROXY" \
        -e HTTPS_PROXY="$SQUID_PROXY" \
        -e http_proxy="$SQUID_PROXY" \
        -e https_proxy="$SQUID_PROXY" \
        -e SQUID_PROXY_IP="$SQUID_IP" \
        -e SQUID_PROXY_PORT="$SQUID_PORT" \
        "${docker_opts2[@]}" \
        --entrypoint sh \
        "$image_name2" \
        -c "$wrapped_cmd2"
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
        "${docker_opts2[@]}" \
        "$image_name2"
    fi
  fi
fi

# For all other commands (not docker run), pass through
echo "[$(date -Iseconds)] PASSING THROUGH: /usr/bin/docker-real $@" >> "$LOG_FILE"
exec /usr/bin/docker-real "$@"
