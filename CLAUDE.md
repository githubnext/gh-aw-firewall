# AGENTS.md

This file provides guidance to coding agent when working with code in this repository.

## Project Overview

This is a firewall for GitHub Copilot CLI (package name: `@github/awf`) that provides L7 (HTTP/HTTPS) egress control using Squid proxy and Docker containers. The tool restricts network access to a whitelist of approved domains while maintaining full filesystem access for the Copilot CLI and its MCP servers.

### Documentation Files

- **[README.md](README.md)** - Main project documentation and usage guide
- **[docs/environment.md](docs/environment.md)** - Environment variable configuration and security best practices
- **[LOGGING.md](LOGGING.md)** - Comprehensive logging documentation
- **[docs/logging_quickref.md](docs/logging_quickref.md)** - Quick reference for log queries and monitoring

## Development Workflow

### Debugging GitHub Actions Failures

**IMPORTANT:** When GitHub Actions workflows fail, always follow this debugging workflow:

1. **Reproduce locally first** - Run the same commands/scripts that failed in CI on your local machine
2. **Understand the root cause** - Investigate logs, error messages, and system state to identify why it failed
3. **Test the fix locally** - Verify your solution works in your local environment
4. **Then update the action** - Only modify the GitHub Actions workflow after confirming the fix locally

This approach prevents trial-and-error debugging in CI (which wastes runner time and makes debugging slower) and ensures fixes address the actual root cause rather than symptoms.

**Downloading CI Logs for Local Analysis:**

Use `scripts/download-latest-artifact.sh` to download logs from GitHub Actions runs:

```bash
# Download logs from the latest integration test workflow run (default)
./scripts/download-latest-artifact.sh

# Download logs from a specific run ID
./scripts/download-latest-artifact.sh 1234567890

# Download from test-integration workflow (latest run)
./scripts/download-latest-artifact.sh "" ".github/workflows/test-integration.yml" "integration-test-logs"
```

**Parameters:**
- `RUN_ID` (optional): Specific workflow run ID, or empty string for latest run
- `WORKFLOW_FILE` (optional): Path to workflow file (default: `.github/workflows/test-integration.yml`)
- `ARTIFACT_NAME` (optional): Artifact name (default: `integration-test-logs`)

**Artifact name:**
- `integration-test-logs` - test-integration.yml

This downloads artifacts to `./artifacts-run-$RUN_ID` for local examination. Requires GitHub CLI (`gh`) authenticated with the repository.

**Example:** The "Pool overlaps" Docker network error was reproduced locally, traced to orphaned networks from `timeout`-killed processes, fixed by adding pre-test cleanup in scripts, then verified before updating workflows.

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

**For regular use:**
```bash
# Link locally for testing
npm link

# Use the CLI
awf --allow-domains github.com 'curl https://api.github.com'
```

**For sudo usage (required for iptables manipulation):**

Since `npm link` creates symlinks in the user's npm directory which isn't in root's PATH, you need to create a wrapper script in `/usr/local/bin/`:

```bash
# Build the project
npm run build

# Create sudo wrapper script
# Update the paths below to match your system:
# - NODE_PATH: Find with `which node` (example shows nvm installation)
# - PROJECT_PATH: Your cloned repository location
sudo tee /usr/local/bin/awf > /dev/null <<'EOF'
#!/bin/bash
NODE_PATH="$HOME/.nvm/versions/node/v22.13.0/bin/node"
PROJECT_PATH="$HOME/developer/gh-aw-firewall"

exec "$NODE_PATH" "$PROJECT_PATH/dist/cli.js" "$@"
EOF

sudo chmod +x /usr/local/bin/awf

# Verify it works
sudo awf --help
```

**Note:** After each `npm run build`, the wrapper automatically uses the latest compiled code. Update the paths in the wrapper script to match your node installation and project directory.

## Container Image Strategy

