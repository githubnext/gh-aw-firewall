---
title: Server-Client Communication
description: Run servers inside the firewall and connect from outside, or connect to external servers from inside the firewall container.
---

Learn how to run servers inside the firewall container and connect to them from the host, or connect to servers running on the host from inside the firewall. This guide covers HTTP, HTTPS, and gRPC servers with practical examples.

## Understanding Network Architecture

The firewall uses a Docker bridge network (`awf-net`) with a dedicated subnet. By default:

- **Squid proxy container**: `172.30.0.10:3128`
- **Agent container**: `172.30.0.20`
- **Network**: `172.30.0.0/24` subnet

The agent container has:
- Full filesystem access (host mounted at `/host` and `~`)
- Docker socket access for Docker-in-Docker
- iptables NAT rules redirecting HTTP/HTTPS traffic to Squid proxy
- Localhost traffic exemption (for stdio MCP servers)

## Scenario 1: Server Inside Firewall, Client on Host

Run a server inside the firewall container and connect to it from your host machine.

### Use Case

Testing MCP servers, debugging network services, or running sandboxed web applications that you want to access from your browser or development tools.

### HTTP Server Example

#### Simple Node.js HTTP Server

Create a simple HTTP server script:

```javascript
// server.js
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    message: 'Hello from inside the firewall!',
    url: req.url,
    timestamp: new Date().toISOString()
  }));
});

const PORT = 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}/`);
});
```

Run the server inside the firewall and access it from the host:

```bash
# Terminal 1: Start the server inside firewall (keep containers running)
sudo awf \
  --allow-domains registry.npmjs.org \
  --keep-containers \
  -- node /path/to/server.js

# Terminal 2: Find the container's IP address
docker inspect awf-agent --format='{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
# Output: 172.30.0.20

# Terminal 3: Connect from host
curl http://172.30.0.20:8080
# Output: {"message":"Hello from inside the firewall!","url":"/","timestamp":"2024-12-22T21:00:00.000Z"}
```

:::tip[Container IP Address]
The agent container always has IP `172.30.0.20` by default. Use this IP to connect from your host machine.
:::

#### Python HTTP Server

For quick testing, use Python's built-in HTTP server:

```bash
# Start a file server inside the firewall
sudo awf \
  --allow-domains example.com \
  --keep-containers \
  -- python3 -m http.server 8000 --bind 0.0.0.0

# Connect from host (in another terminal)
curl http://172.30.0.20:8000
```

### HTTPS Server Example

For HTTPS, you need TLS certificates. Here's a complete example with self-signed certificates:

#### Generate Self-Signed Certificate

```bash
# Create certificates directory
mkdir -p /tmp/certs

# Generate self-signed certificate
openssl req -x509 -newkey rsa:4096 \
  -keyout /tmp/certs/key.pem \
  -out /tmp/certs/cert.pem \
  -days 365 -nodes \
  -subj "/CN=localhost"
```

#### Node.js HTTPS Server

```javascript
// https-server.js
const https = require('https');
const fs = require('fs');

const options = {
  key: fs.readFileSync('/tmp/certs/key.pem'),
  cert: fs.readFileSync('/tmp/certs/cert.pem')
};

const server = https.createServer(options, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    message: 'Secure connection from inside the firewall!',
    protocol: 'HTTPS',
    url: req.url
  }));
});

const PORT = 8443;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTPS server running at https://0.0.0.0:${PORT}/`);
});
```

Run the HTTPS server:

```bash
# Start HTTPS server inside firewall
sudo awf \
  --allow-domains registry.npmjs.org \
  --keep-containers \
  -v /tmp/certs:/tmp/certs:ro \
  -- node /path/to/https-server.js

# Connect from host (ignore self-signed certificate warning)
curl --insecure https://172.30.0.20:8443
```

### gRPC Server Example

gRPC uses HTTP/2 and requires protocol buffers. Here's a minimal example:

#### Protocol Buffer Definition

```protobuf
// greeter.proto
syntax = "proto3";

package greeter;

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply) {}
}

message HelloRequest {
  string name = 1;
}

message HelloReply {
  string message = 1;
}
```

#### Node.js gRPC Server

```javascript
// grpc-server.js
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const PROTO_PATH = './greeter.proto';
const packageDefinition = protoLoader.loadSync(PROTO_PATH);
const greeterProto = grpc.loadPackageDefinition(packageDefinition).greeter;

function sayHello(call, callback) {
  callback(null, {
    message: `Hello from firewall, ${call.request.name}!`
  });
}

function main() {
  const server = new grpc.Server();
  server.addService(greeterProto.Greeter.service, { sayHello });
  server.bindAsync(
    '0.0.0.0:50051',
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        console.error('Failed to bind:', err);
        return;
      }
      console.log(`gRPC server running on port ${port}`);
      server.start();
    }
  );
}

