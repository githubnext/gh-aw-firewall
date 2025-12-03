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

### Docker Image Verification

All published Docker images are signed with [cosign](https://github.com/sigstore/cosign) using keyless signing. You can verify the signatures to ensure image authenticity and integrity:

```bash
# Install cosign (using package manager is recommended for security)
# Option 1: Using apt (Debian/Ubuntu)
# Add Sigstore repository and install
# curl -fsSL https://sigstore.dev/pubkey.asc | sudo apt-key add -
# echo "deb [arch=amd64] https://dl.sigstore.dev/apt stable main" | sudo tee /etc/apt/sources.list.d/sigstore.list
# sudo apt update && sudo apt install -y cosign

# Option 2: Direct download (verify checksums from release page)
curl -sSfL https://github.com/sigstore/cosign/releases/latest/download/cosign-linux-amd64 -o cosign
chmod +x cosign
sudo mv cosign /usr/local/bin/

# Verify Squid image signature
cosign verify \
  --certificate-identity-regexp 'https://github.com/githubnext/gh-aw-firewall/.*' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/githubnext/gh-aw-firewall/squid:latest

# Verify Agent image signature
cosign verify \
  --certificate-identity-regexp 'https://github.com/githubnext/gh-aw-firewall/.*' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/githubnext/gh-aw-firewall/agent:latest

# Verify SBOM attestation
cosign verify-attestation \
  --certificate-identity-regexp 'https://github.com/githubnext/gh-aw-firewall/.*' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  --type spdxjson \
  ghcr.io/githubnext/gh-aw-firewall/squid:latest
```

The images are signed during the release process using GitHub Actions OIDC tokens, ensuring they come from the official repository.

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

### Log Viewing

View Squid proxy logs from current or previous runs:

```bash
# View recent logs with pretty formatting
awf logs

# Follow logs in real-time
awf logs -f

# View logs in JSON format for scripting
awf logs --format json

# List all available log sources
awf logs --list
```

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
- DNS-based data exfiltration to unauthorized DNS servers
- MCP servers accessing unexpected endpoints

### DNS Server Restriction

DNS traffic is restricted to trusted servers only (default: Google DNS 8.8.8.8, 8.8.4.4). This prevents DNS-based data exfiltration attacks where an attacker encodes data in DNS queries to a malicious DNS server.

```bash
# Use custom DNS servers
sudo awf \
  --allow-domains github.com \
  --dns-servers 1.1.1.1,1.0.0.1 \
  -- curl https://api.github.com
```

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
