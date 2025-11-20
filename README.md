# Agentic Workflow Firewall

A network firewall for agentic workflows with domain whitelisting. This tool provides L7 (HTTP/HTTPS) egress control using [Squid proxy](https://www.squid-cache.org/) and Docker containers, restricting network access to a whitelist of approved domains for AI agents and their MCP servers.

> [!TIP]
> This project is a part of GitHub Next's explorations of [Agentic Workflows](https://github.com/githubnext/gh-aw). For more background, check out the [project page on the GitHub Next website](https://githubnext.com/projects/agentic-workflows/)! ✨

## Features

- **L7 Domain Whitelisting**: Control HTTP/HTTPS traffic at the application layer
- **Host-Level Enforcement**: Uses iptables DOCKER-USER chain to enforce firewall on ALL containers
- **Docker-in-Docker Support**: Spawned containers inherit firewall restrictions

## Quick Start

### Requirements

- **Docker**: Must be running

### Installation

```bash
# Download the latest release binary
curl -L https://github.com/githubnext/gh-aw-firewall/releases/latest/download/awf-linux-x64 -o awf
chmod +x awf
sudo mv awf /usr/local/bin/

# Verify installation
sudo awf --help
```

**Note:** Verify checksums after download by downloading `checksums.txt` from the release page.

### Basic Usage

```bash
# Simple HTTP request
sudo awf \
  --allow-domains github.com,api.github.com \
  -- curl https://api.github.com

# With GitHub Copilot CLI
sudo -E awf \
  --allow-domains github.com,api.github.com,googleapis.com \
  -- copilot --prompt "List my repositories"

# Docker-in-Docker (spawned containers inherit firewall)
sudo awf \
  --allow-domains api.github.com,registry-1.docker.io,auth.docker.io \
  -- docker run --rm curlimages/curl -fsS https://api.github.com/zen
```

**Note:** Always use the `--` separator to pass commands and arguments. This ensures proper argument handling and avoids shell escaping issues.

## Domain Whitelisting

Domains automatically match all subdomains:

```bash
# github.com matches api.github.com, raw.githubusercontent.com, etc.
sudo awf --allow-domains github.com -- curl https://api.github.com  # ✓ works
```

Common domain lists:

```bash
# For GitHub Copilot with GitHub API
--allow-domains github.com,api.github.com,githubusercontent.com,googleapis.com

# For MCP servers
--allow-domains github.com,arxiv.org,example.com
```


## Security Considerations

### What This Protects Against
- Unauthorized egress to non-whitelisted domains
- Data exfiltration via HTTP/HTTPS
- MCP servers accessing unexpected endpoints

## Development & Testing

### Running Tests

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run tests with coverage report
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

### Building

```bash
# Build TypeScript
npm run build

# Run linter
npm run lint

# Clean build artifacts
npm run clean
```

## Contributing

Contributions welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
