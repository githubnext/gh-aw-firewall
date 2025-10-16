FROM ubuntu:22.04

# Install required packages and Node.js 22
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    iptables \
    curl \
    ca-certificates \
    git \
    gnupg \
    dnsutils \
    net-tools && \
    # Install Node.js 22 from NodeSource
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Copy iptables setup script
COPY setup-iptables.sh /usr/local/bin/setup-iptables.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/setup-iptables.sh /usr/local/bin/entrypoint.sh

# Set working directory
WORKDIR /workspace

# Use entrypoint to setup iptables and run command
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
