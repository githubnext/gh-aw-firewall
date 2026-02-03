#!/bin/bash
set -e

echo "=== AWF Chroot Feature Smoke Test ==="
echo ""

AWF="/usr/local/bin/awf"

# Core functionality
echo -n "1. Python available: "
sudo $AWF --enable-chroot --allow-domains localhost -- python3 --version 2>&1 | grep "Python" | head -1

echo -n "2. Node available: "
sudo $AWF --enable-chroot --allow-domains localhost -- node --version 2>&1 | grep -E "^v[0-9]" | head -1

echo -n "3. Network firewall works: "
RESULT=$(sudo $AWF --enable-chroot --allow-domains api.github.com -- curl -s https://api.github.com/zen 2>&1 | grep -v "^\[" | grep -v Container | grep -v Process | grep -v entrypoint | grep -v iptables | grep -v "^$" | grep -v "Chain" | grep -v "pkts" | grep -v RETURN | grep -v DNAT | head -1)
if [ -n "$RESULT" ]; then
    echo "PASS (got: $RESULT)"
else
    echo "FAIL"
    exit 1
fi

echo -n "4. Docker socket hidden: "
SOCKET_CHECK=$(sudo $AWF --enable-chroot --allow-domains localhost -- ls -la /var/run/docker.sock 2>&1 | grep "1, 3" || true)
if [ -n "$SOCKET_CHECK" ]; then
    echo "PASS (mapped to /dev/null)"
else
    echo "FAIL"
    exit 1
fi

echo -n "5. iptables blocked: "
IPTABLES_CHECK=$(sudo $AWF --enable-chroot --allow-domains localhost -- iptables -L 2>&1 | grep -E "Permission denied|not permitted" || true)
if [ -n "$IPTABLES_CHECK" ]; then
    echo "PASS"
else
    echo "FAIL"
    exit 1
fi

echo -n "6. Read-only /usr: "
READONLY_CHECK=$(sudo $AWF --enable-chroot --allow-domains localhost -- touch /usr/test 2>&1 | grep "Read-only" || true)
if [ -n "$READONLY_CHECK" ]; then
    echo "PASS"
else
    echo "FAIL"
    exit 1
fi

echo -n "7. Writable /tmp: "
TMP_CHECK=$(sudo $AWF --enable-chroot --allow-domains localhost -- bash -c "echo test > /tmp/awf-smoke-test && cat /tmp/awf-smoke-test && rm /tmp/awf-smoke-test" 2>&1 | grep "^test$" || true)
if [ "$TMP_CHECK" = "test" ]; then
    echo "PASS"
else
    echo "FAIL"
    exit 1
fi

echo -n "8. Blocked domain denied: "
BLOCKED_CHECK=$(sudo $AWF --enable-chroot --allow-domains api.github.com -- curl -s --connect-timeout 5 https://example.com 2>&1 | grep -E "403|TCP_DENIED|Firewall blocked" || true)
if [ -n "$BLOCKED_CHECK" ]; then
    echo "PASS"
else
    echo "FAIL"
    exit 1
fi

echo -n "9. Exit code propagation: "
sudo $AWF --enable-chroot --allow-domains localhost -- false 2>&1 > /dev/null || EXIT_CODE=$?
if [ "$EXIT_CODE" = "1" ]; then
    echo "PASS"
else
    echo "FAIL (got $EXIT_CODE)"
    exit 1
fi

echo -n "10. User identity preserved: "
USER_CHECK=$(sudo $AWF --enable-chroot --allow-domains localhost -- whoami 2>&1 | grep -E "^[a-z][a-z0-9_-]*$" | head -1)
if [ "$USER_CHECK" != "root" ] && [ -n "$USER_CHECK" ]; then
    echo "PASS (user: $USER_CHECK)"
else
    echo "FAIL"
    exit 1
fi

echo ""
echo "=== All smoke tests passed! ==="
