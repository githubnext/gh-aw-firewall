---
title: Agentic Workflow Firewall
description: Network firewall for AI agents with domain whitelisting - control egress HTTP/HTTPS traffic using Squid proxy and Docker containers.
---

A network firewall designed specifically for AI agents and agentic workflows. Control which domains your AI agents can access while maintaining full filesystem access and Docker-in-Docker capabilities.

:::tip[Part of GitHub Next]
This project is part of GitHub Next's explorations of [Agentic Workflows](https://github.com/githubnext/gh-aw). Learn more on the [GitHub Next website](https://githubnext.com/projects/agentic-workflows/)! ✨
:::

## What Is This?

When AI agents like GitHub Copilot CLI run with access to tools and MCP servers, they can make network requests to any domain. This firewall provides **L7 (HTTP/HTTPS) egress control** using domain whitelisting, ensuring agents can only access approved domains while blocking all unauthorized network traffic.

**Key Capabilities:**
- **Domain Whitelisting**: Allow only specific domains (automatically includes subdomains)
- **Docker-in-Docker Enforcement**: Spawned containers inherit firewall restrictions
- **Host-Level Protection**: Uses iptables DOCKER-USER chain for defense-in-depth
- **Zero Trust**: Block all traffic by default, allow only what you explicitly permit
- **Full Auditability**: Comprehensive logging of all allowed and blocked traffic

## Why Use This?

**For Security Teams:**
- Control which APIs and services AI agents can access
- Prevent data exfiltration to unauthorized domains
- Audit all network activity with detailed logs
- Enforce network policies for agentic workflows in CI/CD

**For Developers:**
- Test AI agents in restricted network environments
- Debug MCP server network behavior
- Validate domain requirements before production deployment
- Ensure reproducible, isolated agent execution

## Quick Start

### Installation

Download the latest release binary:

```bash
# One-line installer with SHA verification (recommended)
curl -sSL https://raw.githubusercontent.com/githubnext/gh-aw-firewall/main/install.sh | sudo bash

# Or manual installation
curl -fL https://github.com/githubnext/gh-aw-firewall/releases/latest/download/awf-linux-x64 -o awf
curl -fL https://github.com/githubnext/gh-aw-firewall/releases/latest/download/checksums.txt -o checksums.txt
sha256sum -c checksums.txt --ignore-missing
chmod +x awf
sudo mv awf /usr/local/bin/

# Verify installation
sudo awf --version
```

:::tip[Automatic SHA Verification]
The one-line installer automatically verifies the SHA256 checksum to protect against corrupted or tampered downloads.
:::

### Your First Command

Run a simple curl command through the firewall:

```bash
sudo awf \
  --allow-domains github.com \
  -- curl https://api.github.com/zen
```

**Expected output:**
```
[INFO] Allowed domains: github.com
[INFO] Starting containers...
[SUCCESS] Containers started successfully
[INFO] Executing command...
Design for failure.
[SUCCESS] Command completed with exit code: 0
```

The request succeeds because `api.github.com` is a subdomain of the whitelisted `github.com`.

### Test Domain Blocking

Verify that non-whitelisted domains are blocked:

```bash
sudo awf \
  --allow-domains github.com \
  -- curl --max-time 10 https://example.com
```

This command **fails** with a connection timeout - that's correct! The firewall is blocking `example.com` because it's not in the allowlist.

## Common Use Cases

### GitHub Copilot CLI

Run GitHub Copilot with controlled network access:

```bash
# Export your Copilot token
export GITHUB_TOKEN="your_copilot_token"

# Run Copilot through the firewall
sudo -E awf \
  --allow-domains github.com,googleapis.com \
  -- npx @github/copilot@latest --prompt "List my repositories"
```

:::tip
Use `sudo -E` to preserve environment variables like `GITHUB_TOKEN`.
:::

### MCP Servers

Test MCP servers with specific domain allowlists:

```bash
sudo awf \
  --allow-domains github.com,arxiv.org \
  -- npx @github/copilot@latest \
    --mcp-server ./my-mcp-server.js \
    --prompt "Search arXiv for papers on AI safety"
```

### Docker-in-Docker

Spawned containers automatically inherit firewall restrictions:

```bash
sudo awf \
  --allow-domains api.github.com,registry-1.docker.io,auth.docker.io \
  -- docker run --rm curlimages/curl -fsS https://api.github.com/zen
```

The spawned container's network traffic is also filtered through the firewall.

## How It Works

The firewall uses a containerized architecture with three security layers:

1. **Squid Proxy (L7)**: Application-layer filtering with domain ACLs
2. **iptables NAT (L3/L4)**: Network-layer traffic redirection to Squid
3. **Docker Network Isolation**: Dedicated bridge network with host-level enforcement

```
┌─────────────────────────────────────────┐
│  Your Command                            │
│       ↓                                  │
│  ┌──────────────────────────────┐       │
│  │ Copilot Container            │       │
│  │ • Full filesystem access     │       │
│  │ • Docker-in-Docker support   │       │
│  │ • iptables NAT redirection   │       │
│  └──────────┬───────────────────┘       │
│             │ All HTTP/HTTPS             │
│             ↓                            │
│  ┌──────────────────────────────┐       │
│  │ Squid Proxy Container        │       │
│  │ • Domain ACL filtering       │       │
│  │ • Allow/deny decisions       │       │
│  │ • Traffic logging            │       │
│  └──────────┬───────────────────┘       │
│             ↓                            │
│      Allowed Domains Only                │
└─────────────────────────────────────────┘
```

**Learn more:** See the [Security Documentation](/gh-aw-firewall/reference/security-architecture/) for detailed architecture and threat model.

## Next Steps

<div class="sl-steps">

1. **Understand Security**
   
   Review the [Security Architecture](/gh-aw-firewall/reference/security-architecture/) to learn how the firewall protects against attacks.

2. **Read Full Documentation**
   
   Check the [README](https://github.com/githubnext/gh-aw-firewall#readme) for detailed usage examples and configuration options.

3. **Debug Issues**
   
   See the [troubleshooting guide](https://github.com/githubnext/gh-aw-firewall/blob/main/docs/troubleshooting.md) for common problems and solutions.

4. **Explore Examples**
   
   Browse the [examples directory](https://github.com/githubnext/gh-aw-firewall/tree/main/examples) for real-world use cases.

</div>

## Key Features

### Domain Whitelisting

Domains automatically match all subdomains:

```bash
# Whitelisting github.com allows:
# ✓ github.com
# ✓ api.github.com
# ✓ raw.githubusercontent.com
# ✗ example.com (not whitelisted)
```

### Host-Level Enforcement

The firewall uses Docker's **DOCKER-USER iptables chain** to enforce rules at the host level. This means:

- All containers on the firewall network are subject to filtering
- Spawned containers cannot bypass the firewall
- Protection works even with Docker-in-Docker
- No container-level configuration needed

### Comprehensive Logging

Every network request is logged with detailed information:

- **Squid access logs**: All HTTP/HTTPS traffic with allow/deny decisions
- **iptables kernel logs**: Non-HTTP protocols and blocked traffic
- **Automatic preservation**: Logs saved to `/tmp/*-logs-<timestamp>/` after execution

Use logs to audit agent behavior and debug connection issues.

### Minimal Configuration

No complex setup required - just specify allowed domains:

```bash
# Single domain
sudo awf --allow-domains github.com -- curl https://api.github.com

# Multiple domains
sudo awf --allow-domains github.com,arxiv.org,npmjs.org -- <command>

# From file
sudo awf --allow-domains-file domains.txt -- <command>
```

## Architecture Highlights

- **Zero Trust Model**: Block everything by default, allow only whitelisted domains
- **Defense in Depth**: Multiple security layers (Squid ACLs + iptables NAT + DOCKER-USER filtering)
- **Transparent Proxy**: Applications don't need proxy awareness or configuration
- **Container Isolation**: Dedicated bridge network with controlled routing
- **Exit Code Propagation**: Command exit codes preserved for CI/CD integration

## Requirements

- **Docker**: Must be installed and running
- **sudo/root**: Required for iptables manipulation and Docker network management
- **Linux**: Designed for Linux environments (tested on Ubuntu 22.04)

## Example Output

```bash
$ sudo awf --allow-domains github.com -- curl -s https://api.github.com/zen

[INFO] Allowed domains: github.com
[INFO] Starting containers...
[SUCCESS] Containers started successfully
[INFO] Executing command...
Half measures are as bad as nothing at all.
[SUCCESS] Command completed with exit code: 0
```

## Get Help

- **Documentation**: Browse the guides and reference pages in the sidebar
- **GitHub**: [Report issues](https://github.com/githubnext/gh-aw-firewall/issues) or contribute
- **Examples**: Check the [examples directory](https://github.com/githubnext/gh-aw-firewall/tree/main/examples)

Ready to dive deeper? Read the [full documentation on GitHub](https://github.com/githubnext/gh-aw-firewall#readme).
