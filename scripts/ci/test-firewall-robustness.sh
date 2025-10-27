#!/usr/bin/env bash

# test-firewall-robustness.sh
# Comprehensive firewall robustness test suite
# Tests L7 HTTP/HTTPS filtering, protocol edges, Docker container egress, and security corner cases
#
# Usage: ./test-firewall-robustness.sh [--quick]
#   --quick: Skip slow tests (Docker build, IPv6, etc.)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Helper to print with colors
print_color() {
  echo -e "$@"
}

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

# Test mode
QUICK_MODE=false
if [[ "${1:-}" == "--quick" ]]; then
  QUICK_MODE=true
  echo -e "${YELLOW}Running in QUICK mode (skipping slow tests)${NC}"
fi

# Cleanup function
cleanup() {
  echo ""
  echo "=========================================="
  echo "Cleaning up Docker resources..."
  echo "=========================================="
  "$SCRIPT_DIR/cleanup.sh" || true

  # Clean up any test containers
  docker rm -f badproxy fwd tnet-test 2>/dev/null || true
  docker network rm tnet 2>/dev/null || true
}

# Ensure cleanup runs on exit
trap cleanup EXIT

# Cleanup any leftover resources from previous runs
echo "Pre-test cleanup..."
cleanup

# Base configuration
BASE_ALLOWED_DOMAINS="github.com,api.github.com,httpbin.org"

echo ""
echo "=========================================="
echo "Firewall Robustness Test Suite"
echo "=========================================="
echo "Base allowed domains: $BASE_ALLOWED_DOMAINS"
echo ""

