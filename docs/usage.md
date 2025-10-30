# Usage Guide

## Command-Line Options

```
sudo awf [options] <command>

Options:
  --allow-domains <domains>  Comma-separated list of allowed domains (required)
                             Example: github.com,api.github.com,arxiv.org
  --log-level <level>        Log level: debug, info, warn, error (default: info)
  --keep-containers          Keep containers running after command exits
  --work-dir <dir>           Working directory for temporary files
  -V, --version              Output the version number
  -h, --help                 Display help for command

Arguments:
  command                    Command to execute (wrap in quotes)
```

## Basic Examples

### Simple HTTP Request

```bash
sudo awf \
  --allow-domains github.com,api.github.com \
  'curl https://api.github.com'
```

### Docker-in-Docker Example

The firewall enforces domain filtering on spawned containers:

```bash
# Allowed - api.github.com is in the allowlist
sudo awf \
  --allow-domains api.github.com,registry-1.docker.io,auth.docker.io \
  'docker run --rm curlimages/curl -fsS https://api.github.com/zen'

# Blocked - api.github.com NOT in the allowlist
sudo awf \
  --allow-domains registry-1.docker.io,auth.docker.io \
  'docker run --rm curlimages/curl -fsS https://api.github.com/zen'
# Returns: curl: (22) The requested URL returned error: 403
```

### With GitHub Copilot CLI

```bash
sudo awf \
  --allow-domains github.com,api.github.com,githubusercontent.com,anthropic.com \
  'copilot --prompt "List my repositories"'
```

### With MCP Servers

```bash
sudo awf \
  --allow-domains github.com,arxiv.org,mcp.tavily.com \
  --log-level debug \
  'copilot --mcp arxiv,tavily --prompt "Search arxiv for recent AI papers"'
```

## Domain Whitelisting

### Subdomain Matching

Domains automatically match all subdomains:

```bash
# github.com matches api.github.com, raw.githubusercontent.com, etc.
sudo awf --allow-domains github.com "curl https://api.github.com"  # ✓ works
```

### Multiple Domains

```bash
sudo awf --allow-domains github.com,arxiv.org "curl https://api.github.com"
```

### Normalization

Domains are case-insensitive, spaces/trailing dots are trimmed:

```bash
# These are equivalent
--allow-domains github.com
--allow-domains " GitHub.COM. "
```

### Example Domain Lists

For GitHub Copilot with GitHub API:
```bash
--allow-domains github.com,api.github.com,githubusercontent.com,githubassets.com
```

For MCP servers:
```bash
--allow-domains \
  github.com,\
  arxiv.org,\
  mcp.context7.com,\
  mcp.tavily.com,\
  learn.microsoft.com,\
  mcp.deepwiki.com
```

## Limitations

### No Wildcard Syntax

Wildcards are not needed - subdomains match automatically:

```bash
--allow-domains '*.github.com'  # ✗ syntax not supported
--allow-domains github.com       # ✓ matches *.github.com automatically
```

### No Internationalized Domains

Use punycode instead:

```bash
--allow-domains bücher.ch              # ✗ fails
--allow-domains xn--bcher-kva.ch       # ✓ works
"curl https://xn--bcher-kva.ch"        # use punycode in URL too
```

### HTTP→HTTPS Redirects

Redirects from HTTP to HTTPS may fail:

```bash
# May return 400 (redirect from http to https)
sudo awf --allow-domains github.com "curl -fL http://github.com"

# Use HTTPS directly instead
sudo awf --allow-domains github.com "curl -fL https://github.com"  # ✓ works
```

### HTTP/3 Not Supported

```bash
# Container's curl doesn't support HTTP/3
sudo awf --allow-domains github.com "curl --http3 https://api.github.com"  # ✗ fails

# Use HTTP/1.1 or HTTP/2 instead
sudo awf --allow-domains github.com "curl https://api.github.com"  # ✓ works
```

### IPv6 Not Supported

```bash
# IPv6 traffic not configured
sudo awf --allow-domains github.com "curl -6 https://api.github.com"  # ✗ fails

# Use IPv4 (default)
sudo awf --allow-domains github.com "curl https://api.github.com"  # ✓ works
```

### Limited Tooling in Container

```bash
# wscat not installed in container
sudo awf --allow-domains echo.websocket.events "wscat -c wss://echo.websocket.events"  # ✗ fails

# Install tools first or use available ones (curl, git, nodejs, npm)
sudo awf --allow-domains github.com "npm install -g wscat && wscat -c wss://echo.websocket.events"
```

### Docker --network host is Blocked

