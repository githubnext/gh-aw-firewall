FROM ubuntu/squid:latest

# Install additional tools for debugging, healthcheck, and SSL certificate generation
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    dnsutils \
    net-tools \
    netcat-openbsd \
    openssl && \
    rm -rf /var/lib/apt/lists/*

# Create log directory
RUN mkdir -p /var/log/squid && \
    chown -R proxy:proxy /var/log/squid

# Create SSL certificate directory
RUN mkdir -p /etc/squid/ssl_cert && \
    chown -R proxy:proxy /etc/squid/ssl_cert

# Copy scripts
COPY generate-cert.sh /usr/local/bin/generate-cert.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/generate-cert.sh /usr/local/bin/entrypoint.sh

# Expose Squid port
EXPOSE 3128

# Use entrypoint to fix permissions before starting Squid
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
