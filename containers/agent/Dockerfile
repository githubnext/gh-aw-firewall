FROM ubuntu:24.04

# Install required packages and Node.js 22
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    iptables \
    curl \
    ca-certificates \
    git \
    gnupg \
    dnsutils \
    net-tools \
    netcat-openbsd \
    gosu \
    libcap2-bin && \
    # Install Node.js 22 from NodeSource
    # Remove any existing nodejs packages first to avoid conflicts
    apt-get remove -y nodejs npm || true && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    # Verify Node.js 22 was installed correctly
    node --version | grep -q "^v22\." || (echo "ERROR: Node.js 22 not installed correctly" && exit 1) && \
    npx --version || (echo "ERROR: npx not found" && exit 1) && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user with UID/GID matching host user
# This allows the user command to run with appropriate permissions
# and prevents file ownership issues with mounted volumes
ARG USER_UID=1000
ARG USER_GID=1000
RUN groupadd -g ${USER_GID} awfuser && \
    useradd -u ${USER_UID} -g ${USER_GID} -m -s /bin/bash awfuser && \
    # Create directories for awfuser
    mkdir -p /home/awfuser/.copilot/logs && \
    chown -R awfuser:awfuser /home/awfuser

# Copy iptables setup script and PID logger
COPY setup-iptables.sh /usr/local/bin/setup-iptables.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY pid-logger.sh /usr/local/bin/pid-logger.sh
RUN chmod +x /usr/local/bin/setup-iptables.sh /usr/local/bin/entrypoint.sh /usr/local/bin/pid-logger.sh

# Install Docker stub script that shows helpful error message
# Docker-in-Docker support was removed in v0.9.1
COPY docker-stub.sh /usr/bin/docker
RUN chmod +x /usr/bin/docker

# Set working directory
WORKDIR /workspace

# Use entrypoint to setup iptables and run command
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
