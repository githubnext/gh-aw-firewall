---
title: Installation
description: How to install the Agentic Workflow Firewall
---

## Requirements

- **Docker**: Must be running
- **Node.js 18+**: For building from source (optional)
- **sudo access**: Required for iptables manipulation

## Download Binary (Recommended)

Download pre-built binaries from the latest release:

```bash
# Download the latest release binary
curl -L https://github.com/githubnext/gh-aw-firewall/releases/latest/download/awf-linux-x64 -o awf
chmod +x awf
sudo mv awf /usr/local/bin/

# Verify installation
sudo awf --help
```

**Security Note:** Always verify checksums after download by downloading `checksums.txt` from the [releases page](https://github.com/githubnext/gh-aw-firewall/releases).

## Build from Source

### Clone and Build

```bash
# Clone the repository
git clone https://github.com/githubnext/gh-aw-firewall.git
cd gh-aw-firewall

# Install dependencies
npm install

# Build TypeScript to dist/
npm run build

# Link locally for testing
npm link

# Use the CLI
awf --help
```

### For sudo Usage

Since `npm link` creates symlinks in the user's npm directory which isn't in root's PATH, you need to create a wrapper script in `/usr/local/bin/`:

```bash
# Build the project
npm run build

# Create sudo wrapper script
sudo tee /usr/local/bin/awf > /dev/null <<'EOF'
#!/bin/bash
exec ~/.nvm/versions/node/v22.13.0/bin/node \
     ~/developer/gh-aw-firewall/dist/cli.js "$@"
EOF

sudo chmod +x /usr/local/bin/awf

# Verify it works
sudo awf --help
```

**Note:** Update the paths in the wrapper script to match your node installation and project directory.

## Verify Installation

```bash
# Check version
awf --version

# View help
awf --help
```

## Uninstall

### Binary Installation

```bash
sudo rm /usr/local/bin/awf
```

### npm Installation

```bash
npm unlink -g @github/agentic-workflow-firewall
```

## Next Steps

- Continue to the [Quick Start](/getting-started/quickstart/) guide
- Learn about [Usage](/guides/usage/)
- Explore [GitHub Actions Integration](/guides/github-actions/)
