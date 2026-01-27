# Agent Setup Container - Performs privileged iptables configuration
# This init container runs first with NET_ADMIN capability to set up iptables rules,
# then exits. The main agent container runs without any elevated privileges.

FROM ubuntu:22.04

# Install required packages for iptables setup
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    iptables \
    dnsutils \
    net-tools \
    netcat-openbsd && \
    rm -rf /var/lib/apt/lists/*

# Copy iptables setup script
COPY setup-iptables.sh /usr/local/bin/setup-iptables.sh
RUN chmod +x /usr/local/bin/setup-iptables.sh

# The container runs the setup script and exits
# It shares the network namespace with the agent container,
# so iptables rules configured here apply to the agent
ENTRYPOINT ["/usr/local/bin/setup-iptables.sh"]
