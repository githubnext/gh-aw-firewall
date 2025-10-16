# CI Test Scripts

This directory contains bash scripts used for testing the awf with GitHub Copilot CLI and MCP servers in CI/CD environments.

## Scripts

### 1. `setup-mcp-config.sh`

Sets up the MCP configuration file for the GitHub MCP server.

**Usage:**
```bash
./scripts/ci/setup-mcp-config.sh [config_dir]
```

**Arguments:**
- `config_dir` (optional): Directory to create MCP config in (default: `$HOME/.config/copilot`)

**Environment Variables:**
- `GITHUB_PERSONAL_ACCESS_TOKEN`: GitHub PAT for MCP server (optional)

**Example:**
```bash
export GITHUB_PERSONAL_ACCESS_TOKEN="ghp_xxxx"
./scripts/ci/setup-mcp-config.sh /home/runner/.config/copilot
```

### 2. `test-docker-diagnostics.sh`

Runs Docker and MCP diagnostics inside the copilot container through the awf. This tests:
- Environment variables are correctly passed through
- MCP config is accessible inside the container
- Docker commands work inside the container
- GitHub MCP server can be started manually

**Usage:**
```bash
./scripts/ci/test-docker-diagnostics.sh
```

**Environment Variables:**
- `GITHUB_TOKEN`: GitHub token for Copilot CLI
- `GITHUB_PERSONAL_ACCESS_TOKEN`: GitHub PAT for MCP server
- `XDG_CONFIG_HOME`: Config home directory (default: `$HOME`)
- `ALLOWED_DOMAINS`: Comma-separated list of allowed domains (default: `raw.githubusercontent.com,api.github.com,github.com,registry.npmjs.org`)
- `LOG_FILE`: Path to save diagnostic logs (default: `/tmp/docker-mcp-diagnostics.log`)

**Example:**
```bash
export GITHUB_TOKEN="ghp_copilot_token"
export GITHUB_PERSONAL_ACCESS_TOKEN="ghp_xxxx"
export XDG_CONFIG_HOME="/home/runner"
./scripts/ci/test-docker-diagnostics.sh
```

### 3. `test-copilot-mcp.sh`

Tests Copilot CLI with GitHub MCP server through the firewall. Runs two tests:
1. Simple MCP prompt (without explicit tool permissions)
2. Issue creation with explicit tool permissions

**Usage:**
```bash
./scripts/ci/test-copilot-mcp.sh
```

**Environment Variables:**
- `GITHUB_TOKEN`: GitHub token for Copilot CLI (required)
- `GITHUB_PERSONAL_ACCESS_TOKEN`: GitHub PAT for MCP server (required)
- `XDG_CONFIG_HOME`: Config home directory (default: `$HOME`)
- `COPILOT_VERSION`: Copilot CLI version to use (default: `0.0.343`)
- `GITHUB_REPOSITORY`: Repository slug for issue creation (default: `githubnext/gh-aw-firewall`)
- `GITHUB_RUN_ID`: Workflow run ID for issue body (optional)
- `GITHUB_SERVER_URL`: GitHub server URL for issue body (optional)

**Example:**
```bash
export GITHUB_TOKEN="ghp_copilot_token"
export GITHUB_PERSONAL_ACCESS_TOKEN="ghp_xxxx"
export XDG_CONFIG_HOME="/home/runner"
export GITHUB_REPOSITORY="githubnext/gh-aw-firewall"
./scripts/ci/test-copilot-mcp.sh
```

**Output:**
- `/tmp/copilot-simple-prompt.log`: Test 1 stdout/stderr
- `/tmp/copilot-output.log`: Test 2 stdout/stderr
- `/tmp/copilot-logs-test1/`: Test 1 Copilot debug logs
- `/tmp/copilot-logs-test2/`: Test 2 Copilot debug logs

### 4. `cleanup.sh`

Cleans up Docker containers, networks, and temporary files created by awf tests.

**Usage:**
```bash
./scripts/ci/cleanup.sh
```

This script will:
- Stop and remove docker compose services
- Prune unused containers
- Prune unused networks (fixes "Pool overlaps" errors)
- Remove temporary work directories (`/tmp/awf-*`)

**Example:**
```bash
./scripts/ci/cleanup.sh
```

## Testing Locally

To run the full test suite locally:

```bash
# 1. Build the project
npm run build
npm link

# 2. Pull GitHub MCP server image
docker pull ghcr.io/github/github-mcp-server:v0.18.0

# 3. Set up environment variables
export GITHUB_TOKEN="your_copilot_cli_token"
export GITHUB_PERSONAL_ACCESS_TOKEN="your_github_token"
export XDG_CONFIG_HOME="$HOME"

# 4. Run cleanup (optional, if previous runs left resources)
./scripts/ci/cleanup.sh

# 5. Set up MCP config
./scripts/ci/setup-mcp-config.sh "$HOME/.config/copilot"

# 6. Run diagnostics
./scripts/ci/test-docker-diagnostics.sh

# 7. Run Copilot CLI tests
./scripts/ci/test-copilot-mcp.sh

# 8. Clean up
./scripts/ci/cleanup.sh
```

## Troubleshooting

### "Pool overlaps with other one on this address space"

This error occurs when Docker networks from previous runs weren't cleaned up properly. Run:

```bash
./scripts/ci/cleanup.sh
# or manually:
docker network prune -f
```

### MCP config not found inside container

Check that:
1. `XDG_CONFIG_HOME` is set correctly
2. The config file exists on the host: `ls -la $HOME/.config/copilot/mcp-config.json`
3. The awf is mounting the home directory correctly

### Docker commands fail inside container

The awf container needs:
1. `/var/run/docker.sock` mounted (for Docker access)
2. `NET_ADMIN` capability (for iptables rules)
3. Access to the Docker CLI binary

Check the Docker Compose configuration in the generated files.
