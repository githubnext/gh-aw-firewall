---
title: SSL Bump
description: Enable HTTPS content inspection for URL path filtering with per-session CA certificates.
---

:::note[Power-User Feature]
SSL Bump is an advanced feature that intercepts HTTPS traffic. It requires local Docker image builds and adds performance overhead. Only enable this when you need URL path filtering for HTTPS traffic. For most use cases, domain-based filtering (default mode) is sufficient.
:::

:::danger[Security Warning]
SSL Bump fundamentally changes the security model by performing HTTPS interception. **Do not use SSL Bump for:**
- Multi-tenant environments (other tenants could potentially access the CA key)
- Untrusted workloads (malicious code with container access could extract the CA key)
- Multi-user systems where `/tmp` may be readable by other users

See [Security Model](#security-model) below for details.
:::

SSL Bump enables deep inspection of HTTPS traffic, allowing URL path filtering instead of just domain-based filtering.

## Overview

By default, awf filters HTTPS traffic based on domain names using SNI (Server Name Indication). You can allow `github.com`, but cannot restrict access to specific paths like `https://github.com/githubnext/*`.

With SSL Bump enabled, the firewall generates a per-session CA certificate and intercepts HTTPS connections, enabling:

- **URL path filtering**: Restrict access to specific paths, not just domains
- **Full HTTP request inspection**: See complete URLs in logs
- **Wildcard URL patterns**: Use `*` wildcards in `--allow-urls` patterns

:::caution[HTTPS Interception]
SSL Bump intercepts and decrypts HTTPS traffic. The proxy can see full request URLs and headers. Only use this when you understand the security implications.
:::

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

| Property | Value |
|----------|-------|
| Type | Flag (boolean) |
| Default | `false` |
| Requires | N/A |

When enabled:
1. A per-session CA certificate is generated (valid for 1 day)
2. The CA is injected into the agent container's trust store
3. Squid intercepts HTTPS connections using SSL Bump
4. URL-based filtering becomes available via `--allow-urls`

### `--allow-urls <urls>`

Comma-separated list of allowed URL patterns for HTTPS traffic.

| Property | Value |
|----------|-------|
| Type | String (comma-separated) |
| Default | — |
| Requires | `--ssl-bump` flag |

**Wildcard syntax:**
- `*` matches any characters within a path segment
- Patterns must include the full URL scheme (`https://`)

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

Squid terminates the TLS connection and establishes a new encrypted connection to the destination.

## Security Model

### Threat Model Change

**SSL Bump fundamentally changes the security model.** Without SSL Bump, the firewall only sees encrypted traffic and domain names (via SNI). With SSL Bump enabled, the proxy terminates TLS connections and can see all HTTPS traffic in plaintext.

**When SSL Bump is appropriate:**
- Single-user development environments
- Controlled CI/CD pipelines where you trust the workload
- Testing and debugging URL-based access patterns

**When SSL Bump is NOT appropriate:**
- Multi-tenant environments (shared infrastructure)
- Running untrusted code or AI agents
- Multi-user systems with shared `/tmp` directories
- Production security-critical workloads

### CA Private Key Exposure Risk

The CA private key grants the ability to impersonate any HTTPS site for the duration of its validity.

| Property | Value |
|----------|-------|
| Storage Location | `/tmp/awf-<timestamp>/ssl/ca-key.pem` |
| File Permissions | `0600` (owner read/write only) |
| Validity | 1 day maximum |
| Cleanup | Deleted when session ends |

**Risk scenarios:**
1. **Multi-user systems**: Other users may read `/tmp` contents
2. **Container escape**: Attacker can access key from host filesystem
3. **Squid compromise**: Squid process has key access; vulnerabilities could expose it
4. **Incomplete cleanup**: SIGKILL may prevent cleanup

**Mitigations implemented:**
- Per-session unique CA (not shared across sessions)
- Short validity period (1 day)
- Restrictive file permissions (0600)
- Key mounted read-only into Squid container
- Container security hardening (dropped capabilities)

:::tip[Session Isolation]
Each awf execution uses a unique CA certificate. Old session certificates become useless after cleanup.
:::

### Trust Store Modification

- The session CA is injected only into the agent container's trust store
- Host system trust stores are NOT modified

### Traffic Visibility

When SSL Bump is enabled:

| What's Visible | To Whom |
|----------------|---------|
| Full URLs (including paths) | Squid proxy |
| HTTP headers | Squid proxy |
| Request/response bodies | Configurable (off by default) |

:::danger[Security Consideration]
Full HTTP request/response content is visible to the proxy when SSL Bump is enabled. Ensure you understand this before enabling for sensitive workloads.
:::

### URL Pattern Validation

To prevent security bypasses, URL patterns (`--allow-urls`) are validated:
- Must start with `https://` (no HTTP or other protocols)
- Must include a path component (e.g., `https://github.com/org/*`)
- Overly broad patterns like `https://*` are rejected
- Domain-only patterns should use `--allow-domains` instead

## Example Use Cases

### Restrict GitHub to Specific Organizations

```bash
sudo awf \
  --allow-domains github.com \
  --ssl-bump \
  --allow-urls "https://github.com/githubnext/*,https://github.com/github/*" \
  -- copilot --prompt "Clone the githubnext/copilot-workspace repo"
```

Allows access to `githubnext` and `github` organizations while blocking other repositories.

### API Endpoint Restrictions

```bash
sudo awf \
  --allow-domains api.github.com \
  --ssl-bump \
  --allow-urls "https://api.github.com/repos/githubnext/*,https://api.github.com/users/*" \
  -- curl https://api.github.com/repos/githubnext/gh-aw-firewall
```

### Debug with Verbose Logging

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

## Comparison: SNI-Only vs SSL Bump

| Feature | SNI-Only (Default) | SSL Bump |
|---------|-------------------|----------|
| Domain filtering | ✓ | ✓ |
| Path filtering | ✗ | ✓ |
| End-to-end encryption | ✓ | Modified (proxy-terminated) |
| Certificate pinning | Works | Broken |
| Performance | Faster | Slight overhead |
| Log detail | Domain:port only | Full URLs |

## Troubleshooting

### Certificate Errors

**Problem**: Agent reports certificate validation failures

**Solutions**:
```bash
# Check if CA was injected
docker exec awf-agent ls -la /usr/local/share/ca-certificates/

# Verify trust store was updated
docker exec awf-agent cat /etc/ssl/certs/ca-certificates.crt | grep -A1 "AWF Session CA"
```

:::note
Applications with certificate pinning will fail to connect when SSL Bump is enabled. Use domain-only filtering for these applications.
:::

### URL Patterns Not Matching

**Problem**: Allowed URL patterns are being blocked

```bash
# Enable debug logging
sudo awf --log-level debug --ssl-bump --allow-urls "..." -- your-command

# Check exact URL format in logs
sudo cat /tmp/squid-logs-*/access.log | grep your-domain

# Ensure patterns include scheme (https://)
# ✗ Wrong: github.com/githubnext/*
# ✓ Correct: https://github.com/githubnext/*
```

## Known Limitations

### Certificate Pinning

Applications that implement certificate pinning will fail when SSL Bump is enabled. The pinned certificate won't match the session CA's generated certificate.

**Workaround**: Use domain-only filtering without SSL Bump for these applications.

### HTTP/3 (QUIC)

SSL Bump works with HTTP/1.1 and HTTP/2. HTTP/3 (QUIC) is not currently supported.

### WebSocket Connections

WebSocket over HTTPS (`wss://`) is intercepted and filtered. The initial handshake URL is checked against `--allow-urls` patterns.

## See Also

- [CLI Reference](/gh-aw-firewall/reference/cli-reference/) - Complete command-line options
- [Security Architecture](/gh-aw-firewall/reference/security-architecture/) - How the firewall protects traffic
