#!/bin/bash
set -e

# Fix permissions on mounted log directory
# The directory is mounted from the host and may have wrong ownership
chown -R proxy:proxy /var/log/squid
chmod -R 755 /var/log/squid

# Initialize SSL certificate database if SSL Bump is enabled
# Check if ssl_db directory is mounted (indicates SSL Bump mode)
if [ -d "/var/spool/squid_ssl_db" ]; then
  echo "[squid-entrypoint] SSL Bump mode detected - initializing SSL certificate database..."
  
  # Initialize the SSL database if it's empty or not yet initialized
  if [ ! -f "/var/spool/squid_ssl_db/index.txt" ]; then
    echo "[squid-entrypoint] Creating SSL certificate database..."
    # Use Squid's security_file_certgen to initialize the database
    # Using 16MB for the certificate cache (sufficient for typical AI agent sessions)
    /usr/lib/squid/security_file_certgen -c -s /var/spool/squid_ssl_db -M 16MB
    chown -R proxy:proxy /var/spool/squid_ssl_db
    echo "[squid-entrypoint] SSL certificate database initialized"
  else
    echo "[squid-entrypoint] SSL certificate database already exists"
  fi
  
  # Fix permissions on SSL database
  chown -R proxy:proxy /var/spool/squid_ssl_db
  chmod -R 700 /var/spool/squid_ssl_db
fi

# Start Squid
exec squid -N -d 1
