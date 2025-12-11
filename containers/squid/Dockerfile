FROM ubuntu/squid:latest

# Install additional tools for debugging and healthcheck
RUN set -e; \
    # Retry logic for apt-get commands
    retry_command() { \
        local max_attempts=5; \
        local attempt=1; \
        local delay=2; \
        while [ $attempt -le $max_attempts ]; do \
            if eval "$@"; then \
                return 0; \
            fi; \
            echo "Command failed (attempt $attempt/$max_attempts)"; \
            if [ $attempt -lt $max_attempts ]; then \
                echo "Retrying in ${delay}s..."; \
                sleep $delay; \
                delay=$((delay * 2)); \
            fi; \
            attempt=$((attempt + 1)); \
        done; \
        echo "Command failed after $max_attempts attempts"; \
        return 1; \
    }; \
    # Install packages with retry
    retry_command "apt-get update" && \
    retry_command "apt-get install -y --no-install-recommends \
        curl \
        dnsutils \
        net-tools \
        netcat-openbsd" && \
    rm -rf /var/lib/apt/lists/*

# Create log directory
RUN mkdir -p /var/log/squid && \
    chown -R proxy:proxy /var/log/squid

# Copy entrypoint script
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Expose Squid port
EXPOSE 3128

# Use entrypoint to fix permissions before starting Squid
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
