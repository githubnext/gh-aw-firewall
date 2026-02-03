---
title: CLI Reference
description: Quick reference for awf command-line options and arguments.
---

Quick reference for the `awf` command-line interface.

:::caution[Requires sudo]
The firewall requires root privileges. Always run with `sudo` or `sudo -E` (to preserve environment variables).
:::

## Synopsis

```bash
awf [options] -- <command>
```

## Options Summary

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--allow-domains <domains>` | string | — | Comma-separated list of allowed domains (required unless `--allow-domains-file` used) |
| `--allow-domains-file <path>` | string | — | Path to file containing allowed domains |
| `--block-domains <domains>` | string | — | Comma-separated list of blocked domains (takes precedence over allowed) |
| `--block-domains-file <path>` | string | — | Path to file containing blocked domains |
| `--ssl-bump` | flag | `false` | Enable SSL Bump for HTTPS content inspection |
| `--allow-urls <urls>` | string | — | Comma-separated list of allowed URL patterns (requires `--ssl-bump`) |
| `--log-level <level>` | string | `info` | Logging verbosity: `debug`, `info`, `warn`, `error` |
| `--keep-containers` | flag | `false` | Keep containers running after command exits |
| `--tty` | flag | `false` | Allocate pseudo-TTY for interactive tools |
| `--work-dir <dir>` | string | `/tmp/awf-<timestamp>` | Working directory for temporary files |
| `--build-local` | flag | `false` | Build containers locally instead of pulling from registry |
| `--agent-image <value>` | string | `default` | Agent container image preset or custom base image |
| `--image-registry <url>` | string | `ghcr.io/github/gh-aw-firewall` | Container image registry |
| `--image-tag <tag>` | string | `latest` | Container image tag |
| `-e, --env <KEY=VALUE>` | string | `[]` | Environment variable (repeatable) |
| `--env-all` | flag | `false` | Pass all host environment variables |
| `-v, --mount <host:container[:mode]>` | string | `[]` | Volume mount (repeatable) |
| `--container-workdir <dir>` | string | User home | Working directory inside container |
| `--dns-servers <servers>` | string | `8.8.8.8,8.8.4.4` | Trusted DNS servers (comma-separated) |
| `--proxy-logs-dir <path>` | string | — | Directory to save Squid proxy logs to |
| `--enable-host-access` | flag | `false` | Enable access to host services via host.docker.internal |
| `--allow-host-ports <ports>` | string | — | Allowed ports for host access (e.g., 3000,8080 or 3000-3010) |
| `--enable-chroot` | flag | `false` | Run command inside chroot to host filesystem |
| `-V, --version` | flag | — | Display version |
| `-h, --help` | flag | — | Display help |

## Options Details

### `--allow-domains <domains>`

Comma-separated list of allowed domains. Domains automatically match all subdomains. Supports wildcard patterns and protocol-specific filtering.

```bash
--allow-domains github.com,npmjs.org
--allow-domains '*.github.com,api-*.example.com'
```

#### Protocol-Specific Filtering

Restrict domains to HTTP-only or HTTPS-only traffic by prefixing with the protocol:

```bash
# HTTPS only - blocks HTTP traffic to this domain
--allow-domains 'https://secure.example.com'

# HTTP only - blocks HTTPS traffic to this domain
--allow-domains 'http://legacy-api.example.com'

# Both protocols (default behavior, backward compatible)
--allow-domains 'example.com'

# Mixed configuration
--allow-domains 'example.com,https://secure.example.com,http://legacy.example.com'

# Works with wildcards
--allow-domains 'https://*.secure.example.com'
```

### `--allow-domains-file <path>`

Path to file with allowed domains. Supports comments (`#`) and one domain per line.

```bash
--allow-domains-file ./allowed-domains.txt
```

### `--block-domains <domains>`

Comma-separated list of blocked domains. **Blocked domains take precedence over allowed domains**, enabling fine-grained control. Supports the same wildcard patterns as `--allow-domains`.

```bash
# Block specific subdomain while allowing parent domain
--allow-domains example.com --block-domains internal.example.com

# Block with wildcards
--allow-domains '*.example.com' --block-domains '*.secret.example.com'
```

### `--block-domains-file <path>`

Path to file with blocked domains. Supports the same format as `--allow-domains-file`.

```bash
--block-domains-file ./blocked-domains.txt
```

### `--ssl-bump`

Enable SSL Bump for HTTPS content inspection. When enabled, the firewall generates a per-session CA certificate and intercepts HTTPS connections, allowing URL path filtering.

```bash
--ssl-bump --allow-urls "https://github.com/myorg/*"
```

:::caution[HTTPS Interception]
SSL Bump decrypts HTTPS traffic at the proxy. The proxy can see full URLs, headers, and request bodies. Applications with certificate pinning will fail to connect.
:::

