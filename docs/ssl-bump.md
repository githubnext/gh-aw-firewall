# SSL Bump: HTTPS Content Inspection

> ⚠️ **Power-User Feature**: SSL Bump is an advanced feature that intercepts HTTPS traffic. It requires local Docker image builds and adds performance overhead. Only enable this when you need URL path filtering for HTTPS traffic. For most use cases, domain-based filtering (default mode) is sufficient.

SSL Bump enables deep inspection of HTTPS traffic, allowing URL path filtering instead of just domain-based filtering.

## Overview

By default, awf filters HTTPS traffic based on domain names using SNI (Server Name Indication). This means you can allow or block `github.com`, but you cannot restrict access to specific paths like `https://github.com/githubnext/*`.

With SSL Bump enabled (`--ssl-bump`), the firewall generates a per-session CA certificate and intercepts HTTPS connections. This allows:

- **URL path filtering**: Restrict access to specific paths, not just domains
- **Full HTTP request inspection**: See complete URLs in logs
- **Wildcard URL patterns**: Use `*` wildcards in `--allow-urls` patterns

## Quick Start

```bash
# Enable SSL Bump for URL path filtering
sudo awf \
  --allow-domains github.com \
  --ssl-bump \
  --allow-urls "https://github.com/githubnext/*,https://api.github.com/repos/*" \
  -- curl https://github.com/githubnext/some-repo
```

## CLI Flags

### `--ssl-bump`

Enable SSL Bump for HTTPS content inspection.

- **Type**: Flag (boolean)
- **Default**: `false`

When enabled:
1. A per-session CA certificate is generated (valid for 1 day)
2. The CA is injected into the agent container's trust store
3. Squid intercepts HTTPS connections using SSL Bump (peek, stare, bump)
4. URL-based filtering becomes available via `--allow-urls`

### `--allow-urls <urls>`

Comma-separated list of allowed URL patterns for HTTPS traffic. Requires `--ssl-bump`.

- **Type**: String (comma-separated)
- **Requires**: `--ssl-bump` flag

**Wildcard syntax:**
- `*` matches any characters within a path segment
- Patterns must include the full URL scheme (`https://`)

**Examples:**
```bash
# Allow specific repository paths
--allow-urls "https://github.com/githubnext/*"

# Allow API endpoints
--allow-urls "https://api.github.com/repos/*,https://api.github.com/users/*"

# Combine with domain allowlist
--allow-domains github.com --ssl-bump --allow-urls "https://github.com/githubnext/*"
```

## How It Works

### Without SSL Bump (Default)

```
Agent → CONNECT github.com:443 → Squid checks domain ACL → Pass/Block
                                  (SNI only, no path visibility)
```

Squid sees only the domain from the TLS ClientHello SNI extension. The URL path is encrypted and invisible.

### With SSL Bump

```
Agent → CONNECT github.com:443 → Squid intercepts TLS
      → Squid presents session CA certificate
      → Agent trusts session CA (injected into trust store)
      → Full HTTPS request visible: GET /githubnext/repo
      → Squid checks URL pattern ACL → Pass/Block
```

Squid terminates the TLS connection and establishes a new encrypted connection to the destination. This is commonly called a "man-in-the-middle" proxy, but in this case, you control both endpoints.

### Session CA Certificate Lifecycle

1. **Generation**: A unique CA key pair is generated at session start
2. **Validity**: Certificate is valid for 1 day maximum
3. **Injection**: CA certificate is added to the agent container's trust store
4. **Cleanup**: CA private key exists only in the temporary work directory
5. **Isolation**: Each awf execution uses a unique CA certificate

## Example Use Cases

### Restrict GitHub Access to Specific Organizations

```bash
sudo awf \
  --allow-domains github.com \
  --ssl-bump \
  --allow-urls "https://github.com/githubnext/*,https://github.com/github/*" \
  -- copilot --prompt "Clone the githubnext/copilot-workspace repo"
```

This allows access to repositories under `githubnext` and `github` organizations, but blocks access to other GitHub repositories.

### API Endpoint Restrictions

```bash
sudo awf \
  --allow-domains api.github.com \
  --ssl-bump \
  --allow-urls "https://api.github.com/repos/githubnext/*,https://api.github.com/users/*" \
  -- curl https://api.github.com/repos/githubnext/gh-aw-firewall
```

Allow only specific API endpoint patterns while blocking others.

### Debugging with Verbose Logging

