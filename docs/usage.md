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

## Command Passing with Environment Variables

AWF preserves shell variables for expansion inside the container, making it compatible with GitHub Actions and other CI/CD environments.

### Single Argument (Recommended for Complex Commands)

Quote your entire command to preserve shell syntax and variables:

```bash
# Variables expand inside the container
sudo awf --allow-domains github.com -- 'echo $HOME && pwd'
```

Variables like `$HOME`, `$USER`, `$PWD` will expand inside the container, not on your host machine. This is **critical** for commands that need to reference the container environment.

### Multiple Arguments (Simple Commands)

For simple commands without variables or special shell syntax:

```bash
# Each argument is automatically shell-escaped
sudo awf --allow-domains github.com -- curl -H "Authorization: Bearer token" https://api.github.com
```

### GitHub Actions Usage

Environment variables work correctly when using the single-argument format:

```yaml
- name: Run with environment variables
  run: |
    sudo -E awf --allow-domains github.com -- 'cd $GITHUB_WORKSPACE && npm test'
```

**Why this works:**
- GitHub Actions expands `${{ }}` syntax before the shell sees it
- Shell variables like `$GITHUB_WORKSPACE` are preserved literally
- These variables then expand inside the container with correct values

**Important:** Do NOT use multi-argument format with variables:
```bash
# ❌ Wrong: Variables won't expand correctly
sudo awf -- echo $HOME  # Shell expands $HOME on host first

# ✅ Correct: Single-quoted preserves for container
sudo awf -- 'echo $HOME'  # Expands to container home
```

## Domain Whitelisting

### Subdomain Matching

Domains automatically match all subdomains:

```bash
# github.com matches api.github.com, raw.githubusercontent.com, etc.
sudo awf --allow-domains github.com "curl https://api.github.com"  # ✓ works
```

### Wildcard Patterns

You can use wildcard patterns with `*` to match multiple domains:

```bash
# Match any subdomain of github.com
--allow-domains '*.github.com'

# Match api-v1.example.com, api-v2.example.com, etc.
--allow-domains 'api-*.example.com'

# Combine plain domains and wildcards
--allow-domains 'github.com,*.googleapis.com,api-*.example.com'
```

**Pattern rules:**
- `*` matches any characters (converted to regex `.*`)
- Patterns are case-insensitive (DNS is case-insensitive)
- Overly broad patterns like `*`, `*.*`, or `*.*.*` are rejected for security
- Use quotes around patterns to prevent shell expansion

**Examples:**
| Pattern | Matches | Does Not Match |
|---------|---------|----------------|
| `*.github.com` | `api.github.com`, `raw.github.com` | `github.com` |
| `api-*.example.com` | `api-v1.example.com`, `api-test.example.com` | `api.example.com` |
| `github.com` | `github.com`, `api.github.com` | `notgithub.com` |

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

## Domain Blocklist

You can explicitly block specific domains using `--block-domains` and `--block-domains-file`. **Blocked domains take precedence over allowed domains**, enabling fine-grained control.

### Basic Blocklist Usage

```bash
# Allow example.com but block internal.example.com
sudo awf \
  --allow-domains example.com \
  --block-domains internal.example.com \
  -- curl https://api.example.com  # ✓ works

sudo awf \
  --allow-domains example.com \
  --block-domains internal.example.com \
  -- curl https://internal.example.com  # ✗ blocked
```

### Blocklist with Wildcards

```bash
# Allow all of example.com except any subdomain starting with "internal-"
sudo awf \
  --allow-domains example.com \
  --block-domains 'internal-*.example.com' \
  -- curl https://api.example.com  # ✓ works

# Block all subdomains matching the pattern
sudo awf \
  --allow-domains '*.example.com' \
  --block-domains '*.secret.example.com' \
  -- curl https://api.example.com  # ✓ works
```

### Using a Blocklist File

```bash
# Create a blocklist file
cat > blocked-domains.txt << 'EOF'
# Internal services that should never be accessed
internal.example.com
admin.example.com

# Block all subdomains of sensitive.org
*.sensitive.org
EOF

# Use the blocklist file
sudo awf \
  --allow-domains example.com,sensitive.org \
  --block-domains-file blocked-domains.txt \
  -- curl https://api.example.com
```

**Combining flags:**
```bash
# You can combine all domain flags
sudo awf \
  --allow-domains github.com \
  --allow-domains-file allowed.txt \
  --block-domains internal.github.com \
  --block-domains-file blocked.txt \
  -- your-command
```

**Use cases:**
- Allow a broad domain (e.g., `*.example.com`) but block specific sensitive subdomains
- Block known bad domains while allowing a curated list
- Prevent access to internal services from AI agents

## Limitations

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
# Logs appear immediately as command runs, not after completion
```

### Log Preservation

Both GitHub Copilot CLI and Squid proxy logs are automatically preserved for debugging:

```bash
# Logs automatically saved after command completes
sudo awf \
  --allow-domains github.com,api.enterprise.githubcopilot.com \
  "npx @github/copilot@0.0.347 -p 'your prompt' --log-level debug --allow-all-tools"

