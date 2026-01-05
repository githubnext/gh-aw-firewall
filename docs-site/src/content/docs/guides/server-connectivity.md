---
title: Server Connectivity
description: Connect to HTTP, HTTPS, and gRPC servers through the firewall.
---

The firewall controls **outbound** traffic from clients inside awf to external servers. This guide covers connecting to HTTP, HTTPS, and gRPC servers.

## HTTP/HTTPS servers

Clients inside awf can connect to any whitelisted domain over HTTP or HTTPS.

```bash
# Connect to HTTPS server
sudo awf --allow-domains api.example.com -- \
  curl https://api.example.com/data

# Connect to HTTP server (non-TLS)
sudo awf --allow-domains 'http://legacy.example.com' -- \
  curl http://legacy.example.com/api
```

:::tip
Use `https://` or `http://` prefix to restrict a domain to a specific protocol.
:::

## gRPC servers

gRPC connections work through the firewall when using standard ports.

### gRPC over HTTPS (port 443)

```bash
# gRPC with TLS on standard HTTPS port
sudo awf --allow-domains grpc.example.com -- \
  grpcurl grpc.example.com:443 myservice.Service/Method
```

### gRPC-web over HTTP/HTTPS

```bash
# gRPC-web uses standard HTTP/HTTPS ports
sudo awf --allow-domains api.example.com -- \
  grpcurl -plaintext api.example.com:80 myservice.Service/Method
```

:::note
The firewall only allows ports 80 (HTTP) and 443 (HTTPS). Non-standard gRPC ports like 50051 are blocked.
:::

## Server inside, client outside

To run a server inside awf that accepts external connections, use `--keep-containers` and connect via the Docker network.

```bash
# Start server inside awf (stays running)
sudo awf --allow-domains example.com --keep-containers -- \
  python3 -m http.server 8080 &

# Connect from another terminal via Docker network
docker exec awf-agent curl http://localhost:8080
```

For host-to-container connections, use Docker's network inspection:

```bash
# Get container IP
docker inspect awf-agent --format '{{.NetworkSettings.Networks.awf_net.IPAddress}}'

# Connect from host (requires access to Docker network)
curl http://<container-ip>:8080
```

:::caution
The firewall is designed for egress control. For production server hosting, consider running servers outside the firewall.
:::

## Bidirectional communication

A server that accepts requests and makes outbound calls to whitelisted domains:

```bash
# API gateway that proxies to backend
sudo awf --allow-domains backend.example.com --keep-containers -- \
  node gateway.js

# Gateway can:
# - Accept connections on its internal port
# - Make outbound requests only to backend.example.com
```

## Debugging connectivity

```bash
# Keep containers running for inspection
sudo awf --allow-domains example.com --keep-containers -- sleep 60

# Test connectivity from inside
docker exec awf-agent curl -v https://example.com

# Check Squid logs for blocked requests
sudo grep "TCP_DENIED" /tmp/squid-logs-*/access.log

# View all traffic
awf logs --format pretty
```

## See also

- [Domain Filtering](/gh-aw-firewall/guides/domain-filtering) - Allowlists, blocklists, wildcards
- [CLI Reference](/gh-aw-firewall/reference/cli-reference) - All options