The firewall uses two Docker containers (Squid proxy and Copilot execution environment). By default, the CLI pulls pre-built images from GitHub Container Registry (GHCR) for faster startup and easier distribution.

**Default behavior (GHCR images):**
- Images are automatically pulled from `ghcr.io/githubnext/gh-aw-firewall/squid:latest` and `ghcr.io/githubnext/gh-aw-firewall/copilot:latest`
- Published during releases via `.github/workflows/release.yml`
- Users don't need to build containers locally

**Local build option:**
- Use `--build-local` flag to build containers from source
- Useful for development or when GHCR is unavailable
- Example: `sudo awf --build-local --allow-domains github.com 'curl https://github.com'`

**Custom registry/tag:**
- `--image-registry <registry>` - Use a different registry (default: `ghcr.io/githubnext/gh-aw-firewall`)
- `--image-tag <tag>` - Use a specific version tag (default: `latest`)
- Example: `sudo awf --image-tag v0.2.0 --allow-domains github.com 'curl https://github.com'`

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
   - All configs are written to a temporary work directory (default: `/tmp/awf-<timestamp>`)

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
- **Network:** Connected to `awf-net` at `172.30.0.10`
- **Firewall Exemption:** Allowed unrestricted outbound access via iptables rule `-s 172.30.0.10 -j ACCEPT`

**Copilot Container** (`containers/copilot/`)
- Based on `ubuntu:22.04` with iptables, curl, git, nodejs, npm, docker-cli
- Mounts entire host filesystem at `/host` and user home directory for full access
- Mounts Docker socket (`/var/run/docker.sock`) for docker-in-docker support
- `NET_ADMIN` capability required for iptables manipulation
- Two-stage entrypoint:
  1. `setup-iptables.sh`: Configures iptables NAT rules to redirect HTTP/HTTPS traffic to Squid (runner container only)
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
  - **Note:** These NAT rules only apply to the runner container itself, not spawned containers

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

The wrapper propagates the exit code from the runner container:
1. Command runs in runner container
2. Container exits with command's exit code
3. Wrapper inspects container: `docker inspect --format={{.State.ExitCode}}`
4. Wrapper exits with same code

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
- Containers by name (`awf-squid`, `awf-runner`)
- All docker-compose services from work directories
- Unused containers (`docker container prune -f`)
- Unused networks (`docker network prune -f`) - **critical for subnet pool management**
- Temporary directories (`/tmp/awf-*`)

**Note:** Test scripts use `timeout 60s` which can kill the wrapper before Stage 2/3 cleanup completes. Stage 1 (pre-test) and Stage 4 (always) prevent accumulation across test runs.

## Configuration Files

All temporary files are created in `workDir` (default: `/tmp/awf-<timestamp>`):
- `squid.conf`: Generated Squid proxy configuration
- `docker-compose.yml`: Generated Docker Compose configuration
- `runner-logs/`: Directory for Copilot CLI logs (automatically preserved if logs are created)
- `squid-logs/`: Directory for Squid proxy logs (automatically preserved if logs are created)

Use `--keep-containers` to preserve containers and files after execution for debugging.

## Log Streaming and Persistence

### Real-Time Log Streaming

The wrapper streams container logs in real-time using `docker logs -f`, allowing you to see output as commands execute rather than waiting until completion. This is implemented in `src/docker-manager.ts:runCopilotCommand()` which runs `docker logs -f` concurrently with `docker wait`.

**Note:** The container is configured with `tty: false` (line 202 in `src/docker-manager.ts`) to prevent ANSI escape sequences from appearing in log output. This provides cleaner, more readable streaming logs.

### Copilot Logs Preservation

Copilot CLI logs are automatically preserved for debugging:

