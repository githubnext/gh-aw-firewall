# Kong API Gateway for credential management
# Routes through Squid to respect domain whitelisting
FROM kong:3.5-alpine

# Install curl for healthchecks and envsubst for config templating
USER root
RUN apk add --no-cache curl gettext

# Create configuration directory
RUN mkdir -p /etc/kong

# Copy Kong declarative configuration template
COPY kong.yml.template /etc/kong/kong.yml.template

# Copy entrypoint script that generates config from environment
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Switch back to kong user
USER kong

# Expose ports
# 8000 - HTTP proxy port (we'll use this for OpenAI API)
# 8001 - Admin API (for health checks)
EXPOSE 8000 8001

# Use our custom entrypoint that generates config from env vars
ENTRYPOINT ["/entrypoint.sh"]
