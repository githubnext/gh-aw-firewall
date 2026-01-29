# Chroot Mode (`--enable-chroot`)

## Overview

The `--enable-chroot` flag enables **transparent host binary execution** within the firewall's network isolation. When enabled, user commands run inside a `chroot /host` jail, making the host filesystem appear as the root filesystem. This allows commands to use host-installed binaries (Python, Node.js, Go, etc.) with their normal paths, while all network traffic remains controlled by the firewall.

**Key insight**: Chroot changes the filesystem view, not network isolation. The agent sees the host filesystem as `/`, but iptables rules still redirect all HTTP/HTTPS traffic through Squid.

## When to Use Chroot Mode

| Scenario | Recommended Mode |
|----------|------------------|
| GitHub Actions runner with pre-installed tools | `--enable-chroot` |
| Minimal container + host binaries | `--enable-chroot` |
| Self-contained container with all tools | Default (no chroot) |
| Need container-specific tool versions | Default (no chroot) |

**Primary use case**: Running AI agents on GitHub Actions runners where Python, Node.js, Go, and other tools are pre-installed. Instead of bundling everything in the container, use the host's tooling directly.

## How It Works

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Host (GitHub Actions Runner)                                            │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Docker Network Namespace (awf-net: 172.30.0.0/24)                 │ │
│  │                                                                    │ │
│  │   ┌──────────────────────────┐     ┌──────────────────────────┐  │ │
│  │   │ Agent Container          │     │ Squid Container          │  │ │
│  │   │ (172.30.0.20)            │────→│ (172.30.0.10)            │──┼─┼→ Internet
│  │   │                          │     │                          │  │ │
│  │   │ chroot /host             │     │ Domain ACL filtering     │  │ │
│  │   │ └─ command runs here     │     │                          │  │ │
│  │   │    sees host filesystem  │     │                          │  │ │
│  │   │    as /                  │     │                          │  │ │
│  │   └──────────────────────────┘     └──────────────────────────┘  │ │
│  │   ↑ iptables NAT redirects all HTTP/HTTPS to Squid               │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  Host binaries: /usr/bin/python3, /usr/bin/node, /usr/bin/curl, etc.  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Execution Flow

```
Container starts
    ↓
entrypoint.sh runs as root (container context)
    ↓
iptables rules applied (redirect HTTP/HTTPS to Squid)
    ↓
If AWF_CHROOT_ENABLED=true:
    ↓
    1. Verify capsh exists on host
    2. Copy DNS configuration to /host/etc/resolv.conf
    3. Map host user by UID
    4. Write command to temp script with PATH setup
    5. chroot /host
    6. Drop capabilities (CAP_NET_ADMIN, CAP_SYS_CHROOT)
    7. Switch to host user
    8. Execute command
    ↓
All child processes inherit chroot environment
All HTTP/HTTPS traffic → Squid proxy → Domain filtering
```

### What Changes in Chroot Mode

| Aspect | Without Chroot | With Chroot |
|--------|----------------|-------------|
| Filesystem root | Container's / | Host's / (via `chroot /host`) |
| Binary resolution | Container's `/usr/bin/python3` | Host's `/usr/bin/python3` |
| Host filesystem | Accessible at `/host` | Accessible at `/` |
| User context | awfuser (container) | Host user (by UID) |
| PATH | Container PATH | Reconstructed for host binaries |
| Network isolation | iptables → Squid | iptables → Squid (unchanged) |

## Usage

### Basic Usage

```bash
# Run a command using host binaries
sudo awf --enable-chroot --allow-domains api.github.com \
  -- python3 -c "import requests; print(requests.get('https://api.github.com').status_code)"

# Run with environment variable passthrough
sudo awf --enable-chroot --env-all --allow-domains api.github.com \
  -- curl https://api.github.com
```

### Combined with --env-all

The `--env-all` flag complements `--enable-chroot` by passing host environment variables:

```bash
sudo awf --enable-chroot --env-all --allow-domains api.github.com \
  -- bash -c 'echo "Home: $HOME, User: $USER"'
```

