# DNS-over-HTTPS (DoH)

DNS-over-HTTPS (DoH) encrypts DNS queries over HTTPS, preventing DNS MITM attacks and enhancing privacy.

## Overview

By default, the firewall uses traditional DNS over UDP to trusted servers (8.8.8.8, 8.8.4.4). While this traffic is restricted to trusted DNS servers to prevent DNS exfiltration, the queries themselves are unencrypted and could theoretically be intercepted or modified on the network path.

The `--dns-over-https` flag enables encrypted DNS queries using the DoH protocol (RFC 8484), which tunnels DNS queries over HTTPS. This provides:

- **Encryption**: DNS queries are encrypted, preventing eavesdropping
- **Integrity**: HTTPS ensures queries haven't been tampered with
- **Privacy**: ISPs and network operators cannot see which domains are being queried

## Usage

### Basic usage with default resolver

```bash
sudo awf \
  --dns-over-https \
  --allow-domains github.com,dns.google \
  -- curl https://github.com
```

> **Important**: The DoH resolver's domain (e.g., `dns.google`) must be included in `--allow-domains`.

### Custom DoH resolver

```bash
# Use Cloudflare's DoH resolver
sudo awf \
  --dns-over-https https://cloudflare-dns.com/dns-query \
  --allow-domains github.com,cloudflare-dns.com \
  -- curl https://github.com

# Use Quad9's DoH resolver
sudo awf \
  --dns-over-https https://dns.quad9.net/dns-query \
  --allow-domains github.com,dns.quad9.net \
  -- curl https://github.com
```

## Supported DoH Resolvers

| Provider   | DoH URL                                   | Domain to allow        |
|------------|-------------------------------------------|------------------------|
| Google     | `https://dns.google/dns-query` (default)  | `dns.google`           |
| Cloudflare | `https://cloudflare-dns.com/dns-query`    | `cloudflare-dns.com`   |
| Quad9      | `https://dns.quad9.net/dns-query`         | `dns.quad9.net`        |

## How It Works

When `--dns-over-https` is enabled:

1. **cloudflared proxy**: A local DoH proxy (cloudflared) starts inside the agent container, listening on `127.0.0.53:53`
2. **DNS redirection**: The container's `/etc/resolv.conf` is configured to use the local proxy
3. **iptables rules**: Traditional UDP DNS to external servers is blocked; only the local proxy and Docker's embedded DNS (for container name resolution) are allowed
4. **HTTPS tunnel**: DNS queries from cloudflared go through the Squid proxy as HTTPS traffic to the DoH resolver

### Traffic flow

```
Application DNS query (port 53)
    ↓
cloudflared local proxy (127.0.0.53:53)
    ↓
HTTPS request to DoH resolver
    ↓
Squid proxy (domain filtering)
    ↓
DoH resolver (e.g., dns.google)
    ↓
DNS response (encrypted)
```

## Security Considerations

### Benefits

- **DNS MITM protection**: Encrypted queries cannot be intercepted or modified
- **Enhanced privacy**: Network operators cannot see DNS queries
- **Integrity verification**: HTTPS ensures response authenticity

### Trade-offs

- **Slightly higher latency**: DoH adds TLS handshake overhead (typically 10-50ms)
- **DoH endpoint visibility**: While DNS queries are encrypted, traffic to the DoH resolver is visible
- **Requires DoH domain in allowlist**: The DoH resolver must be explicitly allowed

### Fallback behavior

If cloudflared fails to start (e.g., network issues), the container startup will fail with an error. This is a deliberate security decision—we don't silently fall back to unencrypted DNS.

## Troubleshooting

### DoH resolver not in allowed domains

```
Error: DoH resolver domain 'dns.google' is not in allowed domains
Add 'dns.google' to --allow-domains to enable DNS-over-HTTPS
```

**Solution**: Add the DoH resolver's domain to `--allow-domains`:

```bash
sudo awf --dns-over-https --allow-domains github.com,dns.google -- curl https://github.com
```

### cloudflared startup timeout

```
[entrypoint][ERROR] cloudflared failed to start within 10s
```

**Possible causes**:
- Network connectivity issues
- DoH resolver is blocked by upstream firewall
- Resource constraints

**Solution**: Ensure the DoH resolver is reachable and try again.

### DNS resolution fails

If DNS resolution fails with DoH enabled, check:

1. DoH resolver domain is in `--allow-domains`
2. Squid logs show HTTPS traffic to the DoH resolver being allowed
3. Container can reach the DoH resolver through the proxy

Use `--log-level debug` for detailed diagnostics:

```bash
sudo awf \
  --dns-over-https \
  --allow-domains github.com,dns.google \
  --log-level debug \
  -- nslookup github.com
```

## Combining with Other Features

### With SSL Bump

DoH can be combined with SSL Bump for complete traffic inspection:

```bash
sudo awf \
  --dns-over-https \
  --ssl-bump \
  --allow-domains github.com,dns.google \
  --allow-urls 'https://github.com/githubnext/*' \
  -- curl https://github.com
```

### With custom DNS servers (ignored when DoH is enabled)

When `--dns-over-https` is enabled, `--dns-servers` is ignored because all DNS goes through the DoH proxy.
