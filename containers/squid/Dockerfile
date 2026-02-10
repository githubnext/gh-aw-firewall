FROM ubuntu/squid:latest

# Install additional tools for debugging, healthcheck, and SSL Bump
# Retry logic handles transient 404s when Ubuntu archive supersedes package versions mid-build
RUN apt-get update && \
    ( apt-get install -y --no-install-recommends \
    curl \
    dnsutils \
    net-tools \
    netcat-openbsd \
    openssl \
    squid-openssl || \
    (rm -rf /var/lib/apt/lists/* && apt-get update && \
     apt-get install -y --no-install-recommends \
     curl dnsutils net-tools netcat-openbsd openssl squid-openssl) ) && \
    rm -rf /var/lib/apt/lists/*

# Create log directory and SSL database directory
RUN mkdir -p /var/log/squid && \
    chown -R proxy:proxy /var/log/squid

# Copy entrypoint script
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Expose Squid port (3128 for HTTP, 3129 for HTTPS with SSL Bump)
EXPOSE 3128
EXPOSE 3129

# Use entrypoint to fix permissions before starting Squid
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
