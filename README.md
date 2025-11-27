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

### Wildcard Patterns

You can use wildcard patterns with `*` to match multiple domains:

```bash
# Match any subdomain of github.com
--allow-domains '*.github.com'

# Match api-v1.example.com, api-v2.example.com, etc.
--allow-domains 'api-*.example.com'

# Combine plain domains and wildcards
--allow-domains 'github.com,*.googleapis.com,api-*.example.com'
```

**Pattern rules:**
- `*` matches any characters (converted to regex `.*`)
- Patterns are case-insensitive (DNS is case-insensitive)
- Overly broad patterns like `*`, `*.*`, or `*.*.*` are rejected for security
- Use quotes around patterns to prevent shell expansion

**Examples:**
| Pattern | Matches | Does Not Match |
|---------|---------|----------------|
| `*.github.com` | `api.github.com`, `raw.github.com` | `github.com` |
| `api-*.example.com` | `api-v1.example.com`, `api-test.example.com` | `api.example.com` |
| `github.com` | `github.com`, `api.github.com` | `notgithub.com` |

### Using Command-Line Flag

Common domain lists:

```bash
# For GitHub Copilot with GitHub API
--allow-domains github.com,api.github.com,githubusercontent.com,googleapis.com

# For MCP servers
--allow-domains github.com,arxiv.org,example.com
```

### Using a Domains File

You can also specify domains in a file using `--allow-domains-file`:

```bash
# Create a domains file (see examples/domains.txt)
cat > allowed-domains.txt << 'EOF'
# GitHub domains
github.com
api.github.com

# NPM registry
npmjs.org, registry.npmjs.org

# Wildcard patterns
*.googleapis.com

# Example with inline comment
example.com # Example domain
EOF

# Use the domains file
sudo awf --allow-domains-file allowed-domains.txt -- curl https://api.github.com
```

**File format:**
- One domain per line or comma-separated
- Comments start with `#` (full line or inline)
- Empty lines are ignored
- Whitespace is trimmed
- Wildcard patterns are supported

**Combining both methods:**
```bash
# You can use both flags together - domains are merged
sudo awf \
  --allow-domains github.com \
  --allow-domains-file my-domains.txt \
  -- curl https://api.github.com
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