Environment variables preserved include:
- `GOPATH`, `PYTHONPATH`, `NODE_PATH` (tool configuration)
- `HOME` (user's real home directory)
- `GITHUB_TOKEN`, `GH_TOKEN` (credentials)
- Custom environment variables

**Note**: System variables like `PATH`, `PWD`, and `SUDO_*` are excluded for security. PATH is reconstructed inside the chroot.

### GitHub Actions Example

```yaml
- name: Run AI agent with host tools
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    sudo -E npx awf \
      --enable-chroot \
      --env-all \
      --allow-domains api.github.com,github.com \
      -- copilot -p "Review this PR" --allow-tool github
```

## Volume Mounts

In chroot mode, selective paths are mounted for security instead of the entire filesystem:

### Read-Only Mounts (System Binaries)

| Host Path | Container Path | Purpose |
|-----------|----------------|---------|
| `/usr` | `/host/usr:ro` | System binaries and libraries |
| `/bin` | `/host/bin:ro` | Essential binaries |
| `/sbin` | `/host/sbin:ro` | System binaries |
| `/lib` | `/host/lib:ro` | Shared libraries |
| `/lib64` | `/host/lib64:ro` | 64-bit shared libraries |
| `/opt` | `/host/opt:ro` | Tool cache (Python, Node, Go) |
| `/etc/ssl` | `/host/etc/ssl:ro` | SSL certificates |
| `/etc/ca-certificates` | `/host/etc/ca-certificates:ro` | CA certificates |
| `/etc/passwd` | `/host/etc/passwd:ro` | User lookup |
| `/etc/group` | `/host/etc/group:ro` | Group lookup |
| `/proc` | `/host/proc:ro` | Process info (read-only) |

### Read-Write Mounts

| Host Path | Container Path | Purpose |
|-----------|----------------|---------|
| `$HOME` | `$HOME:rw` | User's home directory |
| `/tmp` | `/host/tmp:rw` | Temporary files |

### Hidden Paths (Security)

| Host Path | Mount Target | Purpose |
|-----------|--------------|---------|
| `/var/run/docker.sock` | `/dev/null` | Prevents firewall bypass via `docker run` |
| `/run/docker.sock` | `/dev/null` | Prevents firewall bypass |

## Security Model

### Capability Management

The container starts with capabilities needed for setup, then drops them before executing user commands:

| Capability | During Setup | Before User Command | Purpose |
|------------|--------------|---------------------|---------|
| `CAP_NET_ADMIN` | Granted | **Dropped** | iptables setup, then prevented |
| `CAP_SYS_CHROOT` | Granted | **Dropped** | Entrypoint chroot, then prevented |
| `CAP_NET_RAW` | Denied | Denied | Prevents raw socket bypass |
| `CAP_SYS_PTRACE` | Denied | Denied | Prevents process debugging |
| `CAP_SYS_MODULE` | Denied | Denied | Prevents kernel module loading |

After capability drop, the process has:
```
CapInh: 0000000000000000
CapPrm: 0000000000000000
CapEff: 0000000000000000  # No effective capabilities
CapBnd: 00000000a00005fb  # Cannot regain NET_ADMIN or SYS_CHROOT
```

### Attack Vector Analysis

| Attack Vector | Protection | Mechanism |
|---------------|------------|-----------|
| Bypass firewall via raw sockets | Protected | `CAP_NET_RAW` dropped |
| Modify iptables rules | Protected | `CAP_NET_ADMIN` dropped |
| Nested chroot escape | Protected | `CAP_SYS_CHROOT` dropped |
| Spawn container to bypass | Protected | Docker socket hidden (`/dev/null`) |
| Direct host network access | Protected | Network namespace isolation |
| Kernel exploits | Not protected | Container limitation (shares host kernel) |

### Why Firewall Still Works in Chroot

Linux namespaces operate independently:

| Namespace | Affected by chroot? | Security Implication |
|-----------|---------------------|----------------------|
| **Network namespace** | NO | iptables rules still apply |
| **PID namespace** | NO | Process isolation maintained |
| **Mount namespace** | Partially | Filesystem view changes, isolation preserved |
| **User namespace** | NO | Runs as regular user, not root |

**Critical point**: `chroot` only changes which filesystem tree is visible. It does NOT:
- Escape Docker's network namespace
- Bypass iptables rules
- Give access to host's network stack

## Security Trade-offs

### Documented Risks

| Risk | Severity | Description | Mitigation |
|------|----------|-------------|------------|
| Host file access | HIGH | `$HOME` is read-write | CI/CD secrets should use env vars, not files |
| /proc visibility | MEDIUM | Can enumerate host processes | Read-only mount, cannot modify |
| DNS override | LOW | Host's `/etc/resolv.conf` temporarily modified | Backup created, restored on exit |
| /dev visibility | LOW | Device nodes visible | Read-only, cannot create new devices |

### Host File Access

With chroot mode, the agent can read/write to the user's home directory:

| Path | Access | Risk |
|------|--------|------|
| `$HOME/.ssh/*` | READ/WRITE | SSH keys accessible |
| `$HOME/.aws/*` | READ/WRITE | AWS credentials accessible |
| `$HOME/.config/*` | READ/WRITE | Various configs |
| `/etc/passwd` | READ | User enumeration |
| `/usr/bin/*` | READ | System binaries |

**Mitigation**: This is a documented trade-off for the egress control use case. For GitHub Actions:
- Use GitHub Secrets (env vars, not files)
- Use short-lived tokens (`GITHUB_TOKEN` expires)
- Consider what files exist on your runners

### Process Visibility

Inside the chroot, `/proc` shows host processes:

```bash
# Inside chroot
ls /proc/
1  2  3  ...  # Host PIDs visible

cat /proc/1/cmdline
/sbin/init  # Host's init process
```

**Mitigation**: `/proc` is mounted read-only. Cannot modify kernel parameters or send signals to host processes.

### DNS Configuration

The container copies its DNS configuration to the host:

```bash
# Host's /etc/resolv.conf is backed up and replaced
/etc/resolv.conf.awf-backup-<pid>  # Backup
/etc/resolv.conf                    # AWF DNS config during execution
```

**Recovery**: If AWF crashes without cleanup:
```bash
sudo mv /etc/resolv.conf.awf-backup-* /etc/resolv.conf
```

## Requirements

### Host System Requirements

| Requirement | Description |
|-------------|-------------|
| `capsh` | Must be installed on host (usually in `libcap2-bin` package) |
| User by UID | Host user must exist in `/etc/passwd` |
| Docker | Standard Docker requirement |
| sudo | Required for iptables manipulation |

### Installing capsh

```bash
# Debian/Ubuntu
sudo apt-get install libcap2-bin

# RHEL/Fedora
sudo dnf install libcap
```

## Troubleshooting

### Error: capsh not found

```
[entrypoint][ERROR] capsh not found on host system
[entrypoint][ERROR] Install libcap2-bin package: apt-get install libcap2-bin
```

**Fix**: Install the `libcap2-bin` package on the host.

### Error: Working directory does not exist

```
[entrypoint][WARN] Working directory /home/user does not exist on host, will use /
```

**Fix**: Ensure the working directory exists on the host, or use `--work-dir` to specify a different directory.

### Binary not found

If a binary isn't found inside the chroot, check:

1. Is the binary installed on the host?
2. Is it in a standard PATH location?
3. For GitHub Actions tool cache, check `/opt/hostedtoolcache/`

### Network requests fail

Chroot doesn't affect network isolation. If requests fail:

1. Check `--allow-domains` includes the target domain
2. Check Squid logs: `sudo cat /tmp/squid-logs-*/access.log`
3. Verify iptables rules are in place

## Comparison with Alternatives

### Option A: Chroot Mode (Current)

```bash
sudo awf --enable-chroot --allow-domains api.github.com \
  -- python3 script.py
```

**Pros**: Transparent binary access, minimal container, uses host tools
**Cons**: Host filesystem access, /proc visible

### Option B: Full Container (Default)

```bash
sudo awf --agent-image act --allow-domains api.github.com \
  -- python3 script.py
```

**Pros**: Isolated filesystem, all tools in container
**Cons**: Larger container, may miss host-specific tools

### Option C: Custom Volume Mounts

```bash
sudo awf --mount /opt/tools:/opt/tools:ro --allow-domains api.github.com \
  -- /opt/tools/python3 script.py
```

**Pros**: Selective access, explicit paths
**Cons**: Requires explicit paths, more configuration

## Related Documentation

- [Architecture](./architecture.md) - Overall firewall architecture
- [Security Architecture](../docs-site/src/content/docs/reference/security-architecture.md) - Detailed security model
- [Environment Variables](./environment.md) - Environment configuration with `--env-all`
- [CLI Reference](../docs-site/src/content/docs/reference/cli-reference.md) - Complete CLI options