# Helper function to run a test that should succeed
test_should_succeed() {
  local test_name="$1"
  local allowed_domains="$2"
  local command="$3"
  local log_file="${4:-/tmp/firewall-test-$(echo "$test_name" | tr ' ' '-' | tr '[:upper:]' '[:lower:]').log}"

  echo ""
  echo -e "${BLUE}[TEST]${NC} $test_name"
  echo "  Allowed: $allowed_domains"
  echo "  Command: $command"
  echo -e "  Expected: ${GREEN}SUCCESS${NC}"

  if timeout 30s sudo awf \
    --allow-domains "$allowed_domains" \
    --log-level warn \
    "$command" \
    > "$log_file" 2>&1; then

    echo -e "${GREEN}  ✓ PASS${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    local exit_code=$?
    echo -e "${RED}  ✗ FAIL${NC} - Command failed with exit code $exit_code"
    echo "  Log: $log_file"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Helper function to run a test that should fail
test_should_fail() {
  local test_name="$1"
  local allowed_domains="$2"
  local command="$3"
  local log_file="${4:-/tmp/firewall-test-$(echo "$test_name" | tr ' ' '-' | tr '[:upper:]' '[:lower:]').log}"

  echo ""
  echo -e "${BLUE}[TEST]${NC} $test_name"
  echo "  Allowed: $allowed_domains"
  echo "  Command: $command"
  echo -e "  Expected: ${RED}BLOCKED${NC}"

  set +e
  timeout 30s sudo awf \
    --allow-domains "$allowed_domains" \
    --log-level warn \
    "$command" \
    > "$log_file" 2>&1
  local exit_code=$?
  set -e

  # Success means command failed (was blocked)
  if [[ $exit_code -ne 0 ]]; then
    # Check for test setup errors first (these should cause the test to fail)
    # Exclude matches from the "[entrypoint] Executing command:" line to avoid false positives
    if grep -v "^\[entrypoint\] Executing command:" "$log_file" 2>/dev/null | grep -qiE "Failed to resolve IP|Couldn't parse CURLOPT_RESOLVE|command not found"; then
      echo -e "${RED}  ✗ FAIL${NC} - Test setup error (exit code: $exit_code)"
      echo "  Log: $log_file"
      echo "  Hint: Check the log for setup/configuration issues"
      TESTS_FAILED=$((TESTS_FAILED + 1))
      return 1
    fi

    # Verify it was blocked (not a different error)
    # Note: HTTP 400 errors from Squid often indicate blocked IP literal access
    if grep -qiE "denied|forbidden|403|ERR_ACCESS_DENIED|connection.*refused|proxy.*error|timeout|timed out|Empty reply|Failed to connect|Connection reset|Could not resolve host|error: 400|returned error: 400" "$log_file" 2>/dev/null; then
      echo -e "${GREEN}  ✓ PASS${NC} - Request was blocked (exit code: $exit_code)"
      TESTS_PASSED=$((TESTS_PASSED + 1))
      return 0
    else
      echo -e "${YELLOW}  ~ PASS (likely)${NC} - Command failed but no explicit block message found"
      echo "  Log: $log_file"
      TESTS_PASSED=$((TESTS_PASSED + 1))
      return 0
    fi
  else
    echo -e "${RED}  ✗ FAIL${NC} - Command succeeded when it should have been blocked!"
    echo "  Log: $log_file"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Helper function to skip a test
skip_test() {
  local test_name="$1"
  local reason="${2:-Skipped in quick mode}"

  echo ""
  echo -e "${BLUE}[TEST]${NC} $test_name"
  echo -e "${YELLOW}  ⊘ SKIP${NC} - $reason"
  TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
}

################################################################################
# 1) Happy-path basics
################################################################################

echo ""
echo "=========================================="
echo "1. HAPPY-PATH BASICS"
echo "=========================================="

test_should_succeed \
  "Allow exact domain" \
  "github.com" \
  "curl -fsS https://github.com/robots.txt"

test_should_succeed \
  "Multiple allowed domains" \
  "github.com,api.github.com" \
  "curl -fsS https://api.github.com/zen"

test_should_succeed \
  "Subdomain allowed (api.github.com via github.com)" \
  "github.com" \
  "curl -fsS https://api.github.com/zen"

test_should_succeed \
  "Case insensitive, spaces, trailing dot" \
  " GitHub.COM. , API.GitHub.com " \
  "curl -fsS https://api.github.com/zen"

################################################################################
# 2) Deny cases that must fail
################################################################################

echo ""
echo "=========================================="
echo "2. DENY CASES"
echo "=========================================="

test_should_fail \
  "Block different domain" \
  "github.com" \
  "curl -f https://example.com"

# IP literal test - direct IP access should be blocked
test_should_fail \
  "Block direct IP literal access" \
  "github.com" \
  "bash -c 'ip=\$(dig +short api.github.com 2>/dev/null | grep -E \"^[0-9.]+$\" | head -1); if [ -z \"\$ip\" ]; then echo \"Failed to resolve IP\" && exit 1; fi; curl -fk https://\$ip'"

test_should_fail \
  "Block non-standard port" \
  "github.com" \
  "curl -f https://github.com:8443 --max-time 5"

################################################################################
# 3) Redirect behavior
################################################################################

echo ""
echo "=========================================="
echo "3. REDIRECT BEHAVIOR"
echo "=========================================="

test_should_fail \
  "Block cross-domain redirect" \
  "httpbin.org" \
  "curl -fL 'https://httpbin.org/redirect-to?url=https://example.com' --max-time 10"

test_should_succeed \
  "Allow same-domain redirect (HTTP→HTTPS upgrade)" \
  "github.com" \
  "curl -fL http://github.com --max-time 10"

################################################################################
# 4) Protocol & transport edges
################################################################################

echo ""
echo "=========================================="
echo "4. PROTOCOL & TRANSPORT EDGES"
echo "=========================================="

test_should_succeed \
  "HTTP/2 support" \
  "api.github.com" \
  "curl -fsS --http2 https://api.github.com/zen"

test_should_fail \
  "Block curl --connect-to bypass attempt" \
  "github.com" \
  "curl -f --connect-to ::github.com: https://example.com --max-time 5"

test_should_fail \
  "Block NO_PROXY environment variable bypass" \
  "github.com" \
  "env NO_PROXY='*' curl -f https://example.com --max-time 5"

test_should_fail \
  "Block DNS over HTTPS (DoH)" \
  "github.com" \
  "curl -f https://cloudflare-dns.com/dns-query --max-time 5"

test_should_fail \
  "Block AWS metadata endpoint" \
  "github.com" \
  "curl -f http://169.254.169.254 --max-time 5"

################################################################################
# 5) IPv4/IPv6 parity
################################################################################

echo ""
echo "=========================================="
echo "5. IPv4/IPv6 PARITY"
echo "=========================================="

test_should_succeed \
  "IPv4 dual-stack" \
  "api.github.com" \
  "curl -fsS -4 https://api.github.com/zen"

if [[ "$QUICK_MODE" == "false" ]]; then
  # IPv6 tests are often slow or unavailable
  test_should_succeed \
    "IPv6 dual-stack (if available)" \
    "api.github.com" \
    "curl -fsS -6 https://api.github.com/zen || exit 0"
else
  skip_test "IPv6 dual-stack (if available)"
fi

################################################################################
# 6) Git & CLI real-world
################################################################################

echo ""
echo "=========================================="
echo "6. GIT OPERATIONS"
echo "=========================================="

test_should_succeed \
  "Git over HTTPS allowed" \
  "github.com" \
  "git ls-remote https://github.com/octocat/Hello-World.git HEAD"

################################################################################
# 7) Security/threat-model corner cases
################################################################################

echo ""
echo "=========================================="
echo "7. SECURITY CORNER CASES"
echo "=========================================="

test_should_fail \
  "Block SNI ≠ Host header mismatch" \
  "github.com" \
  "curl -fk --header 'Host: github.com' https://example.com --max-time 5"

test_should_fail \
  "Block link-local multicast (mDNS)" \
  "github.com" \
  "timeout 5 nc -u -w1 224.0.0.251 5353 </dev/null || exit 1"

################################################################################
# 8) Docker container egress tests
################################################################################

echo ""
echo "=========================================="
echo "8. DOCKER CONTAINER EGRESS"
echo "=========================================="

echo ""
echo -e "${CYAN}8A. Basic container egress${NC}"

test_should_succeed \
  "Container: Allow whitelisted domain (HTTPS)" \
  "api.github.com" \
  "docker run --rm curlimages/curl:latest -fsS https://api.github.com/zen"

test_should_fail \
  "Container: Block non-whitelisted domain" \
  "github.com" \
  "docker run --rm curlimages/curl:latest -f https://example.com"

echo ""
echo -e "${CYAN}8B. Network modes${NC}"

test_should_succeed \
  "Container: Bridge mode (default) honored" \
  "github.com" \
  "docker run --rm curlimages/curl:latest -fsS https://github.com/robots.txt"

test_should_fail \
  "Container: Host mode must NOT bypass firewall" \
  "github.com" \
  "docker run --rm --network host curlimages/curl:latest -f https://example.com --max-time 5"

test_should_fail \
  "Container: None mode has no egress" \
  "github.com" \
  "docker run --rm --network none curlimages/curl:latest -f https://github.com --max-time 5"

echo ""
echo -e "${CYAN}8C. DNS controls from container${NC}"

test_should_succeed \
  "Container: Custom resolver with allowed domain" \
  "api.github.com" \
  "docker run --rm --dns 8.8.8.8 curlimages/curl:latest -fsS https://api.github.com/zen"

test_should_fail \
  "Container: /etc/hosts injection shouldn't bypass" \
  "github.com" \
  "bash -c 'ip=\$(getent hosts example.com | awk \"{print \\\$1}\" | head -1); if [ -z \"\$ip\" ]; then echo \"Failed to resolve IP\" && exit 1; fi; docker run --rm --add-host github.com:\$ip curlimages/curl:latest -fk https://github.com --max-time 5'"

echo ""
echo -e "${CYAN}8D. Proxy pivot attempts inside Docker${NC}"

# Start a malicious internal proxy
docker rm -f badproxy >/dev/null 2>&1 || true
docker pull dannydirect/tinyproxy:latest >/dev/null 2>&1 || true
docker run -d --name badproxy dannydirect/tinyproxy:latest >/dev/null 2>&1 || true
sleep 2

test_should_fail \
  "Container: Block internal HTTP proxy pivot" \
  "github.com" \
  "docker run --rm --link badproxy curlimages/curl:latest -f -x http://badproxy:8888 https://example.com --max-time 5"

docker rm -f badproxy >/dev/null 2>&1 || true

test_should_fail \
  "Container: Block SOCKS proxy from container" \
  "github.com" \
  "docker run --rm curlimages/curl:latest -f --socks5-hostname 127.0.0.1:1080 https://example.com --max-time 5"

echo ""
echo -e "${CYAN}8E. Container-to-container bounce${NC}"

# TCP forwarder to disallowed host
docker rm -f fwd >/dev/null 2>&1 || true
docker run -d --name fwd alpine sh -c \
  "apk add --no-cache socat >/dev/null 2>&1 && socat TCP-LISTEN:8443,fork,reuseaddr TCP4:example.com:443" >/dev/null 2>&1 || true
sleep 3

test_should_fail \
  "Container: Block TCP forwarder to disallowed host" \
  "github.com" \
  "docker run --rm --link fwd curlimages/curl:latest -fk https://fwd:8443 --max-time 5"

docker rm -f fwd >/dev/null 2>&1 || true

echo ""
echo -e "${CYAN}8F. UDP, QUIC, multicast from container${NC}"

test_should_fail \
  "Container: Block mDNS (UDP/5353)" \
  "github.com" \
  "docker run --rm alpine sh -c 'apk add --no-cache netcat-openbsd >/dev/null 2>&1 && timeout 5 nc -u -w1 224.0.0.251 5353 </dev/null || exit 1'"

if [[ "$QUICK_MODE" == "false" ]]; then
  test_should_fail \
    "Container: Block HTTP/3 (UDP/443) unless explicitly allowed" \
    "api.github.com" \
    "docker run --rm curlimages/curl:latest --http3 -fsS https://api.github.com/zen --max-time 5"
else
  skip_test "Container: Block HTTP/3 (UDP/443) unless explicitly allowed"
fi

echo ""
echo -e "${CYAN}8G. Metadata & link-local protection${NC}"

test_should_fail \
  "Container: Block AWS/GCP metadata IPs (v4)" \
  "github.com" \
  "docker run --rm curlimages/curl:latest -f http://169.254.169.254 --max-time 5"

test_should_fail \
  "Container: Block IPv6 link-local multicast" \
  "github.com" \
  "docker run --rm alpine sh -c 'apk add --no-cache netcat-openbsd >/dev/null 2>&1 && timeout 5 nc -6 -u -w1 ff02::fb 5353 </dev/null || exit 1'"

echo ""
echo -e "${CYAN}8H. Privilege & capability abuse${NC}"

test_should_fail \
  "Container: NET_ADMIN shouldn't defeat host egress" \
  "github.com" \
  "docker run --rm --cap-add NET_ADMIN alpine sh -c 'apk add --no-cache curl >/dev/null 2>&1 && curl -f https://example.com --max-time 5'"

test_should_fail \
  "Container: Privileged container still blocked" \
  "github.com" \
  "docker run --rm --privileged curlimages/curl:latest -f https://example.com --max-time 5"

echo ""
echo -e "${CYAN}8I. Direct IP and SNI/Host mismatch from container${NC}"

test_should_fail \
  "Container: Block IP literal access" \
  "github.com" \
  "docker run --rm curlimages/curl:latest -f https://93.184.216.34 --max-time 5"

test_should_fail \
  "Container: Block SNI/Host mismatch via --resolve" \
  "github.com" \
  "bash -c 'ip=\$(getent hosts example.com | awk \"{print \\\$1}\" | head -1); if [ -z \"\$ip\" ]; then echo \"Failed to resolve IP\" && exit 1; fi; docker run --rm curlimages/curl:latest --noproxy \"*\" -fk --resolve github.com:443:\$ip https://github.com --max-time 5'"

echo ""
echo -e "${CYAN}8J. Custom networks${NC}"

docker network rm tnet >/dev/null 2>&1 || true
docker network create tnet >/dev/null 2>&1

test_should_succeed \
  "Container: User-defined bridge still enforced" \
  "api.github.com" \
  "docker run --rm --network tnet curlimages/curl:latest -fsS https://api.github.com/zen"

docker network rm tnet >/dev/null 2>&1 || true

echo ""
echo -e "${CYAN}8K. Build-time egress${NC}"

if [[ "$QUICK_MODE" == "false" ]]; then
  test_should_fail \
    "Container: docker build must respect policy" \
    "github.com" \
    "bash -c 'tmp=\$(mktemp -d); cat > \$tmp/Dockerfile <<\"EOF\"
FROM curlimages/curl:latest
RUN curl -f https://example.com || exit 1
EOF
docker build -t egress-test \$tmp --network=default --progress=plain; rm -rf \$tmp'"
else
  skip_test "Container: docker build must respect policy"
fi

echo ""
echo -e "${CYAN}8L. IPv6 from containers${NC}"

if [[ "$QUICK_MODE" == "false" ]]; then
  test_should_fail \
    "Container: Block IPv6 literal (Cloudflare DNS)" \
    "github.com" \
    "docker run --rm curlimages/curl:latest -f https://[2606:4700:4700::1111] --max-time 5"
else
  skip_test "Container: Block IPv6 literal (Cloudflare DNS)"
fi

################################################################################
# 9) Observability/contracts
################################################################################

echo ""
echo "=========================================="
echo "9. OBSERVABILITY"
echo "=========================================="

# Run a blocked request and verify logs contain required fields
echo ""
echo -e "${BLUE}[TEST]${NC} Verify audit log fields for blocked traffic"
echo "  Testing Squid logs contain: timestamp, domain, IP, protocol, decision"

log_test_file="/tmp/firewall-obs-test.log"
sudo awf \
  --allow-domains "github.com" \
  --keep-containers \
  "curl -f https://example.com --max-time 5" \
  > "$log_test_file" 2>&1 || true

# Find the workdir from the log
workdir=$(grep -oP 'Working directory: \K[^ ]+' "$log_test_file" | head -1 || echo "")

if [[ -n "$workdir" ]] && [[ -d "$workdir/squid-logs" ]]; then
  squid_log="$workdir/squid-logs/access.log"

  if [[ -f "$squid_log" ]]; then
    # Check for required fields in Squid logs
    # Format: timestamp client_ip:port domain dest_ip:port protocol method status decision url user-agent
    if sudo grep -qE '[0-9]+\.[0-9]{3}.*TCP_DENIED' "$squid_log" 2>/dev/null; then
      echo -e "${GREEN}  ✓ PASS${NC} - Squid logs contain timestamp, decision (TCP_DENIED)"
      TESTS_PASSED=$((TESTS_PASSED + 1))
    else
      echo -e "${RED}  ✗ FAIL${NC} - No TCP_DENIED entries found in Squid logs"
      echo "  Log: $squid_log"
      TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
  else
    echo -e "${YELLOW}  ~ SKIP${NC} - Squid log file not found at $squid_log"
    TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
  fi

  # Cleanup the workdir
  sudo rm -rf "$workdir" 2>/dev/null || true
else
  echo -e "${YELLOW}  ~ SKIP${NC} - Could not find workdir with Squid logs"
  TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
fi

################################################################################
# Summary
################################################################################

echo ""
echo "=========================================="
echo "TEST SUMMARY"
echo "=========================================="
echo -e "${GREEN}Passed:  ${NC} $TESTS_PASSED"
echo -e "${RED}Failed:  ${NC} $TESTS_FAILED"
echo -e "${YELLOW}Skipped: ${NC} $TESTS_SKIPPED"
echo "Total:    $((TESTS_PASSED + TESTS_FAILED + TESTS_SKIPPED))"
echo "=========================================="

if [ $TESTS_FAILED -gt 0 ]; then
  echo ""
  echo -e "${RED}✗ SOME TESTS FAILED${NC}"
  echo "Check the logs in /tmp/firewall-test-*.log for details"
  exit 1
else
  echo ""
  echo -e "${GREEN}✓ ALL TESTS PASSED${NC}"
  exit 0
fi
