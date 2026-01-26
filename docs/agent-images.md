# Agent Image Tools

Reference guide for the development tools, utilities, and runtime versions pre-installed in the `agent` and `agent-act` container images used by the firewall.

> 📘 **Note:** This document is also available in the [online documentation](https://githubnext.github.io/gh-aw-firewall/reference/agent-images/).

## Overview

The firewall uses two main container image types for running user commands:

- **`agent` (default)**: Lightweight Ubuntu 22.04-based image with essential dev tools
- **`agent-act`**: GitHub Actions runner-compatible image based on Ubuntu 24.04

### Image Selection

Use the `--agent-image` flag to choose which image to use:

```bash
# Default agent image (lightweight)
sudo awf --allow-domains github.com -- node --version

# GitHub Actions-compatible image
sudo awf --agent-image act --allow-domains github.com -- node --version
```

### Base Images

| Image | Base | Purpose |
|-------|------|---------|
| `agent` | `ubuntu:22.04` | Minimal development environment with Node.js, Python, git |
| `agent-act` | `catthehacker/ubuntu:act-24.04` | GitHub Actions runner subset with multiple runtime versions |

**Note:** The `agent-act` image inherits from [catthehacker/docker_images](https://github.com/catthehacker/docker_images), which provides medium-sized subsets of GitHub Actions runner images. For full GitHub Actions runner parity, you need the full-sized images (60GB+). See the catthehacker repository for details on runner compatibility.

## Verifying Tools Locally

Check installed tools and versions by running bash in the container:

```bash
# Verify tools in agent image
sudo awf --allow-domains '' -- bash -c 'node --version && python3 --version && git --version'

# Verify tools in agent-act image
sudo awf --agent-image act --allow-domains '' -- bash -c 'which -a node && node --version'

# Interactive exploration
sudo awf --tty --allow-domains '' -- bash
```

## Agent Image Tools

The default `agent` image (based on Ubuntu 22.04) includes the following pre-installed tools:

### Runtimes

| Tool | Version | Path | Notes |
|------|---------|------|-------|
| Node.js | v22.22.0 | `/usr/bin/node` | Includes npm, npx |
| npm | 10.9.4 | `/usr/bin/npm` | — |
| npx | 10.9.4 | `/usr/bin/npx` | — |
| Python | 3.10.12 | `/usr/bin/python3` | No pip installed by default |

### Version Control & CI/CD

| Tool | Version | Notes |
|------|---------|-------|
| git | 2.34.1 | Standard git client |
| GitHub CLI | 2.4.0+dfsg1 | `gh` command for GitHub API |

### Network Tools

| Tool | Version | Package | Notes |
|------|---------|---------|-------|
| curl | 7.81.0 | `curl` | HTTP client |
| dig | 9.18.39 | `dnsutils` | DNS lookup utility |
| ifconfig | 2.10-alpha | `net-tools` | Network interface config |
| netcat | 1.218 | `netcat-openbsd` | TCP/UDP connections |

### System Tools

| Tool | Version | Package | Notes |
|------|---------|---------|-------|
| iptables | 1.8.7 | `iptables` | Firewall rules (host-level control) |
| gosu | 1.14 | `gosu` | Run commands as other users |
| capsh | — | `libcap2-bin` | Capability management |
| gnupg | 2.2.27 | `gnupg` | GPG encryption |
| ca-certificates | — | `ca-certificates` | Trusted root certificates |

**⚠️ Docker CLI Stub:** The `docker` command is present but is a stub—there is no Docker daemon running inside the container. Docker-in-Docker is not supported. Use `--mount` to access Docker sockets from the host if needed.

## Agent-Act Image Tools

The `agent-act` image (based on Ubuntu 24.04) includes all tools from the `agent` image plus additional runtimes and build tools for GitHub Actions compatibility.

### Runtimes

| Tool | Version | Path | Notes |
|------|---------|------|-------|
| Node.js | v18.20.8 | `/opt/hostedtoolcache/node/18.20.8/x64/bin/node` | Default in PATH (from actions/setup-node) |
| npm | 10.8.2 | `/opt/hostedtoolcache/node/18.20.8/x64/bin/npm` | Bundled with Node.js 18 |
| npx | 10.8.2 | `/opt/hostedtoolcache/node/18.20.8/x64/bin/npx` | Bundled with Node.js 18 |
| corepack | 0.32.0 | `/opt/hostedtoolcache/node/18.20.8/x64/bin/corepack` | Yarn/pnpm manager |
| Node.js (system) | v22.22.0 | `/usr/bin/node` | Alternative system installation |
| Python | 3.12.3 | `/usr/bin/python3` | Includes pip 24.0 |
| pip | 24.0 | `/usr/bin/pip3` | Python package manager |

**💡 Tip:** The `agent-act` image has Node.js v18 in PATH by default (from `/opt/hostedtoolcache`) and Node.js v22 available at `/usr/bin/node`. Use `which node` to check which version is active, or specify the full path for a specific version.

### Version Control & CI/CD

| Tool | Version | Notes |
|------|---------|-------|
| git | 2.52.0 | Standard git client |
| GitHub CLI | 2.45.0 | `gh` command for GitHub API |
| git-lfs | 3.7.1 | Git Large File Storage |

### Build Tools

| Tool | Version | Package | Notes |
|------|---------|---------|-------|
| gcc | 13.3.0 | `build-essential` | C compiler |
| g++ | 13.3.0 | `build-essential` | C++ compiler |
| make | 4.3 | `build-essential` | Build automation |
| build-essential | — | `build-essential` | Metapackage with common build tools |

### Network Tools

| Tool | Version | Package | Notes |
|------|---------|---------|-------|
| curl | 8.5.0 | `curl` | HTTP client (newer version) |
| dig | 9.18.39 | `dnsutils` | DNS lookup utility |
| ifconfig | 2.10 | `net-tools` | Network interface config |
| netcat | 1.226 | `netcat-openbsd` | TCP/UDP connections |

### System Tools

| Tool | Version | Package | Notes |
|------|---------|---------|-------|
| iptables | 1.8.10 | `iptables` | Firewall rules (host-level control) |
| gosu | 1.17 | `gosu` | Run commands as other users |
| capsh | — | `libcap2-bin` | Capability management |
| jq | 1.6 | `jq` | JSON processor |

**⚠️ Docker CLI Stub:** The `docker` command is present but is a stub—there is no Docker daemon running inside the container. Docker-in-Docker is not supported. Use `--mount` to access Docker sockets from the host if needed.

## GitHub Actions Runner Compatibility

The `agent-act` image is based on `catthehacker/ubuntu:act-24.04`, which provides a medium-sized subset of the official GitHub Actions runner environment.

### What's Included

- Core runtimes: Node.js (multiple versions), Python, Ruby (via `/opt/hostedtoolcache`)
- Build tools: gcc, g++, make, cmake
- Common CLI tools: git, gh, curl, jq, aws-cli
- Container tools (stubs): docker, docker-compose

### What's Missing

The medium-sized images omit some tools present in full GitHub Actions runners:

- Additional language runtimes (full Java, .NET SDK, Go, PHP)
- Cloud provider CLIs (complete set)
- Database clients (mysql, psql)
- Specialized tools (terraform, helm, kubectl)

### Full Parity

For complete GitHub Actions runner parity, use the full-sized runner images (60GB+):

```bash
sudo awf \
  --agent-image catthehacker/ubuntu:full-24.04 \
  --build-local \
  --allow-domains github.com \
  -- <command>
```

See [catthehacker/docker_images](https://github.com/catthehacker/docker_images) for the full list of available images and their contents.

## Custom Base Images

You can use custom base images with `--agent-image`:

```bash
# Use a specific version of the act image
sudo awf \
  --agent-image catthehacker/ubuntu:act-24.04 \
  --build-local \
  --allow-domains github.com \
  -- npm test

# Use your own custom image
sudo awf \
  --agent-image myorg/my-base:latest \
  --build-local \
  --allow-domains github.com \
  -- ./my-script.sh
```

**⚠️ Security Risk:** Custom base images introduce supply chain risks. Only use images from trusted publishers. The firewall cannot protect against malicious code in the base image itself.

## See Also

- [Usage Guide](usage.md) - Examples of using different agent images
- [catthehacker/docker_images](https://github.com/catthehacker/docker_images) - Source repository for GitHub Actions runner images
