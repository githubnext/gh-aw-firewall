FROM ubuntu/squid:latest

# Install additional tools for debugging and healthcheck
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    dnsutils \
    net-tools \
    netcat-openbsd && \
    rm -rf /var/lib/apt/lists/*

# Create log directory
RUN mkdir -p /var/log/squid && \
    chown -R proxy:proxy /var/log/squid

# Copy entrypoint script
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Expose Squid port
EXPOSE 3128

# Use entrypoint to fix permissions before starting Squid
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
