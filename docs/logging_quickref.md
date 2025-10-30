# Logging Quick Reference

## View Logs

### HTTP/HTTPS Traffic (Squid)
```bash
# View all logs
docker exec awf-squid cat /var/log/squid/access.log

# Follow in real-time
docker exec awf-squid tail -f /var/log/squid/access.log

# Show only blocked requests
docker exec awf-squid grep "TCP_DENIED" /var/log/squid/access.log

# Show only allowed requests
docker exec awf-squid grep "TCP_TUNNEL\|TCP_MISS" /var/log/squid/access.log
```

### Non-HTTP Traffic (iptables)
```bash
# From host (requires sudo)
sudo dmesg | grep FW_BLOCKED

# From agent container
docker exec awf-agent dmesg | grep FW_BLOCKED

# Using journalctl (systemd)
sudo journalctl -k | grep FW_BLOCKED
```

## Log Format

### Squid Log Entry
```
timestamp client_ip:port domain dest_ip:port proto method status decision url user_agent
```

**Example (blocked):**
```
1760987995.318 172.20.98.20:55960 example.com:443 -:- 1.1 CONNECT 403 TCP_DENIED:HIER_NONE example.com:443 "curl/7.81.0"
```

**Example (allowed):**
```
1760987995.312 172.20.98.20:55952 github.com:443 140.82.116.3:443 1.1 CONNECT 200 TCP_TUNNEL:HIER_DIRECT github.com:443 "curl/7.81.0"
```

### iptables Log Entry
```
[kernel_time] [PREFIX] IN= OUT=interface SRC=source_ip DST=dest_ip PROTO=protocol SPT=src_port DPT=dst_port UID=uid
```

**Example (blocked UDP):**
```
[1234567.890] [FW_BLOCKED_UDP] IN= OUT=eth0 SRC=172.20.98.20 DST=1.1.1.1 PROTO=UDP SPT=12345 DPT=443 UID=0
```

## Common Queries

### Find Blocked Domains
```bash
docker exec awf-squid grep "TCP_DENIED" /var/log/squid/access.log | awk '{print $3}' | sort -u
```

### Count Blocked Attempts by Domain
```bash
docker exec awf-squid grep "TCP_DENIED" /var/log/squid/access.log | awk '{print $3}' | sort | uniq -c | sort -rn
```

### Find All Unique Accessed Domains
```bash
docker exec awf-squid awk '{print $3}' /var/log/squid/access.log | sort -u
```

### Show Last 20 Blocked Requests
```bash
docker exec awf-squid grep "TCP_DENIED" /var/log/squid/access.log | tail -20
```

### Find QUIC/HTTP3 Block Attempts
```bash
sudo dmesg | grep "FW_BLOCKED_UDP" | grep "DPT=443"
```

### Convert Timestamps to Human-Readable
```bash
docker exec awf-squid cat /var/log/squid/access.log | \
  while IFS= read -r line; do
    ts=$(echo "$line" | awk '{print $1}')
    rest=$(echo "$line" | cut -d' ' -f2-)
    echo "$(date -d @${ts} '+%Y-%m-%d %H:%M:%S') $rest"
  done
```

### Export Blocked Domains to File
```bash
docker exec awf-squid grep "TCP_DENIED" /var/log/squid/access.log | \
  awk '{print $3}' | sort -u > blocked_domains.txt
```

## Decision Codes

| Code | Meaning | Action |
|------|---------|--------|
| `TCP_DENIED:HIER_NONE` | **Blocked** | Domain not in allowlist |
| `TCP_TUNNEL:HIER_DIRECT` | **Allowed** | HTTPS tunneled successfully |
| `TCP_MISS:HIER_DIRECT` | **Allowed** | HTTP request forwarded |

## Status Codes

| Code | Meaning |
|------|---------|
| `200` | Request allowed and successful |
| `403` | Request blocked (domain not in allowlist) |
| `502` | Bad Gateway (destination unreachable) |
| `503` | Service Unavailable (DNS resolution failed) |

