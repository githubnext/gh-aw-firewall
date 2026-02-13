#!/bin/sh
set -e

echo "[Kong] Starting AWF Kong API Gateway..."
echo "[Kong] HTTP_PROXY: ${HTTP_PROXY:-not configured}"
echo "[Kong] HTTPS_PROXY: ${HTTPS_PROXY:-not configured}"

if [ -n "$OPENAI_API_KEY" ]; then
  echo "[Kong] OpenAI API key configured"
else
  echo "[Kong] WARNING: OpenAI API key not configured"
fi

# Generate Kong configuration from template with environment variable substitution
# This injects the OPENAI_API_KEY into the config file
echo "[Kong] Generating Kong configuration from template..."
envsubst < /etc/kong/kong.yml.template > /etc/kong/kong.yml

# Validate the generated configuration
echo "[Kong] Validating Kong configuration..."
if ! kong config parse /etc/kong/kong.yml 2>/dev/null; then
  echo "[Kong] ERROR: Invalid Kong configuration"
  cat /etc/kong/kong.yml
  exit 1
fi

echo "[Kong] Configuration validated successfully"

# Set Kong environment variables
export KONG_DATABASE=off
export KONG_DECLARATIVE_CONFIG=/etc/kong/kong.yml
export KONG_PROXY_LISTEN="0.0.0.0:8000"
export KONG_ADMIN_LISTEN="0.0.0.0:8001"
export KONG_LOG_LEVEL=info

# Kong will automatically use HTTP_PROXY and HTTPS_PROXY environment variables
# for routing upstream requests through Squid
if [ -n "$HTTPS_PROXY" ]; then
  echo "[Kong] Routing upstream HTTPS requests through Squid proxy"
fi

# Start Kong in foreground mode
echo "[Kong] Starting Kong Gateway..."
exec kong start --v
