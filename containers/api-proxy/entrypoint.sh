#!/bin/sh
# Entrypoint script for nginx API proxy
# Substitutes environment variables in nginx configuration

set -e

# Check if API keys are set
if [ -z "$OPENAI_API_KEY" ]; then
    echo "WARNING: OPENAI_API_KEY is not set - OpenAI proxy will not function"
    # Use empty string as placeholder
    OPENAI_API_KEY=""
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "WARNING: ANTHROPIC_API_KEY is not set - Anthropic proxy will not function"
    # Use empty string as placeholder
    ANTHROPIC_API_KEY=""
fi

# Replace environment variable placeholders in nginx config
# Use sed to substitute variables
sed -e "s|\${OPENAI_API_KEY}|${OPENAI_API_KEY}|g" \
    -e "s|\${ANTHROPIC_API_KEY}|${ANTHROPIC_API_KEY}|g" \
    /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

# Test nginx configuration
nginx -t

# Start nginx in foreground
exec nginx -g 'daemon off;'