**Directory Structure:**
- Container writes logs to: `~/.copilot/logs/` (Copilot's default location)
- Volume mount maps to: `${workDir}/runner-logs/`
- After cleanup: Logs moved to `/tmp/runner-logs-<timestamp>` (if they exist)

**Automatic Preservation:**
- If Copilot creates logs, they're automatically moved to `/tmp/runner-logs-<timestamp>/` before workDir cleanup
- Empty log directories are not preserved (avoids cluttering /tmp)
- You'll see: `[INFO] Runner logs preserved at: /tmp/runner-logs-<timestamp>` when logs exist

**With `--keep-containers`:**
- Logs remain at: `${workDir}/runner-logs/`
- All config files and containers are preserved
- You'll see: `[INFO] Runner logs available at: /tmp/awf-<timestamp>/runner-logs/`

**Usage Examples:**
```bash
# Logs automatically preserved (if created)
awf --allow-domains github.com \
  "npx @github/copilot@0.0.347 -p 'your prompt' --log-level debug --allow-all-tools"
# Output: [INFO] Runner logs preserved at: /tmp/runner-logs-1761073250147

# Increase log verbosity for debugging
awf --allow-domains github.com \
  "npx @github/copilot@0.0.347 -p 'your prompt' --log-level all --allow-all-tools"

# Keep everything for detailed inspection
awf --allow-domains github.com --keep-containers \
  "npx @github/copilot@0.0.347 -p 'your prompt' --log-level debug"
```

**Implementation Details:**
- Volume mount added in `src/docker-manager.ts:172`
- Log directory creation in `src/docker-manager.ts:247-252`
- Preservation logic in `src/docker-manager.ts:540-550` (cleanup function)

### Squid Logs Preservation

Squid proxy logs are automatically preserved for debugging network traffic:

**Directory Structure:**
- Container writes logs to: `/var/log/squid/` (Squid's default location)
- Volume mount maps to: `${workDir}/squid-logs/`
- After cleanup: Logs moved to `/tmp/squid-logs-<timestamp>` (if they exist)

**Automatic Preservation:**
- If Squid creates logs, they're automatically moved to `/tmp/squid-logs-<timestamp>/` before workDir cleanup
- Empty log directories are not preserved (avoids cluttering /tmp)
- You'll see: `[INFO] Squid logs preserved at: /tmp/squid-logs-<timestamp>` when logs exist

**With `--keep-containers`:**
- Logs remain at: `${workDir}/squid-logs/`
- All config files and containers are preserved
- You'll see: `[INFO] Squid logs available at: /tmp/awf-<timestamp>/squid-logs/`

**Log Files:**
- `access.log`: All HTTP/HTTPS traffic with custom format showing domains, IPs, and allow/deny decisions
- `cache.log`: Squid internal diagnostic messages

**Viewing Logs:**
```bash
# Logs are owned by the 'proxy' user (from container), requires sudo on host
sudo cat /tmp/squid-logs-<timestamp>/access.log

# Example log entries:
# Allowed: TCP_TUNNEL:HIER_DIRECT with status 200
# Denied: TCP_DENIED:HIER_NONE with status 403
```

**Usage Examples:**
```bash
# Check which domains were blocked
sudo grep "TCP_DENIED" /tmp/squid-logs-<timestamp>/access.log

# View all traffic
sudo cat /tmp/squid-logs-<timestamp>/access.log
```

**Implementation Details:**
- Volume mount in `src/docker-manager.ts:135`
- Log directory creation in `src/docker-manager.ts:254-261`
- Entrypoint script fixes permissions: `containers/squid/entrypoint.sh`
- Preservation logic in `src/docker-manager.ts:552-562` (cleanup function)

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

## MCP Server Configuration for Copilot CLI

### Overview

GitHub Copilot CLI v0.0.347+ includes a **built-in GitHub MCP server** that connects to a read-only remote endpoint (`https://api.enterprise.githubcopilot.com/mcp/readonly`). This built-in server takes precedence over local MCP configurations by default, which prevents write operations like creating issues or pull requests.

To use a local, writable GitHub MCP server with Copilot CLI, you must:
1. Configure the MCP server in the correct location with the correct format
2. Disable the built-in GitHub MCP server
3. Ensure proper environment variable passing

### Correct MCP Configuration

**Location:** The MCP configuration must be placed at:
- `~/.copilot/mcp-config.json` (primary location)

The runner container mounts the HOME directory, so this config file is automatically accessible to Copilot CLI running inside the container.

**Format:**
```json
{
  "mcpServers": {
    "github": {
      "type": "local",
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "-e",
        "GITHUB_TOOLSETS=default",
        "ghcr.io/github/github-mcp-server:v0.19.0"
      ],
      "tools": ["*"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
      }
    }
  }
}
```

**Key Requirements:**
- ✅ **`"tools": ["*"]`** - Required field. Use `["*"]` to enable all tools, or list specific tool names
  - ⚠️ Empty array `[]` means NO tools will be available
- ✅ **`"type": "local"`** - Required to specify local MCP server type
- ✅ **`"env"` section** - Environment variables must be declared here with `${VAR}` syntax for interpolation
- ✅ **Environment variable in args** - Use bare variable names in `-e` flags (e.g., `"GITHUB_PERSONAL_ACCESS_TOKEN"` without `$`)
- ✅ **Shell environment** - Variables must be exported in the shell before running awf
- ✅ **MCP server name** - Use `"github"` as the server name (must match `--allow-tool` flag)

### Running Copilot CLI with Local MCP Through Firewall

**Required setup:**
```bash
# Export environment variables (both required)
export GITHUB_TOKEN="<your-copilot-cli-token>"           # For Copilot CLI authentication
export GITHUB_PERSONAL_ACCESS_TOKEN="<your-github-pat>"  # For GitHub MCP server

# Run awf with sudo -E to preserve environment variables
sudo -E awf \
  --allow-domains raw.githubusercontent.com,api.github.com,github.com,registry.npmjs.org,api.enterprise.githubcopilot.com \
  "npx @github/copilot@0.0.347 \
    --disable-builtin-mcps \
    --allow-tool github \
    --prompt 'your prompt here'"
```

**Critical requirements:**
- `sudo -E` - **REQUIRED** to pass environment variables through sudo to the runner container
- `--disable-builtin-mcps` - Disables the built-in read-only GitHub MCP server
- `--allow-tool github` - Grants permission to use all tools from the `github` MCP server (must match server name in config)
- MCP config at `~/.copilot/mcp-config.json` - Automatically accessible since runner container mounts HOME directory

**Why `sudo -E` is required:**
1. `awf` needs sudo for iptables manipulation
2. `-E` preserves GITHUB_TOKEN and GITHUB_PERSONAL_ACCESS_TOKEN
3. These variables are passed into the runner container via the HOME directory mount
4. The GitHub MCP server Docker container inherits them from the runner container's environment

### Troubleshooting

**Problem:** MCP server starts but says "GITHUB_PERSONAL_ACCESS_TOKEN not set"
- **Cause:** Environment variable not passed correctly through sudo or to Docker container
- **Solution:** Use `sudo -E` when running awf, and ensure the variable is exported before running the command

**Problem:** MCP config validation error: "Invalid input"
- **Cause:** Missing `"tools"` field
- **Solution:** Add `"tools": ["*"]` to the MCP server config

**Problem:** Copilot uses read-only remote MCP instead of local
- **Cause:** Built-in MCP not disabled
- **Solution:** Add `--disable-builtin-mcps` flag to the copilot command

**Problem:** Tools not available even with local MCP
- **Cause:** Wrong server name in `--allow-tool` flag
- **Solution:** Use `--allow-tool github` (must match the server name in mcp-config.json)

**Problem:** Permission denied when running awf
- **Cause:** iptables requires root privileges
- **Solution:** Use `sudo -E awf` (not just `sudo awf`)

### Verifying Local MCP Usage

Check Copilot CLI logs (use `--log-level debug`) for these indicators:

**Local MCP working:**
```
Starting MCP client for github with command: docker
GitHub MCP Server running on stdio
readOnly=false
MCP client for github connected
```

**Built-in remote MCP (not what you want):**
```
Using Copilot API endpoint: https://api.enterprise.githubcopilot.com/mcp/readonly
Starting remote MCP client for github-mcp-server
```

### CI/CD Configuration

For GitHub Actions workflows:
1. Create MCP config script that writes to `~/.copilot/mcp-config.json` (note: `~` = `/home/runner` in GitHub Actions)
2. Export both `GITHUB_TOKEN` (for Copilot CLI) and `GITHUB_PERSONAL_ACCESS_TOKEN` (for GitHub MCP server) as environment variables
3. Pull the MCP server Docker image before running tests: `docker pull ghcr.io/github/github-mcp-server:v0.19.0`
4. Run awf with `sudo -E` to preserve environment variables
5. Always use `--disable-builtin-mcps` and `--allow-tool github` flags when running Copilot CLI

**Example workflow step:**
```yaml
- name: Test Copilot CLI with GitHub MCP through firewall
  env:
    GITHUB_TOKEN: ${{ secrets.COPILOT_CLI_TOKEN }}
    GITHUB_PERSONAL_ACCESS_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    sudo -E awf \
      --allow-domains raw.githubusercontent.com,api.github.com,github.com,registry.npmjs.org,api.enterprise.githubcopilot.com \
      "npx @github/copilot@0.0.347 \
        --disable-builtin-mcps \
        --allow-tool github \
        --log-level debug \
        --prompt 'your prompt here'"
```

## Logging Implementation

### Overview

The firewall implements comprehensive logging at two levels:

1. **Squid Proxy Logs (L7)** - All HTTP/HTTPS traffic (allowed and blocked)
2. **iptables Kernel Logs (L3/L4)** - Non-HTTP protocols and UDP traffic

### Key Files

- `src/squid-config.ts` - Generates Squid config with custom `firewall_detailed` logformat
- `containers/copilot/setup-iptables.sh` - Configures iptables LOG rules for rejected traffic
- `src/squid-config.test.ts` - Tests for logging configuration

### Squid Log Format

Custom format defined in `src/squid-config.ts:40`:
```
logformat firewall_detailed %ts.%03tu %>a:%>p %{Host}>h %<a:%<p %rv %rm %>Hs %Ss:%Sh %ru "%{User-Agent}>h"
```

Captures:
- Timestamp with milliseconds
- Client IP:port
- Domain (Host header / SNI)
- Destination IP:port
- Protocol version
- HTTP method
- Status code (200=allowed, 403=blocked)
- Decision code (TCP_TUNNEL=allowed, TCP_DENIED=blocked)
- URL
- User agent

### iptables Logging

Two LOG rules in `setup-iptables.sh`:

1. **Line 80** - `[FW_BLOCKED_UDP]` prefix for blocked UDP traffic
2. **Line 95** - `[FW_BLOCKED_OTHER]` prefix for other blocked traffic

Both use `--log-uid` flag to capture process UID.

### Testing Logging

Run tests:
```bash
npm test -- squid-config.test.ts
```

Manual testing:
```bash
# Test blocked traffic
awf --allow-domains example.com --keep-containers 'curl https://github.com'

# View logs
docker exec awf-squid cat /var/log/squid/access.log
```

### Important Notes

- Squid logs use Unix timestamps (convert with `date -d @TIMESTAMP`)
- Decision codes: `TCP_DENIED:HIER_NONE` = blocked, `TCP_TUNNEL:HIER_DIRECT` = allowed
- SNI is captured via CONNECT method for HTTPS (no SSL inspection)
- iptables logs go to kernel buffer (view with `dmesg`)
- PID not directly available (UID can be used for correlation)
