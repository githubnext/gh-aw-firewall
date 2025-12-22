#!/bin/bash
set -e

# Example: Run a Node.js HTTP server inside the firewall
# and connect to it from the host machine

echo "====================================="
echo "Server Inside Firewall Example"
echo "====================================="
echo ""
echo "This example demonstrates running an HTTP server"
echo "inside the firewall and connecting from the host."
echo ""

# Create a simple HTTP server script
SERVER_SCRIPT=$(mktemp --suffix=.js)
cat > "$SERVER_SCRIPT" << 'EOF'
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    message: 'Hello from inside the firewall!',
    url: req.url,
    timestamp: new Date().toISOString(),
    container: 'awf-agent'
  }));
});

const PORT = 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}/`);
  console.log('Press Ctrl+C to stop the server');
});

// Keep the server running
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.close(() => {
    console.log('Server stopped');
    process.exit(0);
  });
});
EOF

echo "Starting HTTP server inside firewall..."
echo "Server script: $SERVER_SCRIPT"
echo ""

# Start the server inside the firewall (background process)
sudo awf \
  --allow-domains registry.npmjs.org \
  --keep-containers \
  -- node "$SERVER_SCRIPT" &

AWF_PID=$!

# Wait for the server to start
echo "Waiting for server to start..."
sleep 5

# Get the container IP
CONTAINER_IP=$(docker inspect awf-agent --format='{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null || echo "172.30.0.20")

echo ""
echo "====================================="
echo "Server is running!"
echo "====================================="
echo ""
echo "Container IP: $CONTAINER_IP"
echo "Server URL: http://${CONTAINER_IP}:8080"
echo ""
echo "Testing connection from host..."
echo ""

# Test the connection
curl -s "http://${CONTAINER_IP}:8080" | jq '.' || curl -s "http://${CONTAINER_IP}:8080"

echo ""
echo ""
echo "====================================="
echo "You can also test manually:"
echo "  curl http://${CONTAINER_IP}:8080"
echo "  curl http://${CONTAINER_IP}:8080/api/test"
echo ""
echo "Press Ctrl+C to stop the server and clean up"
echo "====================================="

# Wait for the AWF process
wait $AWF_PID

# Cleanup
rm -f "$SERVER_SCRIPT"
echo "Cleaned up temporary files"