**How it works:**
1. A unique CA certificate is generated (valid for 1 day)
2. The CA is injected into the agent container's trust store
3. Squid intercepts HTTPS using SSL Bump (peek, stare, bump)
4. Full URLs become visible for filtering via `--allow-urls`

**See also:** [SSL Bump Reference](/gh-aw-firewall/reference/ssl-bump/) for complete documentation.

### `--allow-urls <urls>`

Comma-separated list of allowed URL patterns for HTTPS traffic. Requires `--ssl-bump`.

```bash
# Single pattern
--allow-urls "https://github.com/myorg/*"

# Multiple patterns
--allow-urls "https://github.com/org1/*,https://api.github.com/repos/*"
```

**Pattern syntax:**
- Must include scheme (`https://`)
- `*` matches any characters in a path segment
- Patterns are matched against the full request URL

:::note
Without `--ssl-bump`, the firewall can only see domain names (via SNI). Enable `--ssl-bump` to filter by URL path.
:::

### `--log-level <level>`

Set logging verbosity.

| Level | Description |
|-------|-------------|
| `debug` | Detailed information including config, container startup, iptables rules |
| `info` | Normal operational messages (default) |
| `warn` | Warning messages |
| `error` | Error messages only |

### `--keep-containers`

Keep containers and configuration files after command exits for debugging.

:::note
Requires manual cleanup: `docker stop awf-squid awf-copilot && docker network rm awf-net`
:::

### `--tty`

Allocate a pseudo-TTY for interactive tools (e.g., Claude Code, interactive shells).

### `--work-dir <dir>`

Custom working directory for temporary files. Contains `squid.conf`, `docker-compose.yml`, and log directories.

### `--build-local`

Build containers from local Dockerfiles instead of pulling pre-built images.

### `--image-registry <url>`

Custom container image registry URL.

### `--image-tag <tag>`

Container image tag to use.

### `-e, --env <KEY=VALUE>`

Pass environment variable to container. Can be specified multiple times.

```bash
-e API_KEY=secret -e DEBUG=true
```

### `--env-all`

Pass all host environment variables to container.

:::danger[Security Risk]
May expose sensitive credentials. Prefer `-e` for specific variables.
:::

### `-v, --mount <host_path:container_path[:mode]>`

Mount host directories into container. Format: `host_path:container_path[:ro|rw]`

```bash
-v /data:/data:ro -v /tmp/output:/output:rw
```

**Requirements:**
- Both paths must be absolute
- Host path must exist
- Mode: `ro` (read-only) or `rw` (read-write)

**Default mounts:**
- Host filesystem at `/host` (read-only)
- User home directory (read-write)

### `--container-workdir <dir>`

Working directory inside the container.

### `--dns-servers <servers>`

Comma-separated list of trusted DNS servers. DNS traffic is **only** allowed to these servers, preventing DNS-based data exfiltration. Both IPv4 and IPv6 addresses are supported.

```bash
# Use Cloudflare DNS
--dns-servers 1.1.1.1,1.0.0.1

# Use Google DNS with IPv6
--dns-servers 8.8.8.8,2001:4860:4860::8888
```

:::note
Docker's embedded DNS (127.0.0.11) is always allowed for container name resolution, regardless of this setting.
:::

### `--enable-chroot`

Run user commands inside a `chroot /host` jail, making the host filesystem appear as the root filesystem. This enables transparent access to host-installed binaries (Python, Node.js, Go, etc.) without needing to prefix paths with `/host`.

```bash
# Use host's Python directly
sudo awf --enable-chroot --allow-domains pypi.org \
  -- python3 -c "import requests; print(requests.__version__)"

# Combined with --env-all for full host environment
sudo awf --enable-chroot --env-all --allow-domains api.github.com \
  -- curl https://api.github.com
```

**How it works:**
1. Host filesystem is mounted at `/host` inside the container
2. The entrypoint performs `chroot /host` before running your command
3. Inside the chroot, `/` = host's `/`, so binaries work with normal paths
4. Network isolation is maintained (iptables rules apply at namespace level)

**Requirements:**
- `capsh` must be installed on the host (`apt-get install libcap2-bin`)
- Host user must exist in `/etc/passwd` (matched by UID)

**Security:**
- `CAP_NET_ADMIN` and `CAP_SYS_CHROOT` are dropped before user command executes
- Docker socket is hidden (`/dev/null`) to prevent firewall bypass
- `/proc` is mounted read-only (host processes visible but not modifiable)

**Use cases:**
- GitHub Actions runners with pre-installed tools
- Minimal container + host binaries
- Avoiding version conflicts between container and host tools

:::caution[Security Trade-offs]
Chroot mode exposes the host filesystem (read-only for system paths, read-write for `$HOME` and `/tmp`). See [Chroot Mode Documentation](/gh-aw-firewall/docs/chroot-mode/) for security details.
:::

## Exit Codes

| Code | Description |
|------|-------------|
| `0` | Command succeeded |
| `1-255` | Command exit code or firewall error |
| `130` | Interrupted by SIGINT (Ctrl+C) |
| `143` | Terminated by SIGTERM |

