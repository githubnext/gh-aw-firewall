#!/bin/bash
# Example: Run a GitHub MCP-style workload through AWF
#
# Uses the GitHub Actions/GITHUB_TOKEN (or a PAT) to call the GitHub API from
# a Dockerized workload, while the firewall blocks non-GitHub domains.
#
# Usage:
#   export GITHUB_TOKEN=ghp_xxx   # or rely on GitHub Actions default token
#   sudo -E ./examples/github-mcp-smoke.sh

set -euo pipefail

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "Error: GITHUB_TOKEN is required (GitHub Actions token or PAT)." >&2
  exit 1
fi

echo "=== Pulling helper image (curl) ==="
docker pull curlimages/curl:latest >/dev/null

ALLOW_DOMAINS="api.github.com,github.com,objects.githubusercontent.com,ghcr.io"

echo "=== Calling GitHub API through AWF (allowed) ==="
sudo -E awf \
  --allow-domains "${ALLOW_DOMAINS}" \
  --log-level warn \
  -- 'docker run --rm -e GITHUB_TOKEN curlimages/curl:latest sh -c '"'"'curl -fsS -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/rate_limit'"'"''

echo "=== Attempting blocked domain through AWF (should fail) ==="
if sudo -E awf \
  --allow-domains "${ALLOW_DOMAINS}" \
  --log-level warn \
  -- 'docker run --rm curlimages/curl:latest -fsS https://example.com --max-time 8'; then
  echo "Unexpected success: example.com should be blocked" >&2
  exit 1
fi

echo "=== Example complete: GitHub traffic allowed, other domains blocked ==="
