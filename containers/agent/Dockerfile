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
    net-tools \
    netcat-openbsd \
    gosu \
    libcap2-bin && \
    # Install Node.js 22 from NodeSource
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    # Install Docker CLI for MCP servers that run as containers
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc && \
    chmod a+r /etc/apt/keyrings/docker.asc && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null && \
    apt-get update && \
    apt-get install -y docker-ce-cli && \
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