```bash
# --network host bypasses firewall and is blocked
sudo awf --allow-domains github.com \
  "docker run --rm --network host curlimages/curl https://example.com"  # ✗ fails
# Error: --network host is not allowed (bypasses firewall)

# Use default network (awf-net is injected automatically)
sudo awf --allow-domains example.com \
  "docker run --rm curlimages/curl https://example.com"  # ✓ works
```

### Docker --add-host is Blocked (DNS Poisoning Protection)

```bash
# --add-host can map whitelisted domains to unauthorized IPs (DNS poisoning attack)
ip=$(getent hosts example.com | awk '{print $1}' | head -1)
sudo awf --allow-domains github.com \
  "docker run --rm --add-host github.com:$ip curlimages/curl https://github.com"  # ✗ fails
# Error: --add-host is not allowed (enables DNS poisoning)

# Without --add-host, DNS resolution is legitimate
sudo awf --allow-domains github.com \
  "docker run --rm curlimages/curl https://github.com"  # ✓ works
```

### Docker --privileged is Blocked (Security Bypass Protection)

```bash
# --privileged grants unrestricted access and can disable firewall rules
sudo awf --allow-domains github.com \
  "docker run --rm --privileged curlimages/curl https://example.com"  # ✗ fails
# Error: --privileged is not allowed (bypasses all security)

# Use containers without privileged mode
sudo awf --allow-domains example.com \
  "docker run --rm curlimages/curl https://example.com"  # ✓ works
```

## IP-Based Access

Direct IP access (without domain names) is blocked:

```bash
# ✓ Cloud metadata services blocked
sudo awf --allow-domains github.com "curl -f http://169.254.169.254"
# Returns 400 Bad Request (blocked as expected)
```

## Debugging

### Enable Debug Logging

```bash
sudo awf \
  --allow-domains github.com \
  --log-level debug \
  'your-command'
```

This will show:
- Squid configuration generation
- Docker container startup logs (streamed in real-time)
- iptables rules applied
- Network connectivity tests
- Proxy traffic logs

### Real-Time Log Streaming

Container logs are streamed in real-time, allowing you to see output as commands execute:

```bash
sudo awf \
  --allow-domains github.com \
  "npx @github/copilot@0.0.347 -p 'your prompt' --allow-all-tools"
# Logs appear immediately as copilot runs, not after completion
```

### Log Preservation

Both Copilot CLI and Squid proxy logs are automatically preserved for debugging:

```bash
# Logs automatically saved after command completes
sudo awf \
  --allow-domains github.com,api.enterprise.githubcopilot.com \
  "npx @github/copilot@0.0.347 -p 'your prompt' --log-level debug --allow-all-tools"

# Output:
# [INFO] Copilot logs preserved at: /tmp/agent-logs-<timestamp>
# [INFO] Squid logs preserved at: /tmp/squid-logs-<timestamp>
```

**Copilot Logs:**
- Contains Copilot CLI debug output and session information
- Location: `/tmp/agent-logs-<timestamp>/`
- View with: `cat /tmp/agent-logs-<timestamp>/*.log`

**Squid Logs:**
- Contains all HTTP/HTTPS traffic (allowed and denied)
- Location: `/tmp/squid-logs-<timestamp>/`
- Requires sudo: `sudo cat /tmp/squid-logs-<timestamp>/access.log`

```bash
# Check which domains were blocked
sudo grep "TCP_DENIED" /tmp/squid-logs-<timestamp>/access.log

# View all traffic
sudo cat /tmp/squid-logs-<timestamp>/access.log
```

**How it works:**
- Copilot writes to `~/.copilot/logs/`, Squid writes to `/var/log/squid/`
- Volume mounts map these to `${workDir}/agent-logs/` and `${workDir}/squid-logs/`
- Before cleanup, logs are automatically moved to `/tmp/*-logs-<timestamp>/` (if they exist)
- Empty log directories are not preserved (avoids cluttering /tmp)

### Keep Containers for Inspection

```bash
sudo awf \
  --allow-domains github.com \
  --keep-containers \
  'your-command'

# View real-time container logs:
docker logs awf-agent
docker logs awf-squid

# Access preserved logs at:
# /tmp/awf-<timestamp>/agent-logs/
# /tmp/awf-<timestamp>/squid-logs/
```

## Log Analysis

Find all blocked domains:
```bash
docker exec awf-squid grep "TCP_DENIED" /var/log/squid/access.log | awk '{print $3}' | sort -u
```

Count blocked attempts by domain:
```bash
docker exec awf-squid grep "TCP_DENIED" /var/log/squid/access.log | awk '{print $3}' | sort | uniq -c | sort -rn
```

**For detailed logging documentation, see [LOGGING.md](../LOGGING.md)**
