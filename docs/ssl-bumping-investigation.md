# HTTPS Payload Interception Investigation

## Overview

This document provides the results of investigating whether the Squid proxy container can intercept HTTPS payload for logging and debugging purposes.

**Answer: YES** - Squid can intercept HTTPS payload using SSL bumping (SSL/TLS man-in-the-middle interception).

## How It Works

### Current Implementation (Without SSL Bumping)

By default, awf operates in **transparent tunnel mode**:
- Squid acts as a CONNECT tunnel for HTTPS traffic
- Only sees encrypted TLS data between client and server
- Can log: domain name (from SNI), client IP, status code (allow/deny)
- Cannot see: HTTP headers, URLs, request/response bodies inside TLS

### With SSL Bumping Enabled

When `--ssl-bump` flag is used, Squid performs **man-in-the-middle interception**:

1. **Client connects** to Squid proxy
2. **Squid peeks** at SNI during TLS handshake to identify destination
3. **Squid terminates** the client's TLS connection using a dynamically generated certificate
4. **Squid establishes** a new TLS connection to the actual destination
5. **Squid decrypts** traffic from client, inspects it, re-encrypts, and forwards to destination
6. **Full visibility** into HTTP requests/responses inside the TLS tunnel

## Usage

### Enable SSL Bumping

```bash
sudo awf \
  --allow-domains github.com \
  --ssl-bump \
  -- curl https://api.github.com/zen
```

### What You Can See With SSL Bumping

**Without SSL bumping** (default):
```
# Squid access.log
1761074374.646 172.30.0.20:39748 api.github.com:443 140.82.114.22:443 1.1 CONNECT 200 TCP_TUNNEL:HIER_DIRECT api.github.com:443 "curl/7.81.0"
```
- ✅ Domain: `api.github.com`
- ✅ Status: `200` (allowed)
- ❌ Full URL: Not visible (just `api.github.com:443`)
- ❌ HTTP headers: Not visible
- ❌ Request/response body: Not visible

**With SSL bumping** (`--ssl-bump`):
```
# Squid access.log
1761074374.646 172.30.0.20:39748 api.github.com 140.82.114.22:443 1.1 GET 200 TCP_MISS:HIER_DIRECT https://api.github.com/zen "curl/7.81.0"
```
- ✅ Domain: `api.github.com`
- ✅ Status: `200`
- ✅ Full URL: `https://api.github.com/zen` (complete path visible!)
- ✅ HTTP method: `GET`
- ✅ User-Agent: `curl/7.81.0`
- ✅ All HTTP headers can be logged (configurable)
- ✅ Request/response bodies can be logged (configurable)

## Security Implications

### ⚠️ WARNING: Use Only for Debugging

SSL bumping should **ONLY** be used for debugging and investigation purposes because:

1. **Man-in-the-Middle Attack**: Actively intercepts and decrypts encrypted traffic
2. **Certificate Trust Issues**: Requires trusting a dynamically-generated CA certificate
3. **Breaks Certificate Pinning**: Applications using cert pinning will fail or detect tampering
4. **Privacy Violations**: Exposes encrypted data in logs
5. **Security Risk**: Compromised proxy can leak sensitive data

### Certificate Handling

When SSL bumping is enabled:
- An **ephemeral CA certificate** is generated on container startup
- Certificate is stored in `/etc/squid/ssl_cert/squid.pem`
- Valid for 365 days but regenerated each run
- Certificate is **NOT trusted by clients by default** (will see SSL errors)
- When `--keep-containers` is NOT specified, certificate is deleted after execution

### Certificate Trust (For Testing Only)

To make SSL bumping work without certificate errors, you would need to:

1. **Extract the CA certificate** from the container:
   ```bash
   docker cp awf-squid:/etc/squid/ssl_cert/squid.pem /tmp/squid-ca.pem
   ```

2. **Trust the CA certificate** in your client (NOT RECOMMENDED for production):
   ```bash
   # On Linux
   sudo cp /tmp/squid-ca.pem /usr/local/share/ca-certificates/squid-ca.crt
   sudo update-ca-certificates
   
   # On macOS
   sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain /tmp/squid-ca.pem
   ```

