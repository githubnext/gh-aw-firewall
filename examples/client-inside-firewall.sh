#!/bin/bash
set -e

# Example: Run an HTTP server on the host and connect to it
# from inside the firewall container

echo "====================================="
echo "Client Inside Firewall Example"
echo "====================================="
echo ""
echo "This example demonstrates connecting to a host server"
echo "from inside the firewall container."
echo ""

# Find available port
PORT=9000

# Create a simple HTTP server on the host
echo "Starting HTTP server on host at port $PORT..."

# Start Python HTTP server in background
python3 -m http.server $PORT --bind 0.0.0.0 > /tmp/host-server.log 2>&1 &
SERVER_PID=$!

# Wait for server to start
sleep 2

# Check if server started successfully
if ! kill -0 $SERVER_PID 2>/dev/null; then
  echo "Error: Failed to start HTTP server"
  exit 1
fi

echo "Host server started (PID: $SERVER_PID)"
echo ""

# Get the Docker network gateway IP
GATEWAY_IP=$(docker network inspect awf-net --format='{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null || echo "172.30.0.1")

echo "====================================="
echo "Testing connection from firewall"
echo "====================================="
echo ""
echo "Host gateway IP: $GATEWAY_IP"
echo "Server URL: http://${GATEWAY_IP}:${PORT}"
echo ""

# Test connection from inside the firewall
echo "Running curl inside firewall to connect to host server..."
echo ""

sudo awf \
  --allow-domains example.com \
  -- curl -v "http://${GATEWAY_IP}:${PORT}" 2>&1 | head -20

echo ""
echo ""
echo "====================================="
echo "Connection test completed!"
echo "====================================="
echo ""
echo "Note: Connections to IP addresses bypass domain filtering."
echo "This is expected behavior for accessing host services."
echo ""

# Cleanup
echo "Cleaning up..."
kill $SERVER_PID 2>/dev/null || true
rm -f /tmp/host-server.log

echo "Done!"