main();
```

Run the gRPC server:

```bash
# Install dependencies first
npm install @grpc/grpc-js @grpc/proto-loader

# Start gRPC server inside firewall
sudo awf \
  --allow-domains registry.npmjs.org \
  --keep-containers \
  -- node /path/to/grpc-server.js

# In another terminal, create a client to test
# (Client code would use grpc.loadPackageDefinition and connect to 172.30.0.20:50051)
```

:::note[gRPC and HTTP/2]
gRPC uses HTTP/2, which the firewall treats as regular HTTP/HTTPS traffic. The Squid proxy passes through CONNECT requests for gRPC over TLS.
:::

### Debugging Connection Issues

If you can't connect to the server from the host:

1. **Verify the server is listening on `0.0.0.0`**, not `localhost` or `127.0.0.1`:
   ```bash
   # Check listening ports inside container
   docker exec awf-agent netstat -tlnp
   ```

2. **Verify the container is running**:
   ```bash
   docker ps | grep awf-agent
   ```

3. **Check the container's IP address**:
   ```bash
   docker inspect awf-agent --format='{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
   ```

4. **Test connectivity from host to container**:
   ```bash
   # Ping the container
   ping -c 3 172.30.0.20
   
   # Check if port is reachable
   nc -zv 172.30.0.20 8080
   ```

5. **Check firewall rules on host**:
   ```bash
   # Ensure host firewall allows connections to Docker networks
   sudo iptables -L DOCKER-USER -n -v
   ```

## Scenario 2: Server on Host, Client Inside Firewall

Connect to servers running on your host machine from inside the firewall container.

### Use Case

Accessing local development servers, database servers, or mock API servers from agents running inside the firewall.

### Accessing Host Services

From inside the container, the host machine is accessible at the gateway IP address of the Docker network.

#### Find Host Gateway IP

```bash
# Find the gateway IP (host machine)
docker network inspect awf-net --format='{{range .IPAM.Config}}{{.Gateway}}{{end}}'
# Output: 172.30.0.1
```

The host is typically accessible at `172.30.0.1` from the container.

:::tip[Host Gateway]
Docker containers can reach the host machine via the bridge network's gateway IP (usually `172.30.0.1`).
:::

### HTTP Server on Host Example

#### Start Server on Host

```bash
# Terminal 1: Start a simple HTTP server on host
python3 -m http.server 9000 --bind 0.0.0.0
```

#### Access from Inside Firewall

```bash
# Terminal 2: Access the host server from inside the firewall
sudo awf \
  --allow-domains example.com \
  -- curl http://172.30.0.1:9000

# Or use host.docker.internal (on Docker Desktop)
sudo awf \
  --allow-domains example.com \
  -- curl http://host.docker.internal:9000
```

:::caution[Domain Whitelisting Not Applied]
When connecting to IP addresses (like `172.30.0.1`), the Squid proxy's domain-based filtering is bypassed. Only domain-based connections go through Squid for filtering.
:::

### Database Server Example

Access a PostgreSQL database running on the host:

```bash
# Host: Start PostgreSQL (bound to all interfaces)
# Edit /etc/postgresql/.../postgresql.conf:
#   listen_addresses = '0.0.0.0'
# Edit /etc/postgresql/.../pg_hba.conf:
#   host all all 172.30.0.0/24 md5

# Inside firewall: Connect to database
sudo awf \
  --allow-domains example.com \
  -- psql -h 172.30.0.1 -U postgres -d mydb

# Or use a database client library from code
sudo awf \
  --allow-domains example.com \
  -- node -e "const { Client } = require('pg'); \
    const client = new Client({host: '172.30.0.1', user: 'postgres', database: 'mydb'}); \
    client.connect().then(() => console.log('Connected!')).catch(console.error);"
```

### Mock API Server Example

Use a mock API server on the host for testing:

```javascript
// host-api-server.js (running on host)
const express = require('express');
const app = express();

app.use(express.json());

app.get('/api/users', (req, res) => {
  res.json([
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' }
  ]);
});

app.post('/api/users', (req, res) => {
  res.status(201).json({
    id: 3,
    ...req.body
  });
});

app.listen(3000, '0.0.0.0', () => {
  console.log('Mock API server running on http://0.0.0.0:3000');
});
```

Access the mock API from inside the firewall:

```bash
# Start mock API on host
node host-api-server.js &

# Test from inside firewall
sudo awf \
  --allow-domains registry.npmjs.org \
  -- bash -c "curl http://172.30.0.1:3000/api/users && \
    curl -X POST http://172.30.0.1:3000/api/users \
      -H 'Content-Type: application/json' \
      -d '{\"name\":\"Charlie\"}'"
