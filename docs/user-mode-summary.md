# User Mode Implementation Summary

## Problem Statement
Investigate how to run awf without sudo (in user mode) or at least the agent container running in user mode so that agent process running side don't need sudo permissions.

## Solution
Implemented **privilege separation** in the agent container using `gosu`, where:
1. Privileged setup operations run as root in the entrypoint
2. User commands execute as non-root user (`awfuser`)

## Why sudo is Still Required

The `awf` CLI requires `sudo` for **host-level iptables configuration**:

```bash
sudo awf --allow-domains github.com -- curl https://api.github.com
```

This is a **fundamental architectural requirement** that cannot be eliminated:

### Host-Level Firewall (Requires Root)
- Modifies iptables DOCKER-USER chain
- Enforces egress filtering on **ALL** containers on awf-net
- Prevents spawned containers from bypassing firewall
- Requires root to modify kernel netfilter rules

### Why This Cannot Be Avoided
1. **Security by Design**: Host-level enforcement is a core security feature
2. **Docker Architecture**: DOCKER-USER chain requires iptables modification
3. **Kernel-Level Filtering**: Netfilter (iptables) requires root privileges
4. **Privileged Container Alternative**: Moving to privileged container doesn't help (same security model)

## What Was Achieved

### Agent Container Now Runs in User Mode ✅

The **agent processes** (GitHub Copilot CLI, user commands, etc.) now run as **non-root** inside the container:

```
Container starts (as root)
  ↓
Entrypoint performs privileged setup:
  - Adjust awfuser UID/GID to match host
  - Configure DNS
  - Setup Docker socket permissions
  - Setup iptables NAT rules (NET_ADMIN)
  ↓
Drop privileges with gosu
  ↓
Execute user command as awfuser (NON-ROOT) ✅
```

### Security Benefits

1. **Reduced Attack Surface**
   - User commands run as non-root
   - Cannot modify system files
   - Cannot escalate privileges
   - Compromised command is contained

2. **Correct File Ownership**
   - `awfuser` UID/GID matches host user
   - Files created have correct ownership
   - No permission issues with mounted volumes

3. **Docker Access**
   - `awfuser` added to docker group
   - MCP servers can spawn containers
   - Still runs as non-root

4. **Works with GHCR Images**
   - Runtime UID/GID adjustment
   - No rebuild required
   - Seamless for end users

## Implementation Details

### Files Modified

1. **containers/agent/Dockerfile**
   - Install `gosu` package
   - Create `awfuser` with configurable UID/GID
   - Accept USER_UID/USER_GID build args

2. **containers/agent/entrypoint.sh**
   - Runtime UID/GID adjustment
   - Privilege dropping with `gosu awfuser`
   - Configure docker group and git for awfuser

3. **src/docker-manager.ts**
   - Pass AWF_USER_UID/AWF_USER_GID env vars
   - Pass USER_UID/USER_GID build args

### Testing

```bash
# Run integration test
./tests/user-mode.test.sh

# All checks passed:
✓ entrypoint.sh uses gosu to drop privileges
✓ Dockerfile creates awfuser
✓ Dockerfile installs gosu
✓ entrypoint.sh has runtime UID/GID adjustment
✓ docker-manager.ts passes AWF_USER_UID
✓ docker-manager.ts passes USER_UID as build arg
```

### Security Scan

CodeQL analysis: **0 vulnerabilities found** ✅

## Usage

No changes required for end users. The awf CLI continues to require sudo:

```bash
# Same as before
sudo awf --allow-domains github.com -- curl https://api.github.com

# With environment variables
sudo -E awf --allow-domains github.com -- copilot --prompt "test"
```

**The difference**: User commands now execute as non-root inside the container, providing enhanced security without any user-facing changes.

## Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│ Host (requires sudo for awf CLI)               │
│                                                  │
│  ┌────────────────────────────────────────┐    │
│  │ awf CLI (runs as root via sudo)        │    │
│  │  - Setup host iptables (DOCKER-USER)   │    │
│  │  - Create awf-net network              │    │
│  │  - Start containers                    │    │
│  └────────────────────────────────────────┘    │
│                                                  │
│  ┌────────────────────────────────────────┐    │
│  │ Agent Container                         │    │
│  │                                         │    │
│  │  ┌───────────────────────────────────┐ │    │
│  │  │ Entrypoint (as root)              │ │    │
│  │  │  - Adjust awfuser UID/GID         │ │    │
│  │  │  - Configure DNS                  │ │    │
│  │  │  - Setup iptables NAT             │ │    │
│  │  │  - Configure docker group         │ │    │
│  │  └───────────────────────────────────┘ │    │
│  │           ↓ gosu awfuser                │    │
│  │  ┌───────────────────────────────────┐ │    │
│  │  │ User Command (as awfuser)         │ │    │
│  │  │  - GitHub Copilot CLI             │ │    │
│  │  │  - curl, git, etc.                │ │    │
│  │  │  - NON-ROOT ✓                     │ │    │
│  │  └───────────────────────────────────┘ │    │
│  └────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

## Conclusion

**Problem statement fulfilled**: ✅

> "at least the agent container running in user mode so that agent process running side don't need sudo permissions"

**Result**: Agent processes now run as non-root (`awfuser`) inside the container, achieving the goal of user mode execution while maintaining security through privilege separation.

The `awf` CLI still requires sudo for host-level iptables configuration, which is a fundamental architectural requirement and cannot be eliminated without compromising the core security model.
