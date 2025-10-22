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
npm install
npm run build

# Create sudo wrapper (required for iptables manipulation)
sudo tee /usr/local/bin/awf > /dev/null <<'EOF'
#!/bin/bash
exec $(which node) $(pwd)/dist/cli.js "$@"
EOF

sudo chmod +x /usr/local/bin/awf

# Verify installation
sudo awf --help
```

### Basic Usage

```bash
# Simple HTTP request
sudo awf \
  --allow-domains github.com,api.github.com \
  'curl https://api.github.com'

# With GitHub Copilot CLI
sudo -E awf \
  --allow-domains github.com,api.github.com,googleapis.com \
  'copilot --prompt "List my repositories"'

# Docker-in-Docker (spawned containers inherit firewall)
sudo awf \
  --allow-domains api.github.com,registry-1.docker.io,auth.docker.io \
  'docker run --rm curlimages/curl -fsS https://api.github.com/zen'
```

## Domain Whitelisting

Domains automatically match all subdomains:

```bash
# github.com matches api.github.com, raw.githubusercontent.com, etc.
sudo awf --allow-domains github.com "curl https://api.github.com"  # ✓ works
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

## Contributing

Contributions welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
