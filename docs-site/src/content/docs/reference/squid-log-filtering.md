---
title: Squid Log Filtering
description: Quick reference for analyzing Squid proxy logs
---

## Log Location

```bash
# After awf execution, logs are preserved at:
/tmp/squid-logs-<timestamp>/access.log

# Find the latest log directory
ls -lt /tmp/squid-logs-* | head -1
```

## Essential Filters

### Show Only Blocked Requests

```bash
sudo grep "TCP_DENIED" /tmp/squid-logs-*/access.log
```

### Show Only Allowed Requests

```bash
sudo grep "TCP_TUNNEL\|TCP_MISS" /tmp/squid-logs-*/access.log
```

### Extract Blocked Domains

```bash
sudo grep "TCP_DENIED" /tmp/squid-logs-*/access.log | awk '{print $3}' | sort -u
```

### Count Blocked Attempts by Domain

```bash
sudo grep "TCP_DENIED" /tmp/squid-logs-*/access.log | awk '{print $3}' | sort | uniq -c | sort -rn
```

## Log Format

```
<timestamp> <client-ip>:<port> <domain> <dest-ip>:<port> <protocol> <method> <status> <decision> <url> <user-agent>
```

**Example:**
```
1701234567.890 172.30.0.20:54321 api.github.com 140.82.121.6:443 HTTP/2.0 CONNECT 200 TCP_TUNNEL:HIER_DIRECT https://api.github.com "curl/7.68.0"
```

## Decision Codes

| Code | Meaning | Action |
|------|---------|--------|
| `TCP_TUNNEL:HIER_DIRECT` | HTTPS tunneled | Allowed ✓ |
| `TCP_DENIED:HIER_NONE` | Domain blocked | Denied ✗ |
| `TCP_MISS:HIER_DIRECT` | HTTP direct | Allowed ✓ |

## Advanced Queries

### Filter by Specific Domain

```bash
sudo grep "github.com" /tmp/squid-logs-*/access.log
```

### Show Requests in Time Range

```bash
# Convert timestamp to human-readable
sudo awk '{print strftime("%Y-%m-%d %H:%M:%S", $1), $0}' /tmp/squid-logs-*/access.log
```

### Extract User Agents

```bash
sudo grep "TCP_DENIED" /tmp/squid-logs-*/access.log | grep -oP '"[^"]+"$' | sort -u
```

### Group by Status Code

```bash
sudo awk '{print $7}' /tmp/squid-logs-*/access.log | sort | uniq -c
```

## Debugging Workflow

1. **Run command with logging:**
   ```bash
   sudo awf --allow-domains github.com -- curl https://api.github.com
   ```

2. **Check for blocked domains:**
   ```bash
   sudo grep "TCP_DENIED" /tmp/squid-logs-*/access.log
   ```

3. **Add missing domains:**
   ```bash
   sudo awf --allow-domains github.com,<missing-domain> -- curl ...
   ```

## Log Permissions

Squid logs are owned by the `proxy` user from the container. Use `sudo` to view:

```bash
sudo cat /tmp/squid-logs-*/access.log
sudo less /tmp/squid-logs-*/access.log
```

## Cleanup Old Logs

```bash
# Remove logs older than 7 days
find /tmp -name "squid-logs-*" -type d -mtime +7 -exec sudo rm -rf {} +
```
