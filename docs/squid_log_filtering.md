# Squid Access Log Filtering Guide

Quick reference for analyzing blocked domains in Squid access logs.

## Log Location

```bash
# After awf execution, logs are preserved at:
/tmp/squid-logs-<timestamp>/access.log

# Find the latest log directory
ls -lt /tmp/squid-logs-* | head -1
```

## Essential Filters

### 1. Show Only Blocked Requests

```bash
sudo grep "TCP_DENIED" /tmp/squid-logs-*/access.log
```

**Output format:**
```
1761332530.123 172.30.0.20:35274 malicious.com:443 0.0.0.0:0 1.1 CONNECT 403 TCP_DENIED:HIER_NONE malicious.com:443 "curl/7.81.0"
```

### 2. Extract Blocked Domain Names Only

```bash
sudo grep "TCP_DENIED" /tmp/squid-logs-*/access.log | awk '{print $3}' | sort | uniq
```

**Output:**
```
malicious.com:443
untrusted-api.example.org:443
```

### 3. Count Blocked Requests Per Domain

```bash
sudo grep "TCP_DENIED" /tmp/squid-logs-*/access.log | awk '{print $3}' | sort | uniq -c | sort -rn
```

**Output:**
```
25 malicious.com:443
10 untrusted-api.example.org:443
3 blocked-cdn.net:443
```

### 4. Show Blocked Requests with Timestamps

```bash
sudo grep "TCP_DENIED" /tmp/squid-logs-*/access.log | awk '{print strftime("%Y-%m-%d %H:%M:%S", $1), $3}'
```

**Output:**
```
2025-10-24 14:32:15 malicious.com:443
2025-10-24 14:32:20 untrusted-api.example.org:443
```

### 5. Exclude Health Check Noise

```bash
sudo grep "TCP_DENIED" /tmp/squid-logs-*/access.log | grep -v "::1.*NONE_NONE"
```

## Common Patterns

### Identify Source of Blocked Request

```bash
# Show client IP and domain for blocked requests
sudo grep "TCP_DENIED" /tmp/squid-logs-*/access.log | awk '{print "Client:", $2, "→ Blocked:", $3}'
```

**Output:**
```
Client: 172.30.0.20:35274 → Blocked: malicious.com:443
Client: 172.30.0.2:54610 → Blocked: untrusted-api.example.org:443
```

### Filter by Time Range

```bash
# Show blocked requests in last 5 minutes of log
sudo awk -v cutoff=$(date -d '5 minutes ago' +%s) '$1 > cutoff && /TCP_DENIED/' /tmp/squid-logs-*/access.log
```

### Show User-Agent for Blocked Requests

```bash
# Extract User-Agent (last field in quotes)
sudo grep "TCP_DENIED" /tmp/squid-logs-*/access.log | sed 's/.*"\(.*\)"/\1/'
```

## Decision Codes Reference

| Code | Meaning | Action |
|------|---------|--------|
| `TCP_DENIED:HIER_NONE` | Domain not in allowlist | **BLOCKED** ❌ |
| `TCP_TUNNEL:HIER_DIRECT` | Domain allowed, tunnel established | **ALLOWED** ✅ |
| `NONE_NONE:HIER_NONE` | Connection error (no HTTP headers) | **N/A** (health checks) |

## Quick Diagnostics

### 1. "Why was my command blocked?"

```bash
# Find all denied domains from last run
sudo grep "TCP_DENIED" $(ls -t /tmp/squid-logs-*/access.log | head -1) | awk '{print $3}' | sort -u
```

### 2. "Which domains should I add to allowlist?"

```bash
# Show most frequently blocked domains
sudo grep "TCP_DENIED" /tmp/squid-logs-*/access.log | awk '{print $3}' | sed 's/:443$//' | sort | uniq -c | sort -rn | head -10
```

### 3. "Is my allowlist working?"

```bash
# Compare allowed vs blocked counts
echo "Allowed: $(sudo grep -c "TCP_TUNNEL" /tmp/squid-logs-*/access.log)"
echo "Blocked: $(sudo grep -c "TCP_DENIED" /tmp/squid-logs-*/access.log)"
```

## Notes

- All commands require `sudo` because log files are owned by the `proxy` user from the container
- Use `$(ls -t /tmp/squid-logs-*/access.log | head -1)` to automatically target the latest log
- Timestamps are Unix epoch seconds (use `date -d @<timestamp>` to convert)
- Port `:443` indicates HTTPS traffic (most common)
- Client IPs: `172.30.0.20` = agent container, `172.30.0.2` = spawned containers
