---
title: Logging
description: Comprehensive logging documentation
---

## Overview

The firewall provides comprehensive logging at two levels:
1. **Squid Proxy Logs (L7)** - All HTTP/HTTPS traffic
2. **Container Logs** - Runtime information and diagnostics

## Log Types

### Squid Access Logs

**Location:** `/tmp/squid-logs-<timestamp>/access.log`

**Format:**
```
<timestamp> <client-ip>:<port> <domain> <dest-ip>:<port> <protocol> <method> <status> <decision> <url> <user-agent>
```

**Example:**
```
1234567890.123 172.30.0.20:45678 api.github.com 140.82.118.6:443 HTTP/2.0 CONNECT 200 TCP_TUNNEL:HIER_DIRECT https://api.github.com "curl/7.68.0"
```

**Decision Codes:**
- `TCP_TUNNEL:HIER_DIRECT` - Allowed (HTTPS tunneled to destination)
- `TCP_DENIED:HIER_NONE` - Blocked (domain not whitelisted)
- `TCP_MISS:HIER_DIRECT` - Allowed (HTTP direct connection)

### Copilot Logs

**Location:** `/tmp/copilot-logs-<timestamp>/`

Contains Copilot CLI debug output and session information.

**View logs:**
```bash
cat /tmp/copilot-logs-<timestamp>/*.log
```

### Container Logs

**Real-time viewing:**
```bash
docker logs awf-copilot
docker logs awf-squid
```

## Viewing Logs

### During Execution

Logs are streamed in real-time:

```bash
sudo awf \
  --allow-domains github.com \
  --log-level debug \
  -- your-command
# Logs appear immediately as the command runs
```

### After Execution

Logs are automatically preserved:

```bash
# Copilot logs
cat /tmp/copilot-logs-*/session.log

# Squid logs (requires sudo)
sudo cat /tmp/squid-logs-*/access.log
```

### With --keep-containers

Logs remain in work directory:

```bash
sudo awf --keep-containers --allow-domains github.com -- your-command

# Logs available at:
# /tmp/awf-<timestamp>/copilot-logs/
# /tmp/awf-<timestamp>/squid-logs/
```

## Log Analysis

### Find Blocked Domains

```bash
sudo grep "TCP_DENIED" /tmp/squid-logs-*/access.log | awk '{print $3}' | sort -u
```

### Count Blocked Attempts

```bash
sudo grep "TCP_DENIED" /tmp/squid-logs-*/access.log | awk '{print $3}' | sort | uniq -c | sort -rn
```

### View Allowed Traffic

```bash
sudo grep "TCP_TUNNEL\|TCP_MISS" /tmp/squid-logs-*/access.log
```

### Filter by Domain

```bash
sudo grep "github.com" /tmp/squid-logs-*/access.log
```

## Debug Logging

Enable detailed logging:

```bash
sudo awf \
  --allow-domains github.com \
  --log-level debug \
  -- your-command
```

**Debug output includes:**
- Configuration details
- Squid config generation
- Docker container startup
- iptables rules being applied
- Network diagnostics
- Proxy traffic details

## Log Preservation

**Automatic preservation:**
- Logs moved to `/tmp/*-logs-<timestamp>/` before cleanup
- Empty directories not preserved
- Only logs that exist are saved

**Confirmation messages:**
```
[INFO] Copilot logs preserved at: /tmp/copilot-logs-1234567890
[INFO] Squid logs preserved at: /tmp/squid-logs-1234567890
```

## Troubleshooting with Logs

### Domain Blocking Issues

1. Check Squid logs for blocked domains:
   ```bash
   sudo grep "TCP_DENIED" /tmp/squid-logs-*/access.log
   ```

2. Verify domain in allowlist matches log entries

3. Add missing domains to `--allow-domains`

### Connection Failures

1. Enable debug logging
2. Check Copilot logs for error messages
3. Verify iptables rules in container logs
4. Review Squid cache.log for proxy errors

### Performance Issues

1. Monitor Squid access.log for slow responses
2. Check Docker container resource usage:
   ```bash
   docker stats awf-squid awf-copilot
   ```

## Log Rotation

Logs are created per execution with timestamps:
- `/tmp/copilot-logs-<timestamp>/`
- `/tmp/squid-logs-<timestamp>/`

**Manual cleanup:**
```bash
# Remove logs older than 7 days
find /tmp -name "*-logs-*" -type d -mtime +7 -exec rm -rf {} +
```
