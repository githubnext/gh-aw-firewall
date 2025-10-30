# Troubleshooting

## Domain Access Issues

### Domain is Blocked

**Problem:** Request to allowed domain is being blocked

**Solution:**
1. Check domain spelling in `--allow-domains`
2. Add subdomains if needed (e.g., `api.github.com` in addition to `github.com`)
3. Enable debug logging to see Squid access logs:
   ```bash
   sudo awf \
     --allow-domains github.com \
     --log-level debug \
     'your-command'
   ```
4. Check Squid logs for blocked requests:
   ```bash
   sudo grep "TCP_DENIED" /tmp/squid-logs-<timestamp>/access.log
   ```

## Container Issues

### Container Won't Start

**Problem:** Docker Compose fails to start containers

**Solution:**
1. Ensure Docker is running:
   ```bash
   docker ps
   ```
2. Check for port conflicts (port 3128 must be available):
   ```bash
   netstat -tulpn | grep 3128
   ```
3. Verify Docker Compose is installed:
   ```bash
   docker compose version
   ```
4. Check for orphaned networks:
   ```bash
   docker network ls | grep awf
   ```
   If found, clean them up:
   ```bash
   docker network rm awf-net
   ```

## Permission Issues

### iptables Permission Denied

**Problem:** `Permission denied: iptables commands require root privileges`

**Solution:**
- **All commands MUST be run with `sudo`** for host-level iptables manipulation
- Run: `sudo awf --allow-domains ... 'your-command'`
- In GitHub Actions, the runner already has root access (no `sudo` needed)

### DOCKER-USER Chain Missing

**Problem:** `DOCKER-USER chain does not exist`

**Solution:**
- Ensure Docker is properly installed and running
- Docker creates the DOCKER-USER chain automatically
- Verify Docker version is recent (tested on 20.10+):
  ```bash
  docker version
  ```

### Environment Variables Not Preserved

**Problem:** `GITHUB_TOKEN` or other environment variables not available in container

**Solution:**
- Use `sudo -E` to preserve environment variables:
  ```bash
  sudo -E awf --allow-domains ... 'your-command'
  ```
- Verify variables are exported before running:
  ```bash
  export GITHUB_TOKEN="your-token"
  echo $GITHUB_TOKEN  # Should print the token
  ```

## MCP Server Issues

### MCP Server Can't Connect

**Problem:** MCP server cannot reach external API

**Solution:**
1. Add MCP server's domain to `--allow-domains`
2. Check if MCP server uses subdomain (e.g., `api.example.com`)
3. Verify DNS resolution is working:
   ```bash
   sudo awf --allow-domains example.com \
     'nslookup api.example.com'
   ```
4. Check Squid logs for blocked requests:
   ```bash
   sudo grep "api.example.com" /tmp/squid-logs-<timestamp>/access.log
   ```

### MCP Tools Not Available

**Problem:** MCP tools not showing up in Copilot CLI

**Solution:**
1. Verify MCP config has `"tools": ["*"]` field:
   ```bash
   cat ~/.copilot/mcp-config.json
   ```
2. Ensure `--allow-tool` flag matches MCP server name:
   ```bash
   # MCP config has "github" as server name
   copilot --allow-tool github --prompt "..."
   ```
3. Check if built-in MCP is disabled:
   ```bash
   copilot --disable-builtin-mcps --prompt "..."
   ```
4. Review Copilot logs for MCP connection errors:
   ```bash
   cat /tmp/agent-logs-<timestamp>/*.log
   ```

## Log Analysis

### Finding Blocked Domains

```bash
# View all blocked domains
sudo grep "TCP_DENIED" /tmp/squid-logs-<timestamp>/access.log | awk '{print $3}' | sort -u

# Count blocked attempts by domain
sudo grep "TCP_DENIED" /tmp/squid-logs-<timestamp>/access.log | awk '{print $3}' | sort | uniq -c | sort -rn
```

### Checking Container Logs

**While containers are running** (with `--keep-containers`):
```bash
docker logs awf-agent
docker logs awf-squid
```

**After command completes:**
```bash
# Copilot logs
cat /tmp/agent-logs-<timestamp>/*.log

# Squid logs (requires sudo)
sudo cat /tmp/squid-logs-<timestamp>/access.log
```

### Checking iptables Logs

Blocked UDP and non-standard protocols are logged to kernel logs:

```bash
# From host (requires sudo)
sudo dmesg | grep FW_BLOCKED

# From within container
docker exec awf-agent dmesg | grep FW_BLOCKED
```

## Network Issues

### DNS Resolution Failures

**Problem:** Domains cannot be resolved

**Solution:**
1. Verify DNS is allowed in iptables rules (should be automatic)
2. Test DNS resolution:
   ```bash
   sudo awf --allow-domains example.com \
     'nslookup example.com'
   ```
3. Check if DNS servers are reachable:
   ```bash
   sudo awf --allow-domains example.com \
     'cat /etc/resolv.conf'
   ```

