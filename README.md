# Agentic Workflow Firewall

A network firewall for agentic workflows with domain whitelisting. This tool provides L7 (HTTP/HTTPS) egress control using [Squid proxy](https://www.squid-cache.org/) and Docker containers, restricting network access to a whitelist of approved domains for AI agents and their MCP servers.

> [!TIP]
> This project is a part of GitHub Next's explorations of [Agentic Workflows](https://github.com/githubnext/gh-aw). For more background, check out the [project page on the GitHub Next website](https://githubnext.com/projects/agentic-workflows/)! ✨

## What it does

- **L7 Domain Whitelisting**: Control HTTP/HTTPS traffic at the application layer
- **Host-Level Enforcement**: Uses iptables DOCKER-USER chain to enforce firewall on ALL containers

## Breaking Changes

### v0.9.1 - Docker-in-Docker Support Removed

[PR #205](https://github.com/githubnext/gh-aw-firewall/pull/205) removed Docker-in-Docker support to simplify the architecture and improve security. This change affects users who were running Docker commands or Docker-based MCP servers within the firewall.

**What still works:**
- ✅ **Network egress control** - HTTP/HTTPS domain allowlist enforcement is unchanged
- ✅ **Most workflows** - GitHub Copilot CLI and Claude with stdio-based MCP servers work perfectly
- ✅ **Filesystem access** - Full filesystem mounting for reading/writing files
- ✅ **Command execution** - Any commands that don't require Docker

**What no longer works:**
- ❌ **Docker commands** - `docker run`, `docker-compose`, and similar commands will fail
- ❌ **Docker-based MCP servers** - MCP servers configured with `"command": "docker"` will not work

**Migration guide for MCP servers:**

If you were using a Docker-based GitHub MCP server configuration, migrate to stdio-based alternatives:

**Before (Docker-based):**
```json
{
  "mcpServers": {
    "github": {
      "type": "local",
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server:v0.19.0"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
      }
    }
  }
}
```

**After (stdio-based with npx):**
```json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github-mcp-custom@1.0.20", "stdio"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
      }
    }
  }
}
```

**Alternative (using Go binary):**
```json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "/usr/local/bin/github-mcp-server",
      "args": ["stdio"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
      }
    }
  }
}
```

**Workarounds:**

If you absolutely need Docker functionality:
1. **Pre-pull images**: Pull required Docker images on the host before running awf
2. **Run outside firewall**: Execute Docker commands outside the firewall container
3. **Use alternatives**: Consider non-Docker alternatives for your use case (e.g., stdio-based MCP servers, native binaries)

For more details, see the [architecture documentation](docs/architecture.md).

## Get started fast

- **Prerequisite:** Docker is running
- **Install:**
  ```bash
  curl -sSL https://raw.githubusercontent.com/githubnext/gh-aw-firewall/main/install.sh | sudo bash
  ```
- **Run your first command:**
  ```bash
  sudo awf --allow-domains github.com -- curl https://api.github.com
  ```
  The `--` separator passes the command you want to run behind the firewall.

### GitHub Copilot CLI in one line

```bash
sudo -E awf \
  --allow-domains github.com,api.github.com,githubusercontent.com \
  -- copilot --prompt "List my repositories"
```

For checksum verification, version pinning, and manual installation steps, see [Quick start](docs/quickstart.md).

#### GitHub Action (recommended for CI/CD)

Use the setup action in your workflows:

```yaml
steps:
  - name: Setup awf
    uses: githubnext/gh-aw-firewall@main
    with:
      # version: 'v1.0.0'    # Optional: defaults to latest
      # pull-images: 'true'  # Optional: pre-pull Docker images for the version

  - name: Run command with firewall
    run: sudo awf --allow-domains github.com -- curl https://api.github.com
```

To pin Docker images to match the installed version, use `pull-images: 'true'` and pass the image tag to awf:

```yaml
steps:
  - name: Setup awf
    id: setup-awf
    uses: githubnext/gh-aw-firewall@main
    with:
      version: 'v0.7.0'
      pull-images: 'true'

  - name: Run with pinned images
    run: |
      sudo awf --allow-domains github.com \
        --image-tag ${{ steps.setup-awf.outputs.image-tag }} \
        -- curl https://api.github.com
```

#### Shell script

```bash
# Install latest version
curl -sSL https://raw.githubusercontent.com/githubnext/gh-aw-firewall/main/install.sh | sudo bash

# Install a specific version
curl -sSL https://raw.githubusercontent.com/githubnext/gh-aw-firewall/main/install.sh | sudo bash -s -- v1.0.0

# Or using environment variable
curl -sSL https://raw.githubusercontent.com/githubnext/gh-aw-firewall/main/install.sh | sudo AWF_VERSION=v1.0.0 bash
```

The shell installer automatically:
- Downloads the latest release binary (or a specified version)
- Verifies SHA256 checksum to detect corruption or tampering
- Validates the file is a valid Linux executable
- Protects against 404 error pages being saved as binaries
- Installs to `/usr/local/bin/awf`

**Alternative: Manual installation**

```bash
# Download the latest release binary
curl -fL https://github.com/githubnext/gh-aw-firewall/releases/latest/download/awf-linux-x64 -o awf

# Download checksums for verification
curl -fL https://github.com/githubnext/gh-aw-firewall/releases/latest/download/checksums.txt -o checksums.txt

# Verify SHA256 checksum
sha256sum -c checksums.txt --ignore-missing

# Install
chmod +x awf
sudo mv awf /usr/local/bin/

# Verify installation
sudo awf --help
```

**Docker Image Verification:** All published container images are cryptographically signed with cosign. See [docs/image-verification.md](docs/image-verification.md) for verification instructions.

## Explore the docs

- [Quick start](docs/quickstart.md) — install, verify, and run your first command
- [Usage guide](docs/usage.md) — CLI flags, domain allowlists, examples
- [SSL Bump](docs/ssl-bump.md) — HTTPS content inspection for URL path filtering
- [Logging quick reference](docs/logging_quickref.md) and [Squid log filtering](docs/squid_log_filtering.md) — view and filter traffic
- [Security model](docs/security.md) — what the firewall protects and how
- [Architecture](docs/architecture.md) — how Squid, Docker, and iptables fit together
- [Troubleshooting](docs/troubleshooting.md) — common issues and fixes
- [Image verification](docs/image-verification.md) — cosign signature verification

## Development

- Install dependencies: `npm install`
- Run tests: `npm test`
- Build: `npm run build`

## Contributing

Contributions welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
