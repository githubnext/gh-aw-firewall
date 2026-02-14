#!/bin/bash
# API Key Helper for Claude Code
# This script outputs a placeholder API key since the real key is held
# exclusively in the api-proxy sidecar container for credential isolation.
#
# The api-proxy intercepts requests and injects the real ANTHROPIC_API_KEY,
# so this placeholder key will never reach the actual Anthropic API.
#
# This approach ensures:
# 1. Claude Code agent never has access to the real API key
# 2. Only api-proxy container holds the real credentials
# 3. Health checks verify keys are NOT in agent environment

# Log helper invocation to stderr (stdout is reserved for the API key)
echo "[get-claude-key.sh] API key helper invoked at $(date -Iseconds)" >&2
echo "[get-claude-key.sh] Returning placeholder key for credential isolation" >&2
echo "[get-claude-key.sh] Real authentication via ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL:-not set}" >&2

# Output a placeholder key (will be replaced by api-proxy)
echo "sk-ant-placeholder-key-for-credential-isolation"
