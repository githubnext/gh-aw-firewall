#!/bin/bash
# isolate.sh - Command isolation wrapper with host binary fallback
#
# This script wraps user commands to provide transparent fallback to host binaries
# when they're not available in the container PATH. This enables the host filesystem
# to be mounted read-only while still allowing execution of host tools.
#
# Behavior:
# 1. If the command exists in container PATH, execute it directly in the container
# 2. If not found, check if it exists in /host (read-only host mount)
# 3. If found in /host, use chroot to execute it from the host filesystem
# 4. Otherwise, let bash handle the error (command not found)
#
# Security:
# - Host filesystem is mounted read-only at /host, preventing writes
# - chroot provides process-level isolation when running host binaries
# - All commands run as non-root user (awfuser) after capability drop

set -e

# Get the command to execute (first argument)
COMMAND="$1"

# If no command provided, exit with error
if [ -z "$COMMAND" ]; then
  echo "isolate.sh: error: no command specified" >&2
  exit 1
fi

# Check if command exists in container PATH
if command -v "$COMMAND" >/dev/null 2>&1; then
  # Command found in container - execute directly
  exec "$@"
fi

# Command not in container PATH - check if /host exists for fallback
if [ ! -d /host ]; then
  # No /host mount available - let bash handle the error
  exec "$@"
fi

# Check if this is an absolute path
if [[ "$COMMAND" == /* ]]; then
  # Absolute path - check if it exists in /host
  HOST_PATH="/host${COMMAND}"
  if [ -x "$HOST_PATH" ]; then
    # Execute via chroot into /host
    # Note: chroot requires the command path to be relative to the new root
    exec chroot /host "$COMMAND" "${@:2}"
  fi
fi

# Check if command exists in /host's PATH
# Try common binary locations in priority order
for BINDIR in /usr/local/bin /usr/bin /bin /usr/local/sbin /usr/sbin /sbin; do
  HOST_PATH="/host${BINDIR}/${COMMAND}"
  if [ -x "$HOST_PATH" ]; then
    # Execute via chroot into /host
    # Use the full path within the chroot environment
    exec chroot /host "${BINDIR}/${COMMAND}" "${@:2}"
  fi
done

# Command not found anywhere - let bash handle the error
exec "$@"
