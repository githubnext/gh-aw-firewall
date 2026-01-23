FROM ubuntu/squid:latest

# Install additional tools for debugging, healthcheck, and SSL Bump
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    dnsutils \
    net-tools \
    netcat-openbsd \
    openssl \
    squid-openssl && \
    rm -rf /var/lib/apt/lists/*

# Create log directory and SSL database directory
# Also ensure /run is writable by proxy user for PID file
RUN mkdir -p /var/log/squid /run && \
    chown -R proxy:proxy /var/log/squid /run

# Copy entrypoint script
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Expose Squid port (3128 for HTTP, 3129 for HTTPS with SSL Bump)
EXPOSE 3128
EXPOSE 3129

# Switch to non-root proxy user for improved security
# The proxy user (UID 13, GID 13) is created by the ubuntu/squid base image
# Host directories are created with 0o777 permissions to allow the proxy user to write
USER proxy

# Use entrypoint to start Squid
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
