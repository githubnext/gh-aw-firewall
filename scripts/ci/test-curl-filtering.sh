#!/usr/bin/env bash

# Test script for comprehensive domain filtering validation
# Tests both allowed domains (should pass) and blocked domains (should be rejected)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0

# Cleanup function
cleanup() {
  echo ""
  echo "=========================================="
  echo "Cleaning up Docker resources..."
  echo "=========================================="
  "$SCRIPT_DIR/cleanup.sh" || true
}

# Ensure cleanup runs on exit
trap cleanup EXIT

# Cleanup any leftover resources from previous runs
echo "Pre-test cleanup..."
cleanup

# Test configuration
ALLOWED_DOMAINS="github.com,api.github.com,raw.githubusercontent.com,registry.npmjs.org"

echo ""
echo "=========================================="
echo "Domain Filtering Test Suite"
echo "=========================================="
echo "Allowed domains: $ALLOWED_DOMAINS"
echo ""

# Helper function to run a positive test (should succeed)
test_allowed_domain() {
  local domain="$1"
  local url="$2"
  local test_name="$3"

  echo ""
  echo "${BLUE}[TEST]${NC} $test_name"
  echo "  Domain: $domain"
  echo "  URL: $url"
  echo "  Expected: SUCCESS (domain is allowed)"

  local log_file="/tmp/curl-test-allowed-${domain//\//-}.log"

  # Run curl through firewall
  if timeout 30s sudo awf \
    --allow-domains "$ALLOWED_DOMAINS" \
    --log-level debug \
    "curl -s -o /dev/null -w '%{http_code}\n' $url" \
    > "$log_file" 2>&1; then

    # Check if we got a successful HTTP response
    # Look for lines that are just 3 digits (HTTP codes) after the curl command
    local http_code
    # Try docker compose logs format first (with container name prefix)
    http_code=$(grep "awf-agent.*|" "$log_file" | grep -oE '\|\s*[0-9]{3}\s*$' | grep -oE '[0-9]{3}' | tail -1 || echo "")
    # If not found, try docker logs format (no prefix, just look for standalone 3-digit lines after Executing command)
    if [ -z "$http_code" ]; then
      http_code=$(grep -A 2 "Executing command:" "$log_file" | grep -oE '^\s*[0-9]{3}\s*$' | grep -oE '[0-9]{3}' | tail -1 || echo "000")
    fi

    if [[ "$http_code" =~ ^(200|301|302|304)$ ]]; then
      echo "${GREEN}  ✓ PASS${NC} - Got HTTP $http_code (domain allowed, request succeeded)"
      TESTS_PASSED=$((TESTS_PASSED + 1))
      return 0
    else
      echo "${RED}  ✗ FAIL${NC} - Got HTTP $http_code (expected 2xx/3xx)"
      echo "  Log: $log_file"
      TESTS_FAILED=$((TESTS_FAILED + 1))
      return 1
    fi
  else
    echo "${RED}  ✗ FAIL${NC} - Command failed or timed out"
    echo "  Log: $log_file"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Helper function to run a negative test (should be blocked)
test_blocked_domain() {
  local domain="$1"
  local url="$2"
  local test_name="$3"

  echo ""
  echo "${BLUE}[TEST]${NC} $test_name"
  echo "  Domain: $domain"
  echo "  URL: $url"
  echo "  Expected: BLOCKED (domain not in allowlist)"

  local log_file="/tmp/curl-test-blocked-${domain//\//-}.log"

  # Run curl through firewall (expect failure)
  set +e
  timeout 30s sudo awf \
    --allow-domains "$ALLOWED_DOMAINS" \
    --log-level debug \
    "curl -s -m 10 -o /dev/null -w '%{http_code}\n' $url" \
    > "$log_file" 2>&1
  local exit_code=$?
  set -e

  # Check if the request was blocked (look for proxy denial messages)
  if grep -qiE "denied|forbidden|403|ERR_ACCESS_DENIED|connection.*refused|proxy.*error" "$log_file"; then
    echo "${GREEN}  ✓ PASS${NC} - Request was blocked by proxy (expected behavior)"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  # Also consider it blocked if curl timed out (iptables dropped packets)
  elif [[ $exit_code -eq 124 ]] || grep -qiE "timeout|timed out" "$log_file"; then
    echo "${GREEN}  ✓ PASS${NC} - Request timed out (likely blocked by firewall)"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  # Check if curl got a 000 code (connection failed)
  elif grep -qE "000" "$log_file"; then
    echo "${GREEN}  ✓ PASS${NC} - Connection failed (blocked by proxy)"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo "${RED}  ✗ FAIL${NC} - Request was NOT blocked (security issue!)"
    echo "  Expected: proxy denial or connection failure"
    echo "  Got: Request may have succeeded"
    echo "  Log: $log_file"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

echo ""
echo "=========================================="
echo "POSITIVE TESTS: Allowed Domains"
echo "=========================================="

# Test allowed domains (should all succeed)
test_allowed_domain "github.com" "https://github.com" \
  "Access GitHub homepage"

test_allowed_domain "api.github.com" "https://api.github.com/zen" \
  "Access GitHub API /zen endpoint"

test_allowed_domain "api.github.com" "https://api.github.com/repos/nodejs/node" \
  "Access GitHub API /repos endpoint"

test_allowed_domain "raw.githubusercontent.com" "https://raw.githubusercontent.com/github/gitignore/main/Node.gitignore" \
  "Access raw content from GitHub"

test_allowed_domain "registry.npmjs.org" "https://registry.npmjs.org/express" \
  "Access npm registry"

echo ""
echo "=========================================="
echo "NEGATIVE TESTS: Blocked Domains"
echo "=========================================="

# Test blocked domains (should all be denied)
test_blocked_domain "httpbin.org" "https://httpbin.org/get" \
  "Block httpbin.org (not in allowlist)"

test_blocked_domain "example.com" "https://example.com" \
  "Block example.com (not in allowlist)"

test_blocked_domain "google.com" "https://google.com" \
  "Block google.com (not in allowlist)"

test_blocked_domain "amazon.com" "https://amazon.com" \
  "Block amazon.com (not in allowlist)"

test_blocked_domain "malicious-site.com" "https://malicious-site.com" \
  "Block unknown domain (not in allowlist)"

# Print summary
echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo "${GREEN}Passed:${NC} $TESTS_PASSED"
echo "${RED}Failed:${NC} $TESTS_FAILED"
echo "Total:  $((TESTS_PASSED + TESTS_FAILED))"
echo "=========================================="

if [ $TESTS_FAILED -gt 0 ]; then
  echo ""
  echo "${RED}✗ SOME TESTS FAILED${NC}"
  echo "Check the logs in /tmp/curl-test-*.log for details"
  exit 1
else
  echo ""
  echo "${GREEN}✓ ALL TESTS PASSED${NC}"
  exit 0
fi
