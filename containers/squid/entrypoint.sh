#!/bin/bash
set -e

# Fix permissions on mounted log directory
# The directory is mounted from the host and may have wrong ownership
chown -R proxy:proxy /var/log/squid
chmod -R 755 /var/log/squid

# Initialize SSL certificate database if SSL Bump is enabled
# With tmpfs, the database directory exists but is empty at container start
# We need to create the structure that Squid expects
if [ -d "/var/spool/squid_ssl_db" ]; then
  echo "[squid-entrypoint] SSL Bump mode detected - initializing SSL database on tmpfs..."

  # Create the database structure that Squid expects
  # This structure is: certs/ directory, index.txt, and size file
  mkdir -p /var/spool/squid_ssl_db/certs
  touch /var/spool/squid_ssl_db/index.txt
  echo "0" > /var/spool/squid_ssl_db/size

  # Fix ownership for Squid (runs as proxy user)
  chown -R proxy:proxy /var/spool/squid_ssl_db
  chmod -R 700 /var/spool/squid_ssl_db

  echo "[squid-entrypoint] SSL certificate database ready (tmpfs-backed, memory-only)"
fi

# Start Squid
exec squid -N -d 1
