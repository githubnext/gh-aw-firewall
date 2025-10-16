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

# Expose Squid port
EXPOSE 3128

# Use default squid entrypoint
CMD ["squid", "-N", "-d", "1"]