3. **Or use curl with explicit CA**:
   ```bash
   curl --cacert /tmp/squid-ca.pem https://api.github.com/zen
   ```

**IMPORTANT**: Never trust ephemeral certificates in production. This is only for controlled debugging environments.

## Technical Implementation

### Squid Configuration

When `--ssl-bump` is enabled, the generated `squid.conf` includes:

```squid
# HTTPS interception port
https_port 3128 intercept ssl-bump \
  cert=/etc/squid/ssl_cert/squid.pem \
  key=/etc/squid/ssl_cert/squid.pem \
  generate-host-certificates=on \
  dynamic_cert_mem_cache_size=4MB

# SSL bumping rules
acl step1 at_step SslBump1
acl step2 at_step SslBump2

ssl_bump peek step1           # Peek at SNI
ssl_bump bump step2 allowed_domains  # Decrypt allowed domains
ssl_bump terminate step2      # Block denied domains

# Certificate generation
sslcrtd_program /usr/lib/squid/security_file_certgen -s /var/lib/squid/ssl_db -M 4MB
```

### Certificate Generation

The Squid container includes a certificate generation script (`generate-cert.sh`):

```bash
#!/bin/bash
# Generates ephemeral CA certificate for SSL bumping
openssl req -new -newkey rsa:2048 -sha256 -days 365 -nodes -x509 \
    -keyout /etc/squid/ssl_cert/squid.pem \
    -out /etc/squid/ssl_cert/squid.pem \
    -subj "/C=US/ST=State/L=City/O=AWF/OU=Proxy/CN=AWF Squid Proxy CA"

# Initialize SSL certificate database
/usr/lib/squid/security_file_certgen -c -s /var/lib/squid/ssl_db -M 4MB
```

The script runs automatically when Squid detects `ssl_bump` directives in the config.

## Comparison with Other Approaches

### 1. SSL Bumping (Implemented)
- ✅ Full HTTPS payload visibility
- ❌ Requires certificate trust
- ❌ Breaks cert pinning
- ⚠️ Security/privacy concerns

### 2. Peek and Splice
- ✅ Less intrusive than full bumping
- ✅ Can make routing decisions
- ❌ Limited inspection (SNI only)
- ⚠️ Still requires certificate

### 3. CONNECT Tunneling (Current Default)
- ✅ No certificate needed
- ✅ No decryption
- ✅ Minimal overhead
- ❌ Limited visibility (domain only)

## Use Cases

### When to Use SSL Bumping

✅ **Debugging HTTPS traffic issues**
- Investigating what URLs an agent is accessing
- Checking HTTP headers sent/received
- Analyzing request/response payloads

✅ **Security auditing**
- Understanding data exfiltration attempts
- Verifying proper API usage
- Analyzing MCP server communications

✅ **Development/testing**
- Troubleshooting agent behavior
- Validating domain allowlist effectiveness

### When NOT to Use SSL Bumping

❌ **Production environments**
- Privacy violations
- Security risks
- Compliance issues

❌ **With certificate-pinned applications**
- GitHub CLI with cert pinning
- Mobile apps with pinning
- Security-hardened tools

❌ **When handling sensitive data**
- Credentials in requests
- PII in payloads
- Encrypted user data

## Conclusion

**Yes, the Squid proxy container can intercept HTTPS payload** using SSL bumping. This feature is now available via the `--ssl-bump` flag.

### Summary

- ✅ Implemented as optional feature (`--ssl-bump` flag)
- ✅ Generates ephemeral CA certificate automatically
- ✅ Provides full HTTPS payload visibility in logs
- ⚠️ Should only be used for debugging/investigation
- ⚠️ Clear warnings displayed when enabled
- ⚠️ Certificate trust required for clean operation

### Recommendation

Use SSL bumping **sparingly and only in controlled debugging environments**. The default CONNECT tunneling mode provides adequate security and privacy for production use while still offering domain-level filtering.
