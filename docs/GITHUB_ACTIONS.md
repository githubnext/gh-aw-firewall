# GitHub Actions Integration

## Installation in GitHub Actions

In GitHub Actions workflows, the runner already has root access:

```yaml
- name: Checkout awf
  uses: actions/checkout@v4
  with:
    repository: github/awf
    path: awf

- name: Install awf
  run: |
    cd awf
    npm install
    npm run build
    # Create sudo wrapper for runner
    sudo tee /usr/local/bin/awf > /dev/null <<'EOF'
    #!/bin/bash
    exec $(which node) $(pwd)/dist/cli.js "$@"
    EOF
    sudo chmod +x /usr/local/bin/awf
```

## Example Workflow

```yaml
name: Test Firewall

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Firewall
        run: |
          npm install
          npm run build
          npm link

      - name: Install GitHub Copilot CLI
        run: npm install -g @github/copilot@latest

      - name: Test with Copilot
        env:
          GITHUB_TOKEN: ${{ secrets.COPILOT_CLI_TOKEN }}
        run: |
          awf \
            --allow-domains github.com,api.github.com,githubusercontent.com \
            'copilot --help'
```

## Replacing Manual Proxy Setup

If you currently have manual Squid proxy configuration, you can replace it with the firewall:

**Before (Manual Setup):**
```yaml
- name: Setup Proxy Configuration
  run: |
    cat > squid.conf << 'EOF'
    # ... squid config ...
    EOF

- name: Start Squid proxy
  run: |
    docker compose -f docker-compose.yml up -d
    iptables ...
```

**After (Using Wrapper):**
```yaml
- name: Execute Copilot with Firewall
  run: |
    awf \
      --allow-domains github.com,arxiv.org \
      'copilot --prompt "..."'
```

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

The copilot container mounts the HOME directory, so this config file is automatically accessible to Copilot CLI running inside the container.

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
- `sudo -E` - **REQUIRED** to pass environment variables through sudo to the copilot container
- `--disable-builtin-mcps` - Disables the built-in read-only GitHub MCP server
- `--allow-tool github` - Grants permission to use all tools from the `github` MCP server (must match server name in config)
- MCP config at `~/.copilot/mcp-config.json` - Automatically accessible since copilot container mounts HOME directory

**Why `sudo -E` is required:**
1. `awf` needs sudo for iptables manipulation
2. `-E` preserves GITHUB_TOKEN and GITHUB_PERSONAL_ACCESS_TOKEN
3. These variables are passed into the copilot container via the HOME directory mount
4. The GitHub MCP server Docker container inherits them from the copilot container's environment

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

### Troubleshooting MCP in CI/CD

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
