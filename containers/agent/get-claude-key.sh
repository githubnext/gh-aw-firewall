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

# Output a placeholder key (will be replaced by api-proxy)
echo "sk-ant-placeholder-key-for-credential-isolation"
