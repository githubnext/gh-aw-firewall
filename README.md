# Agentic Workflow Firewall

A network firewall for agentic workflows with domain whitelisting. This tool provides L7 (HTTP/HTTPS) egress control using [Squid proxy](https://www.squid-cache.org/) and Docker containers, restricting network access to a whitelist of approved domains for AI agents and their MCP servers.

> [!TIP]
> This project is a part of GitHub Next's explorations of [Agentic Workflows](https://github.com/githubnext/gh-aw). For more background, check out the [project page on the GitHub Next website](https://githubnext.com/projects/agentic-workflows/)! ✨

## What it does

- **L7 Domain Whitelisting**: Control HTTP/HTTPS traffic at the application layer
- **Host-Level Enforcement**: Uses iptables DOCKER-USER chain to enforce firewall on ALL containers
- **Docker-in-Docker Support**: Spawned containers inherit firewall restrictions

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

All published container images are cryptographically signed with cosign. See [docs/image-verification.md](docs/image-verification.md) for verification instructions.

## Explore the docs

- [Quick start](docs/quickstart.md) — install, verify, and run your first command
- [Usage guide](docs/usage.md) — CLI flags, domain allowlists, Docker-in-Docker examples
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