## Real-Time Monitoring

### Watch Blocked Attempts
```bash
watch -n 1 'docker exec awf-squid grep TCP_DENIED /var/log/squid/access.log | tail -20'
```

### Count by Domain (Updates Every 5 Seconds)
```bash
watch -n 5 'docker exec awf-squid grep TCP_DENIED /var/log/squid/access.log | awk "{print \$3}" | sort | uniq -c | sort -rn | head -10'
```

### Follow New Entries
```bash
docker exec awf-squid tail -f /var/log/squid/access.log | \
  grep --line-buffered "TCP_DENIED" | \
  while read -r line; do
    echo "[BLOCKED] $line"
  done
```

## Filtering by Field

### By Client IP
```bash
docker exec awf-squid awk '$2 ~ /^172\.20\.98\.20:/' /var/log/squid/access.log
```

### By Domain Pattern
```bash
docker exec awf-squid grep "github\.com" /var/log/squid/access.log
```

### By Status Code
```bash
docker exec awf-squid awk '$7 == 403' /var/log/squid/access.log
```

### By Time Range (Last Hour)
```bash
NOW=$(date +%s)
HOUR_AGO=$((NOW - 3600))
docker exec awf-squid awk -v start=$HOUR_AGO '$1 >= start' /var/log/squid/access.log
```

### By User Agent
```bash
docker exec awf-squid grep "curl" /var/log/squid/access.log
```

## Statistics

### Total Requests
```bash
docker exec awf-squid wc -l /var/log/squid/access.log
```

### Blocked vs Allowed Count
```bash
echo "Blocked: $(docker exec awf-squid grep -c TCP_DENIED /var/log/squid/access.log)"
echo "Allowed: $(docker exec awf-squid grep -cE 'TCP_TUNNEL|TCP_MISS' /var/log/squid/access.log)"
```

### Top 10 Accessed Domains
```bash
docker exec awf-squid awk '{print $3}' /var/log/squid/access.log | \
  sort | uniq -c | sort -rn | head -10
```

### Unique Client IPs
```bash
docker exec awf-squid awk '{split($2,a,":"); print a[1]}' /var/log/squid/access.log | sort -u
```

## Integration Examples

### Export to CSV
```bash
docker exec awf-squid cat /var/log/squid/access.log | \
  awk 'BEGIN{OFS=","} {print $1,$2,$3,$4,$5,$6,$7,$8,$9,$10}' > access.csv
```

### Send to Syslog
```bash
docker exec awf-squid tail -f /var/log/squid/access.log | \
  logger -t awf -n syslog.example.com -P 514
```

### Alert on Blocked Attempt
```bash
docker exec awf-squid tail -f /var/log/squid/access.log | \
  grep --line-buffered "TCP_DENIED" | \
  while read -r line; do
    # Send alert (email, Slack, etc.)
    echo "ALERT: Blocked access detected: $line" | mail -s "Firewall Alert" admin@example.com
  done
```

## Troubleshooting

### No Logs Appearing
```bash
# Check container is running
docker ps | grep awf-squid

# Check volume mount
docker inspect awf-squid | grep -A5 Mounts

# Check Squid is logging
docker exec awf-squid grep access_log /etc/squid/squid.conf
```

### Log File Too Large
```bash
# Check size
docker exec awf-squid ls -lh /var/log/squid/access.log

# Rotate manually
docker exec awf-squid squid -k rotate

# Clear logs (use with caution)
docker exec awf-squid sh -c "> /var/log/squid/access.log"
```

### Parse Errors
```bash
# Validate log format
docker exec awf-squid grep logformat /etc/squid/squid.conf

# Check for corrupted lines
docker exec awf-squid awk 'NF != 10' /var/log/squid/access.log
```

## See Also

- [LOGGING.md](../LOGGING.md) - Complete logging documentation
- [README.md](../README.md) - Main project documentation