```

### gRPC Server on Host Example

```javascript
// host-grpc-server.js (running on host)
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const PROTO_PATH = './greeter.proto';
const packageDefinition = protoLoader.loadSync(PROTO_PATH);
const greeterProto = grpc.loadPackageDefinition(packageDefinition).greeter;

function sayHello(call, callback) {
  callback(null, { message: `Hello from host, ${call.request.name}!` });
}

function main() {
  const server = new grpc.Server();
  server.addService(greeterProto.Greeter.service, { sayHello });
  server.bindAsync(
    '0.0.0.0:50051',  // Bind to all interfaces
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        console.error('Failed to bind:', err);
        return;
      }
      console.log(`gRPC server running on port ${port}`);
      server.start();
    }
  );
}

main();
```

Access from inside firewall:

```javascript
// grpc-client.js (runs inside firewall)
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const PROTO_PATH = './greeter.proto';
const packageDefinition = protoLoader.loadSync(PROTO_PATH);
const greeterProto = grpc.loadPackageDefinition(packageDefinition).greeter;

// Connect to host gRPC server
const client = new greeterProto.Greeter(
  '172.30.0.1:50051',
  grpc.credentials.createInsecure()
);

client.sayHello({ name: 'Container' }, (err, response) => {
  if (err) {
    console.error('Error:', err);
  } else {
    console.log('Response:', response.message);
  }
});
```

Run the client:

```bash
sudo awf \
  --allow-domains registry.npmjs.org \
  -- node /path/to/grpc-client.js
```

## Advanced Patterns

### Bidirectional Communication

Run both server and client inside the firewall, communicating with each other:

```bash
# Start server in background
sudo awf \
  --allow-domains example.com \
  --keep-containers \
  -- bash -c "node server.js &"

# In the same container, run client
docker exec awf-agent curl http://localhost:8080
```

### Multi-Container Setup

Use Docker Compose to orchestrate multiple services:

```yaml
# custom-compose.yml
version: '3.8'
services:
  api:
    image: myapi:latest
    networks:
      - awf-net
    ports:
      - "3000:3000"
  
  database:
    image: postgres:15
    networks:
      - awf-net
    environment:
      POSTGRES_PASSWORD: secret

networks:
  awf-net:
    external: true
```

Then run your agent inside the firewall:

```bash
# Start additional services
docker-compose -f custom-compose.yml up -d

# Run agent that connects to these services
sudo awf \
  --allow-domains github.com \
  -- bash -c "curl http://api:3000/healthz && \
    psql -h database -U postgres -c 'SELECT 1'"
```

## Protocol-Specific Considerations

### HTTP and HTTPS

- **HTTP (port 80)**: Redirected through Squid proxy, domain filtering applied
- **HTTPS (port 443)**: Uses CONNECT tunneling through Squid, SNI-based filtering
- **Custom ports**: Not redirected through Squid, direct connection (no domain filtering)

```bash
# Standard HTTP/HTTPS - goes through Squid
sudo awf --allow-domains github.com -- curl https://api.github.com

# Custom port - bypasses Squid (direct connection)
sudo awf --allow-domains github.com -- curl http://api.github.com:8080
```

:::note[Custom Ports]
Connections to non-standard ports (not 80 or 443) bypass the Squid proxy and are not subject to domain filtering. Use custom ports only when you trust the destination.
:::

### gRPC

gRPC typically uses:
- **HTTP/2** over port 443 (secure gRPC)
- **HTTP/2** over custom ports (insecure gRPC)

The firewall handles gRPC traffic as follows:
- **gRPC over port 443**: Tunneled through Squid via CONNECT, domain filtering applied
- **gRPC over custom ports**: Direct connection, no domain filtering

```bash
# Secure gRPC (port 443) - domain filtering applied
sudo awf --allow-domains grpc.example.com -- grpcurl grpc.example.com:443 list

# Insecure gRPC (custom port) - bypasses filtering
sudo awf --allow-domains example.com -- grpcurl -plaintext localhost:50051 list
```

### WebSockets

WebSocket connections (ws:// and wss://) are handled similarly:
- **ws:// (port 80)**: Redirected through Squid
- **wss:// (port 443)**: Tunneled through Squid via CONNECT
- **Custom ports**: Direct connection

```bash
# WebSocket over standard port - domain filtering applied
sudo awf --allow-domains socketserver.com -- wscat -c wss://socketserver.com/socket

