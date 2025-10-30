# Architecture

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
- Orchestrates the entire workflow: config generation → container startup → command execution → cleanup
- Handles signal interrupts (SIGINT/SIGTERM) for graceful shutdown
- Main flow: `writeConfigs()` → `startContainers()` → `runCopilotCommand()` → `stopContainers()` → `cleanup()`

### 2. Configuration Generation
- **`src/squid-config.ts`**: Generates Squid proxy configuration with domain ACL rules
- **`src/docker-manager.ts`**: Generates Docker Compose YAML with two services (squid-proxy, copilot)
- All configs are written to a temporary work directory (default: `/tmp/awf-<timestamp>`)

### 3. Docker Management (`src/docker-manager.ts`)
- Manages container lifecycle using `execa` to run docker-compose commands
- Fixed network topology: `172.30.0.0/24` subnet, Squid at `172.30.0.10`, Copilot at `172.30.0.20`
- Squid container uses healthcheck; Copilot waits for Squid to be healthy before starting

### 4. Type Definitions (`src/types.ts`)
- `WrapperConfig`: Main configuration interface
- `SquidConfig`, `DockerComposeConfig`: Typed configuration objects

### 5. Logging (`src/logger.ts`)
- Singleton logger with configurable log levels (trace, debug, info, warn, error)
- Uses `chalk` for colored output
- All logs go to stderr (console.error) to avoid interfering with command stdout

## Container Architecture

### Squid Container (`containers/squid/`)
- Based on `ubuntu/squid:latest`
- Mounts dynamically-generated `squid.conf` from work directory
- Exposes port 3128 for proxy traffic
- Logs to shared volume `squid-logs:/var/log/squid`
- **Network:** Connected to `awf-net` at `172.30.0.10`
- **Firewall Exemption:** Allowed unrestricted outbound access via iptables rule `-s 172.30.0.10 -j ACCEPT`

### Copilot Container (`containers/copilot/`)
- Based on `ubuntu:22.04` with iptables, curl, git, nodejs, npm, docker-cli
- Mounts entire host filesystem at `/host` and user home directory for full access
- Mounts Docker socket (`/var/run/docker.sock`) for docker-in-docker support
- `NET_ADMIN` capability required for iptables manipulation
- Two-stage entrypoint:
  1. `setup-iptables.sh`: Configures iptables NAT rules to redirect HTTP/HTTPS traffic to Squid (copilot container only)
  2. `entrypoint.sh`: Tests connectivity, then executes user command
- **Docker Wrapper** (`docker-wrapper.sh`): Intercepts `docker run` commands to inject network and proxy configuration
  - Symlinked at `/usr/bin/docker` (real docker at `/usr/bin/docker-real`)
  - Automatically injects `--network awf-net` to all spawned containers
  - Injects proxy environment variables: `HTTP_PROXY`, `HTTPS_PROXY`, `http_proxy`, `https_proxy`
  - Logs all intercepted commands to `/tmp/docker-wrapper.log` for debugging
- Key iptables rules (in `setup-iptables.sh`):
  - Allow localhost traffic (for stdio MCP servers)
  - Allow DNS queries
  - Allow traffic to Squid proxy itself
  - Redirect all HTTP (port 80) and HTTPS (port 443) to Squid via DNAT (NAT table)
  - **Note:** These NAT rules only apply to the copilot container itself, not spawned containers

## Traffic Flow

```
User Command
    ↓
CLI generates configs (squid.conf, docker-compose.yml)
    ↓
Docker Compose starts Squid container (with healthcheck)
    ↓
Docker Compose starts Copilot container (waits for Squid healthy)
    ↓
iptables rules applied in Copilot container
    ↓
User command executes in Copilot container
    ↓
All HTTP/HTTPS traffic → iptables DNAT → Squid proxy → domain ACL filtering
    ↓
Containers stopped, temporary files cleaned up
```

## How It Works

### 1. Configuration Generation
The wrapper generates:
- **Squid configuration** with domain ACLs
- **Docker Compose** configuration for both containers
- **Temporary work directory** for configs and logs

### 2. Container Startup
1. **Squid proxy starts first** with healthcheck
2. **Copilot container waits** for Squid to be healthy
3. **iptables rules applied** in copilot container to redirect all HTTP/HTTPS traffic

