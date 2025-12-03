# Use node:22-bookworm-slim as base (includes Node.js 22, npm, and common utilities)
# This is much smaller than ubuntu:22.04 + nodejs installation
FROM node:22-bookworm-slim

# Copy Docker CLI from official Docker image (avoids network downloads during build)
COPY --from=docker:27.4.1-cli /usr/local/bin/docker /usr/local/bin/docker

# Install only required packages:
# - iptables: NAT redirection to Squid proxy
# - git: required for git safe.directory config and user workflows
# - ca-certificates: HTTPS certificate verification
#
# Removed packages (not required for core functionality):
# - dnsutils: dig/nslookup not used in scripts
# - net-tools: netstat not used in scripts
# - netcat-openbsd: not used in agent scripts (only in squid healthcheck)
# - curl: not needed in final image (was only for Docker install)
# - gnupg: not needed (was only for Docker repo key)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    iptables \
    git \
    ca-certificates && \
    # Clean up apt cache to reduce image size
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Copy iptables setup script and docker wrapper
COPY setup-iptables.sh /usr/local/bin/setup-iptables.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker-wrapper.sh /usr/local/bin/docker-wrapper.sh
RUN chmod +x /usr/local/bin/setup-iptables.sh /usr/local/bin/entrypoint.sh /usr/local/bin/docker-wrapper.sh

# Install docker wrapper to intercept docker commands
# Move real docker binary to docker-real and replace with wrapper
RUN mv /usr/local/bin/docker /usr/bin/docker-real && \
    ln -s /usr/local/bin/docker-wrapper.sh /usr/bin/docker

# Set working directory
WORKDIR /workspace

# Use entrypoint to setup iptables and run command
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
