#!/bin/bash
set -e

# Note: This container runs as the non-root 'proxy' user (UID 13, GID 13)
# The host creates directories with 0o777 permissions to allow the proxy user to write
# No chown/chmod commands are needed, improving security by eliminating root access

# Verify we're running as the proxy user
CURRENT_USER=$(id -un)
if [ "$CURRENT_USER" != "proxy" ]; then
  echo "[squid-entrypoint][ERROR] Container must run as 'proxy' user, currently: $CURRENT_USER"
  exit 1
fi

# Log SSL Bump status if enabled
if [ -d "/var/spool/squid_ssl_db" ]; then
  echo "[squid-entrypoint] SSL Bump mode detected - using SSL certificate database"
fi

# Start Squid (runs as proxy user)
exec squid -N -d 1
