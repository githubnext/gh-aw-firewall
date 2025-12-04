# Agent Container User Mode

## Overview

Agent processes (GitHub Copilot CLI, user commands) run as **non-root** (`awfuser`) inside the container for enhanced security.

## How It Works

```
Container starts as root
  ↓
Entrypoint performs privileged setup (iptables, DNS, docker group)
  ↓
Drop privileges with gosu
  ↓
Execute user command as awfuser (non-root)
```

The `awfuser` UID/GID is adjusted at runtime to match the host user, ensuring correct file ownership for mounted volumes.

## Security Benefits

- **Reduced attack surface**: User commands cannot modify system files or escalate privileges
- **Correct file ownership**: Files created in mounted volumes match host user ownership
- **Works seamlessly**: Compatible with both GHCR images and local builds

## Why awf Still Needs sudo

The `awf` CLI requires sudo for host-level iptables (DOCKER-USER chain), which is separate from agent container user mode. Agent processes run as non-root, while host firewall setup requires root.
