---
title: Troubleshooting
description: Solutions to common issues with the Agentic Workflow Firewall
---

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
     -- your-command
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
- Run: `sudo awf --allow-domains ... -- your-command`
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
  sudo -E awf --allow-domains github.com -- copilot ...
  ```

## Debugging Tips

### View Container Logs

```bash
# Keep containers running for inspection
sudo awf --keep-containers --allow-domains github.com -- your-command

# View logs
docker logs awf-copilot
docker logs awf-squid

# Clean up when done
docker stop awf-squid awf-copilot
docker rm awf-squid awf-copilot
```

### Analyze Squid Logs

```bash
# Find blocked domains
sudo grep "TCP_DENIED" /tmp/squid-logs-*/access.log | awk '{print $3}' | sort -u

# Count blocked attempts by domain
sudo grep "TCP_DENIED" /tmp/squid-logs-*/access.log | awk '{print $3}' | sort | uniq -c | sort -rn
```

### Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `Connection timed out` | Domain not whitelisted | Add domain to `--allow-domains` |
| `403 Forbidden` | Domain blocked by Squid | Check Squid logs for details |
| `Cannot connect to Docker daemon` | Docker not running | Start Docker service |
| `Port 3128 already in use` | Squid already running | Stop existing Squid containers |

## Getting Help

- Check the [Usage Guide](/guides/usage/) for detailed options
- Review the [Architecture](/reference/architecture/) to understand how it works
- Enable `--log-level debug` for detailed diagnostics
- Use `--keep-containers` to inspect container state
