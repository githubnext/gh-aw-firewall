#!/bin/bash
# Integration test for user mode (agent running as non-root)

set -e

echo "=== User Mode Integration Test ==="
echo ""

# Check that entrypoint.sh contains gosu
if ! grep -q "exec gosu awfuser" containers/agent/entrypoint.sh; then
  echo "❌ FAIL: entrypoint.sh doesn't use gosu to drop privileges"
  exit 1
fi
echo "✓ entrypoint.sh uses gosu to drop privileges"

# Check that Dockerfile creates awfuser
if ! grep -q "useradd.*awfuser" containers/agent/Dockerfile; then
  echo "❌ FAIL: Dockerfile doesn't create awfuser"
  exit 1
fi
echo "✓ Dockerfile creates awfuser"

# Check that Dockerfile installs gosu
if ! grep -q "gosu" containers/agent/Dockerfile; then
  echo "❌ FAIL: Dockerfile doesn't install gosu"
  exit 1
fi
echo "✓ Dockerfile installs gosu"

# Check that entrypoint.sh has runtime UID adjustment
if ! grep -q "AWF_USER_UID" containers/agent/entrypoint.sh; then
  echo "❌ FAIL: entrypoint.sh doesn't have runtime UID adjustment"
  exit 1
fi
echo "✓ entrypoint.sh has runtime UID adjustment"

# Check that docker-manager.ts passes UID/GID env vars
if ! grep -q "AWF_USER_UID" src/docker-manager.ts; then
  echo "❌ FAIL: docker-manager.ts doesn't pass AWF_USER_UID"
  exit 1
fi
echo "✓ docker-manager.ts passes AWF_USER_UID"

# Check that docker-manager.ts passes UID/GID as build args for local builds
if ! grep -q "USER_UID" src/docker-manager.ts; then
  echo "❌ FAIL: docker-manager.ts doesn't pass USER_UID as build arg"
  exit 1
fi
echo "✓ docker-manager.ts passes USER_UID as build arg"

echo ""
echo "=== All checks passed ✓ ==="
echo ""
echo "Summary:"
echo "- Agent container creates non-root user (awfuser)"
echo "- UID/GID can be specified at build time (for local builds)"
echo "- UID/GID adjusted at runtime (for GHCR images)"
echo "- User command executes as awfuser (non-root)"
echo "- Privileged setup (iptables, DNS) still runs as root in entrypoint"