# Output:
# [INFO] Agent logs preserved at: /tmp/awf-agent-logs-<timestamp>
# [INFO] Squid logs preserved at: /tmp/squid-logs-<timestamp>
```

**Agent Logs:**
- Contains GitHub Copilot CLI debug output and session information
- Location: `/tmp/awf-agent-logs-<timestamp>/`
- View with: `cat /tmp/awf-agent-logs-<timestamp>/*.log`

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
- GitHub Copilot CLI writes to `~/.copilot/logs/`, Squid writes to `/var/log/squid/`
- Volume mounts map these to `${workDir}/agent-logs/` and `${workDir}/squid-logs/`
- Before cleanup, logs are automatically moved to `/tmp/awf-agent-logs-<timestamp>/` and `/tmp/squid-logs-<timestamp>/` (if they exist)
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

## Viewing Logs with `awf logs`

The `awf logs` command provides an easy way to view Squid proxy logs from current or previous runs.

### Basic Usage

```bash
# View recent logs with pretty formatting (default)
awf logs

# Follow logs in real-time (like tail -f)
awf logs -f
```

### Output Formats

The command supports three output formats:

```bash
# Pretty: colorized, human-readable output (default)
awf logs --format pretty

# Raw: logs as-is without parsing or colorization
awf logs --format raw

# JSON: structured output for programmatic consumption
awf logs --format json
```

Example JSON output:
```json
{"timestamp":1760987995.318,"clientIp":"172.20.98.20","clientPort":"55960","domain":"example.com","destIp":"-","destPort":"-","httpVersion":"1.1","method":"CONNECT","statusCode":403,"decision":"TCP_DENIED:HIER_NONE","url":"example.com:443","userAgent":"curl/7.81.0","isAllowed":false}
```

### Log Source Discovery

The command auto-discovers log sources in this order:
1. Running `awf-squid` container (live logs)
2. `AWF_LOGS_DIR` environment variable (if set)
3. Preserved log directories in `/tmp/squid-logs-<timestamp>`

```bash
# List all available log sources
awf logs --list

# Output example:
# Available log sources:
#   [running] awf-squid (live container)
#   [preserved] /tmp/squid-logs-1760987995318 (11/27/2024, 12:30:00 PM)
#   [preserved] /tmp/squid-logs-1760987890000 (11/27/2024, 12:28:10 PM)
```

### Using Specific Log Sources

```bash
# Stream from a running container
awf logs --source running -f

# Use a specific preserved log directory
awf logs --source /tmp/squid-logs-1760987995318

# Use logs from AWF_LOGS_DIR
export AWF_LOGS_DIR=/path/to/logs
awf logs
```

### Combining Options

```bash
# Follow live logs in JSON format
awf logs -f --format json

# View specific logs in raw format
awf logs --source /tmp/squid-logs-1760987995318 --format raw
```

### Troubleshooting with Logs

**Find blocked requests:**
```bash
awf logs --format json | jq 'select(.isAllowed == false)'
```

**Filter by domain:**
```bash
awf logs --format json | jq 'select(.domain | contains("github"))'
```

**Count blocked vs allowed:**
```bash
awf logs --format json | jq -s 'group_by(.isAllowed) | map({allowed: .[0].isAllowed, count: length})'
```

## Log Analysis

### Using `awf logs stats`

Get aggregated statistics from firewall logs including total requests, allowed/denied counts, and per-domain breakdown:

```bash
# Pretty terminal output (default)
awf logs stats

# JSON format for scripting
awf logs stats --format json

# Markdown format
awf logs stats --format markdown
```

Example output:
```
Firewall Statistics
────────────────────────────────────────

Total Requests:  150
Allowed:         145 (96.7%)
Denied:          5 (3.3%)
Unique Domains:  12

Domains:
  api.github.com       50 allowed, 0 denied
  registry.npmjs.org   95 allowed, 0 denied
  evil.com             0 allowed, 5 denied
```

### Using `awf logs summary` (GitHub Actions)

Generate a markdown summary optimized for GitHub Actions:

```bash
# Generate markdown summary and append to step summary
awf logs summary >> $GITHUB_STEP_SUMMARY
```

This creates a collapsible summary in your GitHub Actions workflow output showing all allowed and blocked domains.

### Manual Log Queries

For more granular analysis, you can query the logs directly:

Find all blocked domains:
```bash
docker exec awf-squid grep "TCP_DENIED" /var/log/squid/access.log | awk '{print $3}' | sort -u
```

Count blocked attempts by domain:
```bash
docker exec awf-squid grep "TCP_DENIED" /var/log/squid/access.log | awk '{print $3}' | sort | uniq -c | sort -rn
```

**For detailed logging documentation, see [LOGGING.md](../LOGGING.md)**
