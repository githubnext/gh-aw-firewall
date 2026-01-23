#!/bin/bash
set -e

echo "Testing Squid running as non-root user..."

# Create test directory with 777 permissions (like the code does)
TEST_DIR="/tmp/test-squid-nonroot-$$"
mkdir -p "$TEST_DIR/logs"
chmod 777 "$TEST_DIR/logs"

echo "Test directory created at $TEST_DIR with permissions:"
ls -ld "$TEST_DIR/logs"

# Create minimal squid config
cat > "$TEST_DIR/squid.conf" <<'EOF'
# Minimal Squid config for testing
http_port 3128
acl localnet src 172.30.0.0/24
http_access allow localnet
http_access deny all
access_log /var/log/squid/access.log
cache deny all
EOF

# Test 1: Run squid as root initially (current behavior)
echo ""
echo "Test 1: Running Squid with root entrypoint (current behavior)..."
docker run --rm \
  -v "$TEST_DIR/squid.conf:/etc/squid/squid.conf:ro" \
  -v "$TEST_DIR/logs:/var/log/squid:rw" \
  --entrypoint /bin/bash \
  ubuntu/squid:latest \
  -c 'chown -R proxy:proxy /var/log/squid && ls -ld /var/log/squid && touch /var/log/squid/test-root.txt && ls -l /var/log/squid/'

echo ""
echo "Files created with root entrypoint:"
ls -l "$TEST_DIR/logs/"

# Clean up for next test
rm -f "$TEST_DIR/logs/"*

# Test 2: Run squid as proxy user directly (proposed behavior)
echo ""
echo "Test 2: Running as proxy user directly (no root, no chown)..."
docker run --rm \
  -v "$TEST_DIR/squid.conf:/etc/squid/squid.conf:ro" \
  -v "$TEST_DIR/logs:/var/log/squid:rw" \
  --user proxy:proxy \
  --entrypoint /bin/bash \
  ubuntu/squid:latest \
  -c 'id && ls -ld /var/log/squid && touch /var/log/squid/test-nonroot.txt && ls -l /var/log/squid/' || {
    echo "ERROR: Failed to write as proxy user"
    echo "Directory permissions on host:"
    ls -ld "$TEST_DIR/logs/"
    exit 1
  }

echo ""
echo "Files created with proxy user (no root):"
ls -l "$TEST_DIR/logs/"

echo ""
echo "SUCCESS: Squid can write logs as non-root user without chown!"

# Cleanup
rm -rf "$TEST_DIR"