## Subcommands

### `awf logs`

View Squid proxy logs from current or previous runs.

```bash
awf logs [options]
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `-f, --follow` | flag | `false` | Follow log output in real-time |
| `--format <format>` | string | `pretty` | Output format: `raw`, `pretty`, `json` |
| `--source <path>` | string | auto | Path to log directory or `running` for live container |
| `--list` | flag | `false` | List available log sources |
| `--with-pid` | flag | `false` | Enrich logs with PID/process info (requires `-f`) |

#### Output Formats

| Format | Description |
|--------|-------------|
| `pretty` | Colorized, human-readable output (default) |
| `raw` | Logs as-is without parsing |
| `json` | Structured JSON for scripting |

#### Examples

```bash
# View recent logs with pretty formatting
awf logs

# Follow logs in real-time
awf logs -f

# View logs in JSON format
awf logs --format json

# List available log sources
awf logs --list

# Use a specific log directory
awf logs --source /tmp/squid-logs-1234567890

# Stream from running container
awf logs --source running -f

# Follow logs with PID/process tracking
awf logs -f --with-pid
```

#### PID Tracking

The `--with-pid` flag enriches log entries with process information, correlating each network request to the specific process that made it.

**Pretty format with PID:**
```
[2024-01-01 12:00:00.123] CONNECT api.github.com → 200 (ALLOWED) [curl/7.88.1] <PID:12345 curl>
```

**JSON output includes additional fields:**
```json
{
  "timestamp": 1703001234.567,
  "domain": "github.com",
  "pid": 12345,
  "cmdline": "curl https://github.com",
  "comm": "curl",
  "inode": "123456"
}
```

:::caution
PID tracking only works with `-f` (follow mode) and requires Linux. Process information is only available while processes are running.
:::

:::note
Log sources are auto-discovered in this order: running containers, `AWF_LOGS_DIR` environment variable, then preserved log directories in `/tmp/squid-logs-*`.
:::

### `awf logs stats`

Show aggregated statistics from firewall logs.

```bash
awf logs stats [options]
```

:::note[stats vs summary]
Use `awf logs stats` for terminal output (defaults to colorized `pretty` format). Use `awf logs summary` for CI/CD integration (defaults to `markdown` format for `$GITHUB_STEP_SUMMARY`). Both commands provide the same data in different default formats.
:::

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--format <format>` | string | `pretty` | Output format: `json`, `markdown`, `pretty` |
| `--source <path>` | string | auto | Path to log directory or `running` for live container |

#### Output Formats

| Format | Description |
|--------|-------------|
| `pretty` | Colorized terminal output with summary and domain breakdown (default) |
| `markdown` | Markdown table format suitable for documentation |
| `json` | Structured JSON for programmatic consumption |

#### Examples

```bash
# Show stats with colorized terminal output
awf logs stats

# Get stats in JSON format for scripting
awf logs stats --format json

# Get stats in markdown format
awf logs stats --format markdown

# Use a specific log directory
awf logs stats --source /tmp/squid-logs-1234567890
```

#### Example Output (Pretty)

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

### `awf logs summary`

Generate summary report optimized for GitHub Actions step summaries.

```bash
awf logs summary [options]
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--format <format>` | string | `markdown` | Output format: `json`, `markdown`, `pretty` |
| `--source <path>` | string | auto | Path to log directory or `running` for live container |

:::tip[GitHub Actions]
The `summary` command defaults to markdown format, making it perfect for piping directly to `$GITHUB_STEP_SUMMARY`.
:::

#### Examples

```bash
# Generate markdown summary (default)
awf logs summary

# Add to GitHub Actions step summary
awf logs summary >> $GITHUB_STEP_SUMMARY

# Get summary in JSON format
awf logs summary --format json

# Get summary with colorized terminal output
awf logs summary --format pretty
```

#### Example Output (Markdown)

```markdown
<details>
<summary>Firewall Activity</summary>

▼ 150 requests | 145 allowed | 5 blocked | 12 unique domains

| Domain | Allowed | Denied |
|--------|---------|--------|
| api.github.com | 50 | 0 |
| registry.npmjs.org | 95 | 0 |
| evil.com | 0 | 5 |

</details>
```

## See Also

- [Domain Filtering Guide](/gh-aw-firewall/guides/domain-filtering) - Allowlists, blocklists, and wildcards
- [SSL Bump Reference](/gh-aw-firewall/reference/ssl-bump/) - HTTPS content inspection and URL filtering
- [Quick Start Guide](/gh-aw-firewall/quickstart) - Getting started with examples
- [Usage Guide](/gh-aw-firewall/usage) - Detailed usage patterns and examples
- [Troubleshooting](/gh-aw-firewall/troubleshooting) - Common issues and solutions
- [Security Architecture](/gh-aw-firewall/reference/security-architecture) - How the firewall works internally
