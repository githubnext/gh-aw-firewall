#!/bin/bash
# Example: Running Docker containers inside the firewall (Docker-in-Docker)
#
# This example demonstrates how spawned Docker containers inherit
# the firewall restrictions. All network traffic from nested containers
# is also filtered through the domain allowlist.
#
# Usage: sudo ./examples/docker-in-docker.sh

set -e

echo "=== AWF Docker-in-Docker Example ==="
echo ""

# Docker-in-Docker requires access to Docker Hub for pulling images
DOCKER_DOMAINS="registry-1.docker.io,auth.docker.io,production.cloudflare.docker.com"

echo "1. Running curl container with api.github.com allowed..."
echo ""

# This should succeed - api.github.com is in the allowlist
sudo awf \
  --allow-domains "api.github.com,$DOCKER_DOMAINS" \
  -- 'docker run --rm curlimages/curl -s https://api.github.com/zen'

echo ""
echo "2. Attempting to access example.com (should be blocked)..."
echo ""

# This should fail - example.com is NOT in the allowlist
# Capture exit code to show what a blocked request looks like
sudo awf \
  --allow-domains "$DOCKER_DOMAINS" \
  -- 'docker run --rm curlimages/curl -f --max-time 10 https://example.com' || echo "Exit code: $? (blocked as expected)"

echo ""
echo "(The above error is expected - example.com was blocked by the firewall)"
echo ""
echo "=== Example Complete ==="
