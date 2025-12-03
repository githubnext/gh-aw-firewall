#!/bin/bash
set -e

# Fix permissions on mounted log directory
# The directory is mounted from the host and may have wrong ownership
chown -R proxy:proxy /var/log/squid
chmod -R 755 /var/log/squid

# Check if SSL bumping is enabled by looking for ssl_bump directive in config
if grep -q "ssl_bump" /etc/squid/squid.conf 2>/dev/null; then
    echo "SSL bumping enabled - generating certificate..."
    /usr/local/bin/generate-cert.sh
fi

# Start Squid
exec squid -N -d 1
