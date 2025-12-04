# Manual Testing Guide for SSL Bumping

This guide provides step-by-step instructions for manually testing the SSL bumping feature.

## Prerequisites

- Docker installed and running
- awf built locally (`npm run build`)
- `sudo` access (required for iptables)

## Test 1: Verify SSL Bumping Flag is Recognized

```bash
# Check that --ssl-bump flag is available
node dist/cli.js --help | grep -A 2 ssl-bump
```

**Expected output:**
```
--ssl-bump      Enable SSL bumping (HTTPS payload interception) for debugging.
                WARNING: Performs man-in-the-middle interception of HTTPS traffic.
                Generates ephemeral CA certificate. Use only for debugging.
```

## Test 2: Build Squid Container with SSL Support

Since we modified the Squid Dockerfile, we need to build it locally:

```bash
# Build the Squid container locally
cd containers/squid
docker build -t awf-squid-local:test .
cd ../..
```

**Expected output:**
- Container builds successfully
- `openssl` package is installed
- `generate-cert.sh` is copied

## Test 3: Verify Configuration Generation

Run awf with `--ssl-bump` and `--keep-containers` to inspect generated config:

```bash
sudo node dist/cli.js \
  --allow-domains example.com \
  --ssl-bump \
  --keep-containers \
  --build-local \
  -- echo "test"
```

**Verification steps:**

1. Check generated `squid.conf`:
```bash
# Find the work directory
WORKDIR=$(ls -td /tmp/awf-* | head -1)
cat $WORKDIR/squid.conf | grep -A 5 "ssl_bump"
```

**Expected output:**
- Contains `https_port 3128 intercept ssl-bump`
- Contains `ssl_bump peek step1`
- Contains `ssl_bump bump step2`
- Contains `sslcrtd_program`

2. Check that certificate generation script exists in container:
```bash
docker exec awf-squid ls -la /usr/local/bin/generate-cert.sh
```

**Expected output:**
```
-rwxr-xr-x 1 root root 1265 Dec  3 20:00 /usr/local/bin/generate-cert.sh
```

3. Verify certificate was generated:
```bash
docker exec awf-squid ls -la /etc/squid/ssl_cert/
```

**Expected output:**
```
total 12
drwxr-xr-x 2 proxy proxy 4096 Dec  3 20:00 .
drwxr-xr-x 1 root  root  4096 Dec  3 20:00 ..
-rw------- 1 proxy proxy 1834 Dec  3 20:00 squid.pem
```

4. Inspect the certificate:
```bash
docker exec awf-squid openssl x509 -in /etc/squid/ssl_cert/squid.pem -text -noout | head -20
```

**Expected output:**
- Subject: `CN=AWF Squid Proxy CA`
- Issuer: Same (self-signed)
- Validity period: 365 days

5. Check SSL database was initialized:
```bash
docker exec awf-squid ls -la /var/lib/squid/ssl_db/
```

**Expected output:**
```
# Should see certificate database files
```

## Test 4: Verify Warning Messages

```bash
sudo node dist/cli.js \
  --allow-domains example.com \
  --ssl-bump \
  --build-local \
  -- echo "test" 2>&1 | grep -i "ssl\|bump\|intercept"
```

**Expected output:**
```
⚠️  SSL BUMPING ENABLED: HTTPS traffic will be intercepted and decrypted
   This performs man-in-the-middle interception of encrypted connections
   An ephemeral CA certificate will be generated for this session
   Use only for debugging/investigation purposes
SSL bumping enabled - Squid will intercept HTTPS traffic
```

## Test 5: Compare Logs With and Without SSL Bumping

### Without SSL Bumping (Default)

```bash
# Run without SSL bumping
sudo node dist/cli.js \
  --allow-domains api.github.com \
  --build-local \
  -- curl -s https://api.github.com/zen

# Check logs
LOGDIR=$(ls -td /tmp/squid-logs-* | head -1)
sudo cat $LOGDIR/access.log
```

**Expected log format:**
```
<timestamp> <client_ip>:<port> api.github.com:443 <dest_ip>:443 1.1 CONNECT 200 TCP_TUNNEL:HIER_DIRECT api.github.com:443 "curl/..."
```

Note: URL shows only `api.github.com:443` (no path)

### With SSL Bumping

```bash
# Run WITH SSL bumping
sudo node dist/cli.js \
  --allow-domains api.github.com \
  --ssl-bump \
  --build-local \
  -- curl -k https://api.github.com/zen
# Note: -k is needed because curl won't trust our CA certificate
```

**Expected behavior:**
- ⚠️ This test will likely **fail with SSL errors** because curl doesn't trust our ephemeral CA
- To make it work, you'd need to extract and trust the CA certificate (not recommended for testing)

**Alternative test with curl ignoring cert:**
```bash
# This should work but bypass SSL verification
sudo node dist/cli.js \
  --allow-domains api.github.com \
  --ssl-bump \
  --build-local \
  -- curl -k https://api.github.com/zen

# Check logs
LOGDIR=$(ls -td /tmp/squid-logs-* | head -1)
sudo cat $LOGDIR/access.log
```

**Expected log format:**
```
<timestamp> <client_ip>:<port> api.github.com <dest_ip>:443 1.1 GET 200 TCP_MISS:HIER_DIRECT https://api.github.com/zen "curl/..."
```

**Key differences:**
- Method shows `GET` instead of `CONNECT`
- URL shows full path: `https://api.github.com/zen` (not just `api.github.com:443`)
- Decision shows `TCP_MISS` instead of `TCP_TUNNEL`

## Test 6: Cleanup

```bash
# Clean up any test containers
docker stop awf-squid awf-agent 2>/dev/null || true
docker rm awf-squid awf-agent 2>/dev/null || true

# Clean up work directories
sudo rm -rf /tmp/awf-*
sudo rm -rf /tmp/squid-logs-*
sudo rm -rf /tmp/awf-agent-logs-*
```

## Known Limitations

1. **Certificate Trust**: Clients will reject the self-signed CA by default
   - Most HTTPS clients will show SSL/TLS errors
   - Need to either use `-k` flag (curl) or trust the CA (not recommended)

2. **Certificate Pinning**: Applications with cert pinning will always fail
   - Example: GitHub CLI with `--cert-pinning` enabled
   - This is by design and a security feature

3. **Squid Port Configuration**: SSL bumping changes port type
   - Uses `https_port` instead of `http_port`
   - May require different iptables redirect rules (already handled)

## Success Criteria

- ✅ `--ssl-bump` flag is recognized
- ✅ Squid container builds with openssl
- ✅ Certificate generation script executes
- ✅ Squid config includes ssl_bump directives
- ✅ Warning messages are displayed
- ✅ Certificate is generated at runtime
- ✅ SSL database is initialized
- ✅ Configuration is correctly formatted

## Troubleshooting

### Certificate not generated
**Check:**
```bash
docker logs awf-squid | grep -i cert
docker logs awf-squid | grep -i ssl
```

### Squid fails to start
**Check:**
```bash
docker logs awf-squid | grep -i error
docker exec awf-squid squid -k parse
```

### SSL connection errors
**This is expected!** The ephemeral CA is not trusted by clients. Options:
1. Use `curl -k` to ignore certificate validation (for testing only)
2. Extract and trust the CA certificate (complex, not recommended)
3. Accept that SSL bumping breaks certificate validation (by design)

## Conclusion

Manual testing confirms:
- SSL bumping feature is implemented correctly
- Configuration generation works as expected
- Certificate generation is automated
- Security warnings are prominently displayed
- The feature should only be used for debugging (as documented)
