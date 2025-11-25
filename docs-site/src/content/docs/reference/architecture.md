---
title: Architecture
description: Technical architecture of the Agentic Workflow Firewall
---

## Overview

The firewall uses a containerized architecture with Squid proxy for L7 (HTTP/HTTPS) egress control. The system provides domain-based whitelisting while maintaining full filesystem access for the Copilot CLI and its MCP servers.

## High-Level Architecture

```
┌─────────────────────────────────────────┐
│  Host (GitHub Actions Runner / Local)   │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │   Firewall CLI                    │ │
│  │   - Parse arguments                │ │
│  │   - Generate Squid config          │ │
│  │   - Start Docker Compose           │ │
│  └────────────────────────────────────┘ │
│           │                              │
│           ▼                              │
│  ┌──────────────────────────────────┐   │
│  │   Docker Compose                 │   │
│  │  ┌────────────────────────────┐  │   │
│  │  │  Squid Proxy Container     │  │   │
│  │  │  - Domain ACL filtering    │  │   │
│  │  │  - HTTP/HTTPS proxy        │  │   │
│  │  └────────────────────────────┘  │   │
│  │           ▲                       │   │
│  │  ┌────────┼───────────────────┐  │   │
│  │  │ Copilot Container          │  │   │
│  │  │ - Full filesystem access   │  │   │
│  │  │ - iptables redirect        │  │   │
│  │  │ - Spawns MCP servers       │  │   │
│  │  │ - All traffic → Squid      │  │   │
│  │  └────────────────────────────┘  │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

## Core Components

### 1. CLI Entry Point (`src/cli.ts`)
- Uses `commander` for argument parsing
- Orchestrates: config generation → container startup → command execution → cleanup
- Handles signal interrupts (SIGINT/SIGTERM) for graceful shutdown
- Main flow: `writeConfigs()` → `startContainers()` → `runCopilotCommand()` → `stopContainers()` → `cleanup()`

### 2. Configuration Generation
- **`src/squid-config.ts`**: Generates Squid proxy configuration with domain ACL rules
- **`src/docker-manager.ts`**: Generates Docker Compose YAML with two services
- All configs written to temporary work directory (`/tmp/awf-<timestamp>`)

### 3. Docker Management
- Manages container lifecycle using `execa` to run docker-compose commands
- Fixed network topology: `172.30.0.0/24` subnet
  - Squid at `172.30.0.10`
  - Copilot at `172.30.0.20`
- Squid healthcheck ensures proxy is ready before Copilot starts

### 4. Type Definitions (`src/types.ts`)
- `WrapperConfig`: Main configuration interface
- `SquidConfig`, `DockerComposeConfig`: Typed configuration objects

### 5. Logging (`src/logger.ts`)
- Singleton logger with configurable log levels
- Uses `chalk` for colored output
- All logs to stderr to avoid interfering with command stdout

## Container Architecture

### Squid Container
- Based on `ubuntu/squid:latest`
- Mounts dynamically-generated `squid.conf`
- Exposes port 3128 for proxy traffic
- Logs to volume: `squid-logs:/var/log/squid`
- **Network:** `awf-net` at `172.30.0.10`
- **Firewall Exemption:** Unrestricted outbound via iptables rule

### Copilot Container
- Based on `ubuntu:22.04`
- Includes: iptables, curl, git, nodejs, npm, docker-cli
- Mounts:
  - Host filesystem at `/host`
  - User home directory
  - Docker socket for docker-in-docker
- Capabilities: `NET_ADMIN` for iptables manipulation

**Two-stage entrypoint:**
1. `setup-iptables.sh`: Configures NAT rules to redirect HTTP/HTTPS to Squid
2. `entrypoint.sh`: Tests connectivity, executes user command

**Docker Wrapper** (`docker-wrapper.sh`):
- Intercepts `docker run` commands
- Injects `--network awf-net` to spawned containers
- Injects proxy environment variables
- Logs to `/tmp/docker-wrapper.log`

**Key iptables rules:**
- Allow localhost (for stdio MCP servers)
- Allow DNS queries
- Allow traffic to Squid proxy
- Redirect HTTP (80) and HTTPS (443) to Squid via DNAT

## Traffic Flow

```
User Command
    ↓
CLI generates configs (squid.conf, docker-compose.yml)
    ↓
Docker Compose starts Squid (with healthcheck)
    ↓
Docker Compose starts Copilot (waits for Squid healthy)
    ↓
iptables rules applied in Copilot container
    ↓
User command executes
    ↓
All HTTP/HTTPS traffic → iptables DNAT → Squid → domain ACL
    ↓
Containers stopped, temporary files cleaned up
```

## Domain Whitelisting

- Domains normalized (protocol/trailing slash removed)
- Both exact and subdomain matches added to Squid ACL:
  - `github.com` → matches `github.com` and `.github.com`
- Squid denies any domain not in allowlist

## Exit Code Handling

1. Command runs in copilot container
2. Container exits with command's exit code
3. Wrapper inspects: `docker inspect --format={{.State.ExitCode}}`
4. Wrapper exits with same code

## Security Model

### What This Protects Against
- Unauthorized egress to non-whitelisted domains
- Data exfiltration via HTTP/HTTPS
- MCP servers accessing unexpected endpoints
- DNS poisoning attacks (`--add-host` blocked)
- Firewall bypass attempts (`--network host`, `--privileged` blocked)

### Attack Surface
- Stdio MCP servers: Unrestricted (run on localhost)
- Non-HTTP protocols: Not filtered (UDP, raw TCP)
- IPv6 traffic: Not supported/filtered