# WebSocket over custom port - bypasses filtering  
sudo awf --allow-domains socketserver.com -- wscat -c ws://localhost:8080/socket
```

## Troubleshooting

### Server Not Reachable from Host

**Symptom**: Can't connect to server inside container from host machine.

**Solutions**:

1. **Ensure server binds to `0.0.0.0`**, not `localhost`:
   ```javascript
   // ✗ Wrong - only accessible from inside container
   server.listen(8080, 'localhost');
   
   // ✓ Correct - accessible from host
   server.listen(8080, '0.0.0.0');
   ```

2. **Use `--keep-containers` flag** to keep container running:
   ```bash
   sudo awf --allow-domains example.com --keep-containers -- node server.js
   ```

3. **Check container is running**:
   ```bash
   docker ps | grep awf-agent
   ```

4. **Verify port is listening inside container**:
   ```bash
   docker exec awf-agent netstat -tlnp | grep 8080
   ```

### Can't Connect to Host from Container

**Symptom**: Connection refused when trying to reach host services from container.

**Solutions**:

1. **Ensure host service binds to `0.0.0.0`**, not `127.0.0.1`:
   ```python
   # ✗ Wrong - not accessible from containers
   app.run(host='127.0.0.1', port=5000)
   
   # ✓ Correct - accessible from containers
   app.run(host='0.0.0.0', port=5000)
   ```

2. **Use correct gateway IP** (`172.30.0.1`):
   ```bash
   # Find gateway IP
   docker network inspect awf-net --format='{{range .IPAM.Config}}{{.Gateway}}{{end}}'
   ```

3. **Check host firewall** allows Docker network:
   ```bash
   # View Docker firewall rules
   sudo iptables -L DOCKER-USER -n -v
   ```

4. **On Docker Desktop, use `host.docker.internal`**:
   ```bash
   sudo awf --allow-domains example.com -- curl http://host.docker.internal:8080
   ```

### Domain Filtering Not Applied

**Symptom**: Connections to blocked domains succeed when using IP addresses or custom ports.

**Explanation**: The Squid proxy only filters traffic on standard HTTP (80) and HTTPS (443) ports. Connections to:
- IP addresses directly
- Custom ports (e.g., 8080, 3000, 50051)
- Localhost/127.0.0.1

These bypass the Squid proxy and domain filtering.

**Solutions**:

1. **Use domain names on standard ports** when filtering is required:
   ```bash
   # ✓ Filtered through Squid
   sudo awf --allow-domains api.github.com -- curl https://api.github.com/zen
   
   # ✗ Bypasses Squid filtering
   sudo awf --allow-domains api.github.com -- curl https://api.github.com:8443/zen
   ```

2. **Accept the limitation** for custom ports - only use them with trusted destinations

3. **For stricter filtering**, use additional iptables rules (advanced, not covered here)

### HTTPS Certificate Errors

**Symptom**: SSL/TLS certificate verification errors when connecting to HTTPS servers.

**Solutions**:

1. **For self-signed certificates**, disable verification (development only):
   ```bash
   # curl
   curl --insecure https://172.30.0.20:8443
   
   # Node.js
   NODE_TLS_REJECT_UNAUTHORIZED=0 node client.js
   
   # Python
   python -c "import requests; requests.get('https://172.30.0.20:8443', verify=False)"
   ```

2. **For production**, use proper certificates:
   - Get a certificate from a trusted CA (Let's Encrypt, DigiCert, etc.)
   - Or add your CA certificate to the container's trust store

3. **Pass custom CA bundle**:
   ```bash
   sudo awf \
     --allow-domains example.com \
     -v /path/to/ca-bundle.crt:/etc/ssl/certs/ca-certificates.crt:ro \
     -- curl https://yourserver.com
   ```

### gRPC Connection Issues

**Symptom**: gRPC calls fail with "UNAVAILABLE" or "DEADLINE_EXCEEDED" errors.

**Solutions**:

1. **Check server is using `0.0.0.0` binding**:
   ```javascript
   // ✓ Correct
   server.bindAsync('0.0.0.0:50051', ...);
   
   // ✗ Wrong
   server.bindAsync('localhost:50051', ...);
   ```

2. **Verify HTTP/2 support** in your client:
   ```bash
   # Test with grpcurl
   grpcurl -plaintext 172.30.0.20:50051 list
   ```

3. **For gRPC over TLS**, ensure certificates are valid:
   ```javascript
   // Server
   const credentials = grpc.ServerCredentials.createSsl(
     fs.readFileSync('ca.crt'),
     [{
       cert_chain: fs.readFileSync('server.crt'),
       private_key: fs.readFileSync('server.key')
     }]
   );
   ```

4. **Check connectivity**:
   ```bash
   # Test basic TCP connection
   nc -zv 172.30.0.20 50051
   ```

## See Also

- [CLI Reference](/gh-aw-firewall/reference/cli-reference) - Port mapping and volume mount options
- [Domain Filtering](/gh-aw-firewall/guides/domain-filtering) - Understanding domain allowlists
- [Security Architecture](/gh-aw-firewall/reference/security-architecture) - Network isolation and traffic routing
- [Architecture Documentation](https://github.com/githubnext/gh-aw-firewall/blob/main/docs/architecture.md) - Detailed container networking