### Connection Timeouts

**Problem:** Requests timeout instead of being blocked

**Solution:**
1. Check if Squid proxy is running:
   ```bash
   docker ps | grep awf-squid
   ```
2. Verify iptables rules are applied:
   ```bash
   docker exec awf-agent iptables -t nat -L -n -v
   ```
3. Increase timeout in your command:
   ```bash
   sudo awf --allow-domains github.com \
     'curl --max-time 30 https://api.github.com'
   ```

### Proxy Connection Refused

**Problem:** `curl: (7) Failed to connect to 172.30.0.10 port 3128`

**Solution:**
1. Ensure Squid container is healthy:
   ```bash
   docker ps --filter name=awf-squid
   # Should show "healthy" status
   ```
2. Check Squid logs for errors:
   ```bash
   sudo cat /tmp/squid-logs-<timestamp>/cache.log
   ```
3. Verify network connectivity:
   ```bash
   docker exec awf-agent ping -c 3 172.30.0.10
   ```

## Docker-in-Docker Issues

### Spawned Containers Not Using Proxy

**Problem:** Containers spawned by docker commands don't respect firewall

**Solution:**
- Verify docker-wrapper.sh is working:
  ```bash
  docker exec awf-agent cat /tmp/docker-wrapper.log
  ```
- Check that spawned containers have correct network:
  ```bash
  docker network inspect awf-net
  # Should show spawned containers in "Containers" section
  ```

### Docker Bypass Attempts Blocked

**Problem:** `--network host is not allowed (bypasses firewall)`

**Solution:**
- This is expected behavior - `--network host` bypasses the firewall
- Use default network instead (no `--network` flag needed)
- The firewall automatically injects the correct network

**Problem:** `--add-host is not allowed (enables DNS poisoning)`

**Solution:**
- This is expected behavior - `--add-host` can bypass domain restrictions
- Remove `--add-host` flag from docker command
- Use legitimate DNS resolution instead

**Problem:** `--privileged is not allowed (bypasses all security)`

**Solution:**
- This is expected behavior - `--privileged` can disable firewall rules
- Remove `--privileged` flag from docker command
- Use containers without privileged mode

## Cleanup Issues

### Orphaned Containers

**Problem:** Containers remain after command exits

**Solution:**
1. Manually clean up containers:
   ```bash
   docker rm -f awf-agent awf-squid
   ```
2. Clean up networks:
   ```bash
   docker network rm awf-net
   ```
3. Use cleanup script:
   ```bash
   ./scripts/ci/cleanup.sh
   ```

### Disk Space Issues

**Problem:** `/tmp` directory filling up with logs

**Solution:**
1. Manually remove old logs:
   ```bash
   rm -rf /tmp/agent-logs-*
   rm -rf /tmp/squid-logs-*
   rm -rf /tmp/awf-*
   ```
2. Empty log directories are not preserved automatically
3. Use `--keep-containers` only when needed for debugging

## GitHub Actions Specific Issues

### Workflow Timeout

**Problem:** GitHub Actions workflow times out

**Solution:**
1. Increase timeout in workflow:
   ```yaml
   timeout-minutes: 15
   ```
2. Use `timeout` command in script:
   ```bash
   timeout 60s awf --allow-domains ... 'your-command'
   ```

### Cleanup Not Running

**Problem:** Cleanup step not executing in workflow

**Solution:**
1. Ensure cleanup step has `if: always()`:
   ```yaml
   - name: Cleanup
     if: always()
     run: ./scripts/ci/cleanup.sh
   ```
2. Add pre-test cleanup to prevent resource accumulation:
   ```yaml
   - name: Pre-test cleanup
     run: ./scripts/ci/cleanup.sh
   ```

### Network Pool Exhaustion

**Problem:** `Pool overlaps with other one on this address space`

**Solution:**
1. Run cleanup before tests:
   ```bash
   ./scripts/ci/cleanup.sh
   ```
2. Add network pruning:
   ```bash
   docker network prune -f
   ```
3. This is why pre-test cleanup is critical in CI/CD

## Getting More Help

If you're still experiencing issues:

1. **Enable debug logging:**
   ```bash
   sudo awf --log-level debug --allow-domains ... 'your-command'
   ```

2. **Keep containers for inspection:**
   ```bash
   sudo awf --keep-containers --allow-domains ... 'your-command'
   ```

3. **Review all logs:**
   - Copilot logs: `/tmp/agent-logs-<timestamp>/`
   - Squid logs: `/tmp/squid-logs-<timestamp>/`
   - Docker wrapper logs: `docker exec awf-agent cat /tmp/docker-wrapper.log`
   - Container logs: `docker logs awf-agent`

4. **Check documentation:**
   - [Architecture](architecture.md) - Understand how the system works
   - [Usage Guide](usage.md) - Detailed usage examples
   - [Logging Documentation](../LOGGING.md) - Comprehensive logging guide