```bash
sudo awf \
  --allow-domains github.com \
  --ssl-bump \
  --allow-urls "https://github.com/*" \
  --log-level debug \
  -- curl https://github.com/githubnext/gh-aw-firewall

# View full URL paths in Squid logs
sudo cat /tmp/squid-logs-*/access.log
```

With SSL Bump enabled, Squid logs show complete URLs, not just domain:port.

## Security Considerations

### CA Private Key Protection

- The CA private key is generated fresh for each session
- It's stored only in the temporary work directory (`/tmp/awf-<timestamp>/`)
- The key is never persisted beyond the session
- Cleanup removes the key when the session ends

### Certificate Validity

- Session CA certificates are valid for 1 day maximum
- Short validity limits the window of exposure if a key is compromised
- Each execution generates a new CA, so old certificates become useless

### Trust Store Modification

- The session CA is injected only into the agent container's trust store
- Host system trust stores are not modified
- Spawned containers inherit the modified trust store via volume mounts

### Traffic Visibility

When SSL Bump is enabled:
- Full HTTP request/response headers are visible to the proxy
- Request bodies can be logged (if configured)
- This is necessary for URL path filtering

**Warning**: SSL Bump means the proxy can see decrypted HTTPS traffic. Only use this feature when you control the environment and understand the implications.

### Comparison: SNI-Only vs SSL Bump

| Feature | SNI-Only (Default) | SSL Bump |
|---------|-------------------|----------|
| Domain filtering | ✓ | ✓ |
| Path filtering | ✗ | ✓ |
| End-to-end encryption | ✓ | Modified (proxy-terminated) |
| Certificate pinning | Works | Broken |
| Performance | Faster | Slight overhead |
| Log detail | Domain:port only | Full URLs |

## Troubleshooting

### Certificate Errors in Agent

**Problem**: Agent reports certificate validation failures

**Causes**:
1. CA not properly injected into trust store
2. Application uses certificate pinning
3. Custom CA bundle in application ignoring system trust store

**Solutions**:
```bash
# Check if CA was injected
docker exec awf-agent ls -la /usr/local/share/ca-certificates/

# Verify trust store was updated
docker exec awf-agent cat /etc/ssl/certs/ca-certificates.crt | grep -A1 "AWF Session CA"

# For Node.js apps, ensure NODE_EXTRA_CA_CERTS is not overriding
docker exec awf-agent printenv | grep -i cert
```

### URL Patterns Not Matching

**Problem**: Allowed URL patterns are being blocked

**Solutions**:
```bash
# Enable debug logging to see pattern matching
sudo awf --log-level debug --ssl-bump --allow-urls "..." -- your-command

# Check exact URL format in Squid logs
sudo cat /tmp/squid-logs-*/access.log | grep your-domain

# Ensure patterns include scheme (https://)
# ✗ Wrong: github.com/githubnext/*
# ✓ Correct: https://github.com/githubnext/*
```

### Performance Impact

SSL Bump adds overhead due to TLS termination and re-encryption. For performance-sensitive workloads:

```bash
# Use domain filtering without SSL Bump when path filtering isn't needed
sudo awf --allow-domains github.com -- your-command

# Only enable SSL Bump when you specifically need URL path filtering
sudo awf --allow-domains github.com --ssl-bump --allow-urls "..." -- your-command
```

## Limitations

### Certificate Pinning

Applications that implement certificate pinning will fail to connect when SSL Bump is enabled. The pinned certificate won't match the session CA's generated certificate.

**Affected applications may include**:
- Mobile apps (if running in container)
- Some security-focused CLI tools
- Applications with hardcoded certificate expectations

**Workaround**: Use domain-only filtering (`--allow-domains`) without SSL Bump for these applications.

### HTTP/2 and HTTP/3

SSL Bump works with HTTP/1.1 and HTTP/2 over TLS. HTTP/3 (QUIC) is not currently supported by Squid's SSL Bump implementation.

### WebSocket Connections

WebSocket connections over HTTPS (`wss://`) are intercepted and filtered the same as regular HTTPS traffic. The initial handshake URL is checked against `--allow-urls` patterns.

## Related Documentation

- [Usage Guide](usage.md) - Complete CLI reference
- [Architecture](architecture.md) - How the proxy works
- [Troubleshooting](troubleshooting.md) - Common issues and fixes
- [Logging Quick Reference](logging_quickref.md) - Viewing traffic logs