### 3. Traffic Routing
- All HTTP (port 80) and HTTPS (port 443) traffic → Squid proxy
- Squid filters based on domain whitelist
- Localhost traffic exempt (for stdio MCP servers)
- DNS queries allowed (for name resolution)

### 4. MCP Server Handling
- **Stdio MCP servers**: Run as child processes, no network needed
- **HTTP MCP servers**: Traffic routed through Squid proxy
- **Docker MCP servers**: Share network namespace, inherit restrictions

### 5. Log Streaming
- Container logs streamed in real-time using `docker logs -f`
- TTY disabled to prevent ANSI escape sequences
- Copilot and Squid logs preserved to `/tmp/*-logs-<timestamp>/` (if created)

### 6. Cleanup
- Containers stopped and removed
- Logs moved to persistent locations:
  - Copilot logs → `/tmp/copilot-logs-<timestamp>/` (if they exist)
  - Squid logs → `/tmp/squid-logs-<timestamp>/` (if they exist)
- Temporary files deleted (unless `--keep-containers` specified)
- Exit code propagated from copilot command

## Cleanup Lifecycle

The system uses a defense-in-depth cleanup strategy across four stages to prevent Docker resource leaks:

### 1. Pre-Test Cleanup (CI/CD Scripts)
**Location:** `scripts/ci/test-copilot-*.sh` (start of each script)
**What:** Runs `cleanup.sh` to remove orphaned resources from previous failed runs
**Why:** Prevents Docker network subnet pool exhaustion and container name conflicts
**Critical:** Without this, `timeout` commands that kill the wrapper mid-cleanup leave networks/containers behind

### 2. Normal Exit Cleanup (Built-in)
**Location:** `src/cli.ts:117-118` (`performCleanup()`)
**What:**
- `stopContainers()` → `docker compose down -v` (stops containers, removes volumes)
- `cleanup()` → Deletes workDir (`/tmp/awf-<timestamp>`)
**Trigger:** Successful command completion

### 3. Signal/Error Cleanup (Built-in)
**Location:** `src/cli.ts:95-103, 122-126` (SIGINT/SIGTERM handlers, catch blocks)
**What:** Same as normal exit cleanup
**Trigger:** User interruption (Ctrl+C), timeout signals, or errors
**Limitation:** Cannot catch SIGKILL (9) from `timeout` after grace period

### 4. CI/CD Always Cleanup
**Location:** `.github/workflows/test-copilot-*.yml` (`if: always()`)
**What:** Runs `cleanup.sh` regardless of job status
**Why:** Safety net for SIGKILL, job cancellation, and unexpected failures

### Cleanup Script (`scripts/ci/cleanup.sh`)
Removes all awf resources:
- Containers by name (`awf-squid`, `awf-copilot`)
- All docker-compose services from work directories
- Unused containers (`docker container prune -f`)
- Unused networks (`docker network prune -f`) - **critical for subnet pool management**
- Temporary directories (`/tmp/awf-*`)

**Note:** Test scripts use `timeout 60s` which can kill the wrapper before Stage 2/3 cleanup completes. Stage 1 (pre-test) and Stage 4 (always) prevent accumulation across test runs.

## Domain Whitelisting

- Domains in `--allow-domains` are normalized (protocol/trailing slash removed)
- Both exact matches and subdomain matches are added to Squid ACL:
  - `github.com` → matches `github.com` and `.github.com` (subdomains)
  - `.github.com` → matches all subdomains
- Squid denies any domain not in the allowlist

## Exit Code Handling

The wrapper propagates the exit code from the copilot container:
1. Command runs in copilot container
2. Container exits with command's exit code
3. Wrapper inspects container: `docker inspect --format={{.State.ExitCode}}`
4. Wrapper exits with same code

## Configuration Files

All temporary files are created in `workDir` (default: `/tmp/awf-<timestamp>`):
- `squid.conf`: Generated Squid proxy configuration
- `docker-compose.yml`: Generated Docker Compose configuration
- `copilot-logs/`: Directory for Copilot CLI logs (automatically preserved if logs are created)
- `squid-logs/`: Directory for Squid proxy logs (automatically preserved if logs are created)

Use `--keep-containers` to preserve containers and files after execution for debugging.

## Key Dependencies

- `commander`: CLI argument parsing
- `chalk`: Colored terminal output
- `execa`: Subprocess execution (docker-compose commands)
- `js-yaml`: YAML generation for Docker Compose config
- TypeScript 5.x, compiled to ES2020 CommonJS
