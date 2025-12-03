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
| `--log-level <level>` | string | `info` | Logging verbosity: `debug`, `info`, `warn`, `error` |
| `--keep-containers` | flag | `false` | Keep containers running after command exits |
| `--tty` | flag | `false` | Allocate pseudo-TTY for interactive tools |
| `--work-dir <dir>` | string | `/tmp/awf-<timestamp>` | Working directory for temporary files |
| `--build-local` | flag | `false` | Build containers locally instead of pulling from registry |
| `--image-registry <url>` | string | `ghcr.io/githubnext/gh-aw-firewall` | Container image registry |
| `--image-tag <tag>` | string | `latest` | Container image tag |
| `-e, --env <KEY=VALUE>` | string | `[]` | Environment variable (repeatable) |
| `--env-all` | flag | `false` | Pass all host environment variables |
| `-v, --mount <host:container[:mode]>` | string | `[]` | Volume mount (repeatable) |
| `--container-workdir <dir>` | string | User home | Working directory inside container |
| `--dns-servers <servers>` | string | `8.8.8.8,8.8.4.4` | Trusted DNS servers (comma-separated) |
| `-V, --version` | flag | — | Display version |
| `-h, --help` | flag | — | Display help |

## Options Details

### `--allow-domains <domains>`

Comma-separated list of allowed domains. Domains automatically match all subdomains.

```bash
--allow-domains github.com,npmjs.org
```

### `--allow-domains-file <path>`

Path to file with allowed domains. Supports comments (`#`) and one domain per line.

```bash
--allow-domains-file ./allowed-domains.txt
```

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
- Docker socket at `/var/run/docker.sock`

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
```

:::note
Log sources are auto-discovered in this order: running containers, `AWF_LOGS_DIR` environment variable, then preserved log directories in `/tmp/squid-logs-*`.
:::

## See Also

- [Quick Start Guide](/gh-aw-firewall/quickstart) - Getting started with examples
- [Usage Guide](/gh-aw-firewall/usage) - Detailed usage patterns and examples
- [Troubleshooting](/gh-aw-firewall/troubleshooting) - Common issues and solutions
- [Security Architecture](/gh-aw-firewall/reference/security-architecture) - How the firewall works internally
