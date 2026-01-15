# BASE_IMAGE allows customization of the base Ubuntu image for closer parity
# with GitHub Actions runner environments. Options:
#   - ubuntu:22.04 (default): Minimal image, smallest size (~200MB)
#   - ghcr.io/catthehacker/ubuntu:runner-22.04: Closer to GitHub Actions runner (~2-5GB)
#   - ghcr.io/catthehacker/ubuntu:full-22.04: Near-identical to GitHub Actions runner (~20GB compressed)
# Use --build-arg BASE_IMAGE=<image> to customize
ARG BASE_IMAGE=ubuntu:22.04
FROM ${BASE_IMAGE}

# Install required packages and Node.js 22
# Note: Some packages may already exist in runner-like base images, apt handles this gracefully
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
    # Install Node.js 22 from NodeSource (only if not already installed or not v22.x)
    if ! command -v node >/dev/null 2>&1 || ! node --version | grep -qE '^v22\.'; then \
        curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
        apt-get install -y nodejs; \
    fi && \
    # Install Docker CLI for MCP servers that run as containers (only if not already installed)
    if ! command -v docker >/dev/null 2>&1; then \
        install -m 0755 -d /etc/apt/keyrings && \
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc && \
        chmod a+r /etc/apt/keyrings/docker.asc && \
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null && \
        apt-get update && \
        apt-get install -y docker-ce-cli; \
    fi && \
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

# Copy iptables setup script, docker wrapper, and PID logger
COPY setup-iptables.sh /usr/local/bin/setup-iptables.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker-wrapper.sh /usr/local/bin/docker-wrapper.sh
COPY pid-logger.sh /usr/local/bin/pid-logger.sh
RUN chmod +x /usr/local/bin/setup-iptables.sh /usr/local/bin/entrypoint.sh /usr/local/bin/docker-wrapper.sh /usr/local/bin/pid-logger.sh

# Install docker wrapper to intercept docker commands
# Handle cases where docker may already exist (symlink or binary)
RUN if [ -f /usr/bin/docker ] && [ ! -L /usr/bin/docker ]; then \
        mv /usr/bin/docker /usr/bin/docker-real; \
    elif [ -L /usr/bin/docker ]; then \
        # Docker is a symlink, resolve and copy the target (with error checking)
        DOCKER_TARGET=$(readlink -f /usr/bin/docker) && \
        if [ -n "$DOCKER_TARGET" ] && [ -f "$DOCKER_TARGET" ]; then \
            rm /usr/bin/docker && \
            cp "$DOCKER_TARGET" /usr/bin/docker-real; \
        else \
            # Broken symlink or target doesn't exist, just remove it
            rm /usr/bin/docker; \
        fi; \
    fi && \
    ln -sf /usr/local/bin/docker-wrapper.sh /usr/bin/docker

# Set working directory
WORKDIR /workspace

# Use entrypoint to setup iptables and run command
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
