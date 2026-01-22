#!/bin/bash
# isolate.sh - Execute commands in a chroot jail into /host if binary is not in container PATH
#
# This script provides a way to run commands that exist on the host system but not
# in the container. When a binary is not found in the container's PATH, the script
# will chroot into /host (where the host filesystem is mounted read-only) and
# execute the command there.
#
# Usage: isolate.sh <command> [args...]
#
# Examples:
#   isolate.sh python3 script.py  # Runs host's python3 if not in container
#   isolate.sh /usr/bin/custom    # Runs host binary via chroot

set -e

if [ $# -eq 0 ]; then
  echo "[isolate] Error: No command specified" >&2
  echo "[isolate] Usage: isolate.sh <command> [args...]" >&2
  exit 1
fi

COMMAND="$1"
shift

# Check if the command is an absolute path
if [[ "$COMMAND" == /* ]]; then
  # Absolute path - check if it exists in container
  if [ -x "$COMMAND" ]; then
    # Binary exists in container, run directly
    exec "$COMMAND" "$@"
  else
    # Binary not in container, try to run in host chroot
    if [ -x "/host$COMMAND" ]; then
      echo "[isolate] Binary '$COMMAND' not found in container, executing via chroot to /host" >&2
      exec chroot /host "$COMMAND" "$@"
    else
      echo "[isolate] Error: Binary '$COMMAND' not found in container or host" >&2
      exit 127
    fi
  fi
else
  # Relative command - check if it's in container's PATH
  if command -v "$COMMAND" >/dev/null 2>&1; then
    # Command found in container PATH, run directly
    exec "$COMMAND" "$@"
  else
    # Command not in container PATH, try to find and run in host chroot
    # Use chroot to resolve the command in the host's PATH
    if chroot /host which "$COMMAND" >/dev/null 2>&1; then
      echo "[isolate] Command '$COMMAND' not found in container PATH, executing via chroot to /host" >&2
      exec chroot /host "$COMMAND" "$@"
    else
      echo "[isolate] Error: Command '$COMMAND' not found in container PATH or host PATH" >&2
      exit 127
    fi
  fi
fi
