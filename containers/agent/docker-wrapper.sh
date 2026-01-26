#!/bin/bash
# Docker wrapper script for spawned containers
# This wrapper allows spawned containers to resolve host.docker.internal when --enable-host-access is used
# 
# Installed at /usr/local/bin/docker (higher in PATH than /usr/bin/docker)
# When users install docker-cli (apt-get install docker.io), it goes to /usr/bin/docker
# This wrapper intercepts calls and delegates to the real docker at /usr/bin/docker
#
# Security Note: AWF_ENABLE_HOST_ACCESS is made readonly in entrypoint.sh to prevent malicious code
# from enabling host access after container startup

set -e

# Check if the real Docker CLI is installed at /usr/bin/docker
# Users must install docker-cli manually if they want to use Docker commands
if [ ! -x /usr/bin/docker ]; then
  cat >&2 <<'EOF'
ERROR: Docker CLI not installed

Docker commands require the Docker CLI to be installed in the container.

If you need to run Docker commands inside the firewall:
1. Install docker-cli in your environment:
   - Add to your command: "apt-get update && apt-get install -y docker.io && ..."
   - Or use a base image that includes docker-cli (via --agent-image)
2. Mount the Docker socket: --mount /var/run/docker.sock:/var/run/docker.sock:rw
3. Use --enable-host-access if spawned containers need host.docker.internal

Note: Docker-in-Docker (DinD) support was removed in AWF v0.9.1 (PR #205).
      You must mount the host Docker socket to use Docker commands.
EOF
  exit 127
fi

# Check if docker socket is mounted
if [ ! -S /var/run/docker.sock ]; then
  cat >&2 <<'EOF'
ERROR: Docker socket not mounted

Docker commands require /var/run/docker.sock to be mounted.

To use Docker commands inside the firewall:
  awf --mount /var/run/docker.sock:/var/run/docker.sock:rw ...

Note: Docker-in-Docker (DinD) support was removed in AWF v0.9.1 (PR #205).
EOF
  exit 127
fi

# Pass through all arguments to docker
DOCKER_ARGS=("$@")

# If AWF_ENABLE_HOST_ACCESS is enabled and we're running 'docker run' or 'docker create',
# inject --add-host host.docker.internal:host-gateway to allow spawned containers
# to resolve host.docker.internal
if [ "${AWF_ENABLE_HOST_ACCESS}" = "true" ]; then
  # Check if this is a 'docker run' or 'docker create' command
  if [ "${1}" = "run" ] || [ "${1}" = "create" ]; then
    # Check if --add-host host.docker.internal:host-gateway is already present
    ADD_HOST_PRESENT=false
    i=0
    for arg in "${@}"; do
      if [[ "$arg" == "--add-host" ]]; then
        # Check next argument for host.docker.internal
        next_arg="${@:$((i+2)):1}"
        if [[ "$next_arg" =~ host\.docker\.internal ]]; then
          ADD_HOST_PRESENT=true
          break
        fi
      elif [[ "$arg" =~ ^--add-host= ]]; then
        # Check value after = for host.docker.internal
        if [[ "$arg" =~ host\.docker\.internal ]]; then
          ADD_HOST_PRESENT=true
          break
        fi
      fi
      ((i++))
    done

    # Inject --add-host if not already present
    # Security: Only inject when AWF_ENABLE_HOST_ACCESS=true (set by awf CLI and made readonly)
    # This prevents malicious code from enabling host access without authorization
    if [ "$ADD_HOST_PRESENT" = false ]; then
      # Insert after the run/create command but before other arguments
      # Handle case where there are no additional arguments after run/create
      if [ $# -eq 1 ]; then
        # Only 'run' or 'create' command, no other args
        DOCKER_ARGS=("${DOCKER_ARGS[0]}" "--add-host" "host.docker.internal:host-gateway")
      else
        # Has additional arguments after run/create
        DOCKER_ARGS=("${DOCKER_ARGS[0]}" "--add-host" "host.docker.internal:host-gateway" "${DOCKER_ARGS[@]:1}")
      fi
    fi
  fi
fi

# Execute real docker binary at /usr/bin/docker with potentially modified arguments
exec /usr/bin/docker "${DOCKER_ARGS[@]}"
