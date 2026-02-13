#!/bin/bash
# Test script to verify tokens are unset from /proc/1/environ after agent starts

set -e

echo "=== Testing token unsetting from entrypoint environ ==="

# Set test tokens
export GITHUB_TOKEN="ghp_test_token_12345"
export OPENAI_API_KEY="sk-test_openai_key_67890"
export ANTHROPIC_API_KEY="sk-ant-test_key_abcdef"

echo "Test tokens set in host environment"

# Run a simple command that waits 10 seconds (longer than the 5-second token unset delay)
# This gives us time to check /proc/1/environ inside the container
echo "Running awf with test tokens..."
sudo -E node dist/cli.js \
  --allow-domains example.com \
  --build-local \
  --keep-containers \
  -- bash -c '
    echo "Agent started, checking /proc/1/environ in container..."
    sleep 2

    # Check if tokens are still in /proc/1/environ
    echo "Checking /proc/1/environ for GITHUB_TOKEN..."
    if cat /proc/1/environ | tr "\0" "\n" | grep -q "GITHUB_TOKEN="; then
      echo "ERROR: GITHUB_TOKEN still in /proc/1/environ"
      exit 1
    else
      echo "SUCCESS: GITHUB_TOKEN not in /proc/1/environ"
    fi

    echo "Checking /proc/1/environ for OPENAI_API_KEY..."
    if cat /proc/1/environ | tr "\0" "\n" | grep -q "OPENAI_API_KEY="; then
      echo "ERROR: OPENAI_API_KEY still in /proc/1/environ"
      exit 1
    else
      echo "SUCCESS: OPENAI_API_KEY not in /proc/1/environ"
    fi

    echo "Checking /proc/1/environ for ANTHROPIC_API_KEY..."
    if cat /proc/1/environ | tr "\0" "\n" | grep -q "ANTHROPIC_API_KEY="; then
      echo "ERROR: ANTHROPIC_API_KEY still in /proc/1/environ"
      exit 1
    else
      echo "SUCCESS: ANTHROPIC_API_KEY not in /proc/1/environ"
    fi

    # Verify agent can still read tokens via getenv (cached by one-shot-token library)
    echo "Checking if agent can still read GITHUB_TOKEN via getenv..."
    if [ -n "$GITHUB_TOKEN" ]; then
      echo "SUCCESS: Agent can still read GITHUB_TOKEN (value: ${GITHUB_TOKEN:0:10}...)"
    else
      echo "WARNING: GITHUB_TOKEN not accessible to agent"
    fi

    echo "All checks passed!"
    exit 0
  '

EXIT_CODE=$?

# Cleanup
echo "Cleaning up containers..."
sudo docker compose -f /tmp/awf-*/docker-compose.yml down -v 2>/dev/null || true

if [ $EXIT_CODE -eq 0 ]; then
  echo "=== TEST PASSED ==="
else
  echo "=== TEST FAILED ==="
  exit 1
fi
