FROM ghcr.io/actions/actions-runner:latest

# Switch to root to install packages
USER root

# Install required packages
# Note: git, curl, and docker-ce-cli are already installed in the GitHub Runner image
RUN apt-get update && \
    # Install other required packages
    apt-get install -y --no-install-recommends \
    iptables \
    gnupg \
    dnsutils \
    net-tools \
    netcat-openbsd \
    ca-certificates \
    xz-utils && \
    # Install Node.js 22 manually from official binaries
    # Using --insecure due to SSL proxy in build environment
    NODE_VERSION=22.13.0 && \
    curl --insecure -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz -o /tmp/node.tar.xz && \
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 && \
    rm /tmp/node.tar.xz && \
    # Cleanup
    apt-get remove -y xz-utils && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# Copy iptables setup script and docker wrapper
COPY setup-iptables.sh /usr/local/bin/setup-iptables.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker-wrapper.sh /usr/local/bin/docker-wrapper.sh
RUN chmod +x /usr/local/bin/setup-iptables.sh /usr/local/bin/entrypoint.sh /usr/local/bin/docker-wrapper.sh

# Install docker wrapper to intercept docker commands
# Rename real docker binary and replace with wrapper
RUN mv /usr/bin/docker /usr/bin/docker-real && \
    ln -s /usr/local/bin/docker-wrapper.sh /usr/bin/docker

# Set working directory
WORKDIR /workspace

# Use entrypoint to setup iptables and run command
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
