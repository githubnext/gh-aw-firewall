# Envoy proxy for API key management and proxying
# This sidecar container holds API keys and proxies requests to LLM providers
# Supports OpenAI (Codex) and Anthropic (Claude) APIs

FROM envoyproxy/envoy:v1.31-latest

# Install curl for healthchecks
USER root
RUN apt-get update && \
    apt-get install -y curl && \
    rm -rf /var/lib/apt/lists/*

# Copy entrypoint script that generates envoy.yaml from environment variables
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create directory for generated config
RUN mkdir -p /etc/envoy

# Switch back to envoy user for running the proxy
USER envoy

# Expose ports for proxying
# 10000 - OpenAI API proxy (Codex)
# 10001 - Anthropic API proxy (Claude)
EXPOSE 10000 10001

ENTRYPOINT ["/entrypoint.sh"]
CMD ["-c", "/etc/envoy/envoy.yaml"]
