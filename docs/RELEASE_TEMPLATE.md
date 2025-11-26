# Release Notes Template

This file is used to generate release notes automatically during the release workflow.
Edit this file to change the format of release notes for all future releases.

## Available Placeholders

| Placeholder | Description | Example |
|-------------|-------------|---------|
| `{{CHANGELOG}}` | Auto-generated changelog from GitHub API or git log | PR list or commit list |
| `{{CLI_HELP}}` | Output of `awf --help` command | CLI usage and options |
| `{{REPOSITORY}}` | GitHub repository path | `githubnext/gh-aw-firewall` |
| `{{VERSION}}` | Full version tag with 'v' prefix | `v0.3.0` |
| `{{VERSION_NUMBER}}` | Version number without 'v' prefix | `0.3.0` |

## Template Content

Everything below the `---` separator becomes the release notes.

---

{{CHANGELOG}}

## CLI Options

```
{{CLI_HELP}}
```

## Installation

### Binary Installation (Recommended)

**Linux (x64):**
```bash
curl -L https://github.com/{{REPOSITORY}}/releases/download/{{VERSION}}/awf-linux-x64 -o awf
chmod +x awf
sudo mv awf /usr/local/bin/
```

### NPM Installation (Alternative)

```bash
# Install from tarball
npm install -g https://github.com/{{REPOSITORY}}/releases/download/{{VERSION}}/awf.tgz
```

### Requirements

- Docker and Docker Compose must be installed
- For iptables manipulation, run with sudo: `sudo awf ...`
- Container images will be pulled automatically from GHCR on first run

## Verification

Verify checksums after download:
```bash
sha256sum -c checksums.txt
```

## Quick Start

```bash
# Basic usage with domain whitelist
sudo awf --allow-domains github.com,api.github.com -- curl https://api.github.com

# Pass environment variables
sudo awf --allow-domains api.github.com -e GITHUB_TOKEN=xxx -- gh api /user

# Mount additional volumes
sudo awf --allow-domains github.com -v /my/data:/data:ro -- cat /data/file.txt

# Set working directory in container
sudo awf --allow-domains github.com --container-workdir /workspace -- pwd
```

See [README.md](https://github.com/{{REPOSITORY}}/blob/{{VERSION}}/README.md) for full documentation.

## Container Images

Published to GitHub Container Registry:
- `ghcr.io/{{REPOSITORY}}/squid:{{VERSION_NUMBER}}`
- `ghcr.io/{{REPOSITORY}}/agent:{{VERSION_NUMBER}}`
- `ghcr.io/{{REPOSITORY}}/squid:latest`
- `ghcr.io/{{REPOSITORY}}/agent:latest`
