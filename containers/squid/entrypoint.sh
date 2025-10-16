#!/bin/bash
set -e

# Fix permissions on mounted log directory
# The directory is mounted from the host and may have wrong ownership
chown -R proxy:proxy /var/log/squid
chmod -R 755 /var/log/squid

# Start Squid
exec squid -N -d 1
