# BASE_IMAGE allows customization of the base Ubuntu image for closer parity
# with GitHub Actions runner environments. Options:
#   - ubuntu:22.04 (default): Minimal image, smallest size (~200MB)
#   - ghcr.io/catthehacker/ubuntu:runner-22.04: Closer to GitHub Actions runner (~2-5GB)
#   - ghcr.io/catthehacker/ubuntu:full-22.04: Near-identical to GitHub Actions runner (~20GB compressed)
# Use --build-arg BASE_IMAGE=<image> to customize
ARG BASE_IMAGE=ubuntu:22.04
FROM ${BASE_IMAGE}

# Install required packages and Node.js 22
# Note: gosu and libcap2-bin removed - no longer needed with init container pattern
# Note: iptables removed - init container handles iptables setup
# Note: Some packages may already exist in runner-like base images, apt handles this gracefully
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    gh \
    gnupg \
    dnsutils \
    net-tools \
    netcat-openbsd && \
    # Prefer system binaries over runner toolcache (e.g., act images) for Node checks.
    export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH" && \
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
RUN if ! getent group awfuser >/dev/null 2>&1; then \
      if ! getent group ${USER_GID} >/dev/null 2>&1; then \
        groupadd -g ${USER_GID} awfuser; \
      else \
        groupadd awfuser; \
      fi; \
    fi && \
    if ! id -u awfuser >/dev/null 2>&1; then \
      if ! getent passwd ${USER_UID} >/dev/null 2>&1; then \
        useradd -u ${USER_UID} -g awfuser -m -s /bin/bash awfuser; \
      else \
        useradd -g awfuser -m -s /bin/bash awfuser; \
      fi; \
    fi && \
    # Create directories for awfuser
    mkdir -p /home/awfuser/.copilot/logs && \
    chown -R awfuser:awfuser /home/awfuser

# Copy entrypoint and PID logger (setup-iptables.sh removed - handled by init container)
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY pid-logger.sh /usr/local/bin/pid-logger.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/pid-logger.sh

# Install Docker stub script that shows helpful error message
# Docker-in-Docker support was removed in v0.9.1
COPY docker-stub.sh /usr/bin/docker
RUN chmod +x /usr/bin/docker

# Set working directory
WORKDIR /workspace

# Entrypoint performs system configuration as root, then switches to awfuser
# Note: USER directive not set - container starts as root for system configuration
# Security: NET_ADMIN capability is NOT granted (handled by separate init container)
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
