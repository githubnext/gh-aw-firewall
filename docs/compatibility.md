# Compatibility

This document outlines the supported Node.js versions, operating systems, and other compatibility information for the Agentic Workflow Firewall.

## Supported Versions

### Node.js

| Version | Status | Notes |
|---------|--------|-------|
| Node.js 22.x | ✅ Fully Supported | Recommended for best performance |
| Node.js 20.x | ✅ Fully Supported | Current LTS |
| Node.js 18.x | ✅ Supported | Minimum required version |
| Node.js < 18 | ❌ Not Supported | Below minimum engine requirement |

The minimum Node.js version is specified in `package.json` under `engines.node: ">=18.0.0"`.

### Ubuntu / Linux

| Version | Status | Notes |
|---------|--------|-------|
| Ubuntu 24.04 (Noble) | ✅ Fully Supported | `ubuntu-latest` in GitHub Actions |
| Ubuntu 22.04 (Jammy) | ✅ Fully Supported | LTS, tested in CI |
| Ubuntu 20.04 (Focal) | ⚠️ May Work | Not actively tested |
| Other Linux distros | ⚠️ May Work | Docker and iptables required |

**Note:** The agent container is based on Ubuntu 22.04, which ensures consistent behavior regardless of the host OS.

### Docker

| Component | Minimum Version | Notes |
|-----------|-----------------|-------|
| Docker Engine | 20.10+ | Required for container networking |
| Docker Compose | v2.0+ | Used for container orchestration |

### GitHub Actions Runners

The firewall is tested on GitHub Actions runners with the following configurations:

- `ubuntu-latest` (currently Ubuntu 24.04)
- `ubuntu-22.04`

### Architecture

| Architecture | Status | Notes |
|--------------|--------|-------|
| x86_64 (amd64) | ✅ Fully Supported | Primary development platform |
| arm64 (aarch64) | ⚠️ May Work | Not actively tested |

## CI Test Matrix

The project uses a matrix testing strategy to ensure compatibility across different configurations:

### Pull Requests

For faster feedback on pull requests, tests run on a minimal configuration:
- **OS:** `ubuntu-latest`
- **Node.js:** 22

### Main Branch Pushes

Full matrix testing runs on pushes to the main branch:
- **OS:** `ubuntu-22.04`, `ubuntu-latest`
- **Node.js:** 18, 22

This approach balances comprehensive compatibility testing with CI resource efficiency.

## Verifying Compatibility

To check if your environment meets the requirements:

```bash
# Check Node.js version
node --version  # Should be v18.0.0 or higher

# Check Docker version
docker --version  # Should be 20.10 or higher

# Check Docker Compose version
docker compose version  # Should be v2.0 or higher

# Check Docker is running
docker info
```

## Troubleshooting

### Node.js Version Too Old

If you see errors about unsupported syntax or modules:

```bash
# Install Node.js 22 using nvm
nvm install 22
nvm use 22

# Or using apt (Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Docker Not Available

If Docker is not available:

```bash
# Install Docker on Ubuntu
curl -fsSL https://get.docker.com | sudo sh

# Add your user to the docker group
sudo usermod -aG docker $USER

# Start Docker service
sudo systemctl start docker
sudo systemctl enable docker
```

## Reporting Compatibility Issues

If you encounter compatibility issues with a supported configuration, please:

1. Check the [Troubleshooting Guide](troubleshooting.md)
2. Search existing [GitHub Issues](https://github.com/githubnext/gh-aw-firewall/issues)
3. Open a new issue with:
   - Node.js version (`node --version`)
   - Docker version (`docker --version`)
   - Operating system and version (`cat /etc/os-release`)
   - Full error message and logs
