# Agentic Workflow Firewall

A network firewall for agentic workflows with domain whitelisting. This tool provides L7 (HTTP/HTTPS) egress control using [Squid proxy](https://www.squid-cache.org/) and Docker containers, restricting network access to a whitelist of approved domains for AI agents and their MCP servers.

> [!TIP]
> This project is a part of GitHub's explorations of [Agentic Workflows](https://github.com/github/gh-aw). For more background, check out the [project page](https://github.github.io/gh-aw/)! ✨

## What it does

- **L7 Domain Whitelisting**: Control HTTP/HTTPS traffic at the application layer
- **Host-Level Enforcement**: Uses iptables DOCKER-USER chain to enforce firewall on ALL containers
- **Chroot Mode**: Optional `--enable-chroot` for transparent access to host binaries (Python, Node.js, Go) while maintaining network isolation

## Requirements

- **Docker**: 20.10+ with Docker Compose v2
- **Node.js**: 18+ (for building from source)
- **OS**: Ubuntu 22.04+ or compatible Linux distribution

See [Compatibility](docs/compatibility.md) for full details on supported versions and tested configurations.

## Get started fast

- **Prerequisite:** Docker is running
- **Install:**
  ```bash
  curl -sSL https://raw.githubusercontent.com/github/gh-aw-firewall/main/install.sh | sudo bash
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
    uses: github/gh-aw-firewall@main
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
    uses: github/gh-aw-firewall@main
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
curl -sSL https://raw.githubusercontent.com/github/gh-aw-firewall/main/install.sh | sudo bash

# Install a specific version
curl -sSL https://raw.githubusercontent.com/github/gh-aw-firewall/main/install.sh | sudo bash -s -- v1.0.0

# Or using environment variable
curl -sSL https://raw.githubusercontent.com/github/gh-aw-firewall/main/install.sh | sudo AWF_VERSION=v1.0.0 bash
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
curl -fL https://github.com/github/gh-aw-firewall/releases/latest/download/awf-linux-x64 -o awf

# Download checksums for verification
curl -fL https://github.com/github/gh-aw-firewall/releases/latest/download/checksums.txt -o checksums.txt

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
- [Chroot mode](docs/chroot-mode.md) — use host binaries with network isolation
- [SSL Bump](docs/ssl-bump.md) — HTTPS content inspection for URL path filtering
- [Logging quick reference](docs/logging_quickref.md) and [Squid log filtering](docs/squid_log_filtering.md) — view and filter traffic
- [Security model](docs/security.md) — what the firewall protects and how
- [Architecture](docs/architecture.md) — how Squid, Docker, and iptables fit together
- [Compatibility](docs/compatibility.md) — supported Node.js, OS, and Docker versions
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
