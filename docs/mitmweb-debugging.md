# Debugging AWF Traffic with mitmweb

This guide shows how to chain Squid proxy through mitmweb to inspect HTTP/HTTPS traffic from Copilot CLI.

## Prerequisites

- mitmproxy installed (`pip install mitmproxy`)
- AWF built and working

## Setup

### 1. Start mitmweb on host

```bash
mitmweb --listen-port 8000
```

Web UI available at http://127.0.0.1:8081

### 2. Run AWF with `--keep-containers`

```bash
sudo -E awf --keep-containers \
  --add-host host.docker.internal:host-gateway \
  --tty --env-all \
  --allow-domains 'api.github.com,registry.npmjs.org,api.enterprise.githubcopilot.com' \
  --log-level debug \
  -- echo "setup done"
```

Note the workDir from output (e.g., `/tmp/awf-XXXXX`).

### 3. Stop containers

```bash
docker stop awf-agent awf-squid
```

### 4. Edit Squid config to chain through mitmweb

```bash
# Add cache_peer after http_port line
sudo sed -i '/^http_port 3128$/a \
cache_peer host.docker.internal parent 8000 0 no-query no-digest default\
never_direct allow all' /tmp/awf-XXXXX/squid.conf
```

### 5. Add host.docker.internal to Squid container

```bash
sudo sed -i '/image: ghcr.io\/githubnext\/gh-aw-firewall\/squid:latest/a\    extra_hosts:\n      - host.docker.internal:host-gateway' /tmp/awf-XXXXX/docker-compose.yml
```

### 6. Change agent command to stay alive

```bash
sudo sed -i "s/echo 'setup done'/sleep infinity/" /tmp/awf-XXXXX/docker-compose.yml
```

### 7. (Optional) Mount additional directories

```bash
# Add volume mount
sudo sed -i '/mcp-config.json:ro$/a\      - /path/to/dir:/path/to/dir:rw' /tmp/awf-XXXXX/docker-compose.yml

# Change working directory
sudo sed -i 's|working_dir: .*|working_dir: /path/to/dir|' /tmp/awf-XXXXX/docker-compose.yml
```

### 8. Restart containers

```bash
docker rm -f awf-squid awf-agent
cd /tmp/awf-XXXXX && docker compose up -d
```

### 9. Disable npm SSL verification (required for mitmproxy interception)

```bash
docker exec awf-agent bash -c "echo 'strict-ssl=false' >> ~/.npmrc"
```

### 10. Run commands in agent container

```bash
docker exec -it awf-agent /bin/bash -c "npx -y '@github/copilot@0.0.365' --prompt 'hello'"
```

## Verify Traffic

- Check mitmweb UI at http://127.0.0.1:8081
- Test connectivity: `docker exec awf-agent curl -k https://api.github.com/zen`

## Cleanup

```bash
docker stop awf-agent awf-squid
docker rm awf-agent awf-squid
sudo rm -rf /tmp/awf-XXXXX
```

## Troubleshooting

| Error | Solution |
|-------|----------|
| `ERR_CANNOT_FORWARD` | Squid can't reach mitmweb. Add `extra_hosts` to Squid container |
| `SELF_SIGNED_CERT_IN_CHAIN` | Set `strict-ssl=false` in ~/.npmrc |
| Container exits immediately | Change command to `sleep infinity` |
| Stale PID file | `docker rm -f` containers before restart |
