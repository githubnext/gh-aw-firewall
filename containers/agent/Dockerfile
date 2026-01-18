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
    # Install Node.js 22 from NodeSource
    # Check if Node.js 22 is already installed (common in runner images)
    if ! command -v node >/dev/null 2>&1 || ! node --version | grep -qE '^v22\.'; then \
        # Remove any existing nodejs packages first to avoid conflicts
        apt-get remove -y nodejs npm || true && \
        curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
        apt-get install -y nodejs && \
        # Verify Node.js 22 was installed correctly
        node --version | grep -q "^v22\." || (echo "ERROR: Node.js 22 not installed correctly" && exit 1) && \
        npx --version || (echo "ERROR: npx not found" && exit 1); \
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
