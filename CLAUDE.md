# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a firewall wrapper for GitHub Copilot CLI (package name: `@github/firewall-wrapper`) that provides L7 (HTTP/HTTPS) egress control using Squid proxy and Docker containers. The tool restricts network access to a whitelist of approved domains while maintaining full filesystem access for the Copilot CLI and its MCP servers.

## Development Commands

### Build and Testing
```bash
# Build TypeScript to dist/
npm run build

# Watch mode (rebuilds on changes)
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm test:watch

# Lint TypeScript files
npm run lint

# Clean build artifacts
npm run clean
```

### Local Installation
```bash
# Link locally for testing
npm link

# Use the CLI
firewall-wrapper --allow-domains github.com 'curl https://api.github.com'
```

## Architecture

The codebase follows a modular architecture with clear separation of concerns:

### Core Components

1. **CLI Entry Point** (`src/cli.ts`)
   - Uses `commander` for argument parsing
   - Orchestrates the entire workflow: config generation → container startup → command execution → cleanup
   - Handles signal interrupts (SIGINT/SIGTERM) for graceful shutdown
   - Main flow: `writeConfigs()` → `startContainers()` → `runCopilotCommand()` → `stopContainers()` → `cleanup()`

2. **Configuration Generation** (`src/squid-config.ts`, `src/docker-manager.ts`)
   - `generateSquidConfig()`: Creates Squid proxy configuration with domain ACL rules
   - `generateDockerCompose()`: Creates Docker Compose YAML with two services (squid-proxy, copilot)
   - All configs are written to a temporary work directory (default: `/tmp/firewall-wrapper-<timestamp>`)

3. **Docker Management** (`src/docker-manager.ts`)
   - Manages container lifecycle using `execa` to run docker-compose commands
   - Fixed network topology: `172.30.0.0/24` subnet, Squid at `172.30.0.10`, Copilot at `172.30.0.20`
   - Squid container uses healthcheck; Copilot waits for Squid to be healthy before starting

4. **Type Definitions** (`src/types.ts`)
   - `WrapperConfig`: Main configuration interface
   - `SquidConfig`, `DockerComposeConfig`: Typed configuration objects

5. **Logging** (`src/logger.ts`)
   - Singleton logger with configurable log levels (debug, info, warn, error)
   - Uses `chalk` for colored output
   - All logs go to stderr (console.error) to avoid interfering with command stdout

### Container Architecture

**Squid Container** (`containers/squid/`)
- Based on `ubuntu/squid:latest`
- Mounts dynamically-generated `squid.conf` from work directory
- Exposes port 3128 for proxy traffic
- Logs to shared volume `squid-logs:/var/log/squid`

**Copilot Container** (`containers/copilot/`)
- Based on `ubuntu:22.04` with iptables, curl, git, nodejs, npm
- Mounts entire host filesystem at `/host` and user home directory for full access
- `NET_ADMIN` capability required for iptables manipulation
- Two-stage entrypoint:
  1. `setup-iptables.sh`: Configures iptables NAT rules to redirect HTTP/HTTPS traffic to Squid
  2. `entrypoint.sh`: Tests connectivity, then executes user command
- Key iptables rules (in `setup-iptables.sh`):
  - Allow localhost traffic (for stdio MCP servers)
  - Allow DNS queries
  - Allow traffic to Squid proxy itself
  - Redirect all HTTP (port 80) and HTTPS (port 443) to Squid via DNAT

### Traffic Flow

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

All temporary files are created in `workDir` (default: `/tmp/firewall-wrapper-<timestamp>`):
- `squid.conf`: Generated Squid proxy configuration
- `docker-compose.yml`: Generated Docker Compose configuration

Use `--keep-containers` to preserve containers and files after execution for debugging.

## Key Dependencies

- `commander`: CLI argument parsing
- `chalk`: Colored terminal output
- `execa`: Subprocess execution (docker-compose commands)
- `js-yaml`: YAML generation for Docker Compose config
- TypeScript 5.x, compiled to ES2020 CommonJS

## Testing Notes

- Tests use Jest (`npm test`)
- Currently no test files exist (tsconfig excludes `**/*.test.ts`)
- Integration testing: Run commands with `--log-level debug` and `--keep-containers` to inspect generated configs and container logs
