# User Mode Architecture

## Overview

The agent container implements a **privilege separation** model where privileged operations run as root in the entrypoint, then privileges are dropped to a non-root user before executing user commands.

## Architecture

### Container Execution Flow

```
Container starts as root
  ↓
Entrypoint runs privileged setup:
  - Adjust awfuser UID/GID to match host (usermod/groupmod)
  - Configure DNS (/etc/resolv.conf)
  - Setup Docker socket permissions (groupadd docker, usermod)
  - Setup iptables NAT rules (requires NET_ADMIN capability)
  - Configure git safe directories
  ↓
Drop privileges with gosu
  ↓
Execute user command as awfuser (non-root)
```

### User Creation

The `awfuser` is created with UID/GID matching the host user:

1. **Build time** (`Dockerfile`): Creates user with default UID/GID (1000) or build args
2. **Runtime** (`entrypoint.sh`): Adjusts UID/GID if needed (via AWF_USER_UID/AWF_USER_GID env vars)

This ensures:
- Files created in mounted volumes have correct ownership
- Works with both GHCR images (fixed UID) and local builds (custom UID)

### Why Root is Still Needed in Entrypoint

The following operations require root privileges:

1. **iptables NAT setup** (`setup-iptables.sh`):
   - Requires NET_ADMIN capability
   - Redirects HTTP/HTTPS to Squid proxy
   - Prevents applications from bypassing proxy

2. **DNS configuration** (`/etc/resolv.conf`):
   - Root needed to modify system files
   - Configures trusted DNS servers

3. **Docker socket access** (`usermod`):
   - Creates/modifies docker group
   - Adds users to group
   - Required for MCP servers to spawn containers

4. **User management** (`usermod/groupmod`):
   - Adjust awfuser UID/GID at runtime
   - Root required to modify user database

### Security Benefits

1. **Reduced Attack Surface**:
   - User commands run as non-root
   - Cannot modify system files
   - Cannot escalate privileges

2. **Correct File Ownership**:
   - UID/GID matches host user
   - No permission issues with mounted volumes
   - Files created are owned by host user

3. **Docker Access**:
   - awfuser in docker group
   - MCP servers can spawn containers
   - Still non-root (docker group access only)

4. **Signal Handling**:
   - gosu properly forwards signals
   - Better than su/sudo for container entrypoints
   - Clean process termination

## Why awf Still Needs sudo

The `awf` CLI requires sudo for **host-level iptables** configuration:

- Creates DOCKER-USER chain rules
- Enforces firewall on ALL containers on awf-net
- Prevents spawned containers from bypassing firewall
- Requires root to modify kernel netfilter rules

**This is separate from agent container user mode**: The agent processes run as non-root inside the container, but the host-level firewall setup still requires root on the host.

## Implementation Details

### Dockerfile
```dockerfile
# Install gosu for privilege dropping
RUN apt-get install -y gosu

# Create non-root user with configurable UID/GID
ARG USER_UID=1000
ARG USER_GID=1000
RUN groupadd -g ${USER_GID} awfuser && \
    useradd -u ${USER_UID} -g ${USER_GID} -m -s /bin/bash awfuser
```

### Entrypoint
```bash
# Runtime UID/GID adjustment
HOST_UID=${AWF_USER_UID:-$(id -u awfuser)}
HOST_GID=${AWF_USER_GID:-$(id -g awfuser)}

if [ "$CURRENT_UID" != "$HOST_UID" ]; then
  usermod -u "$HOST_UID" awfuser
  groupmod -g "$HOST_GID" awfuser
fi

# ... privileged setup ...

# Drop privileges
exec gosu awfuser "$@"
```

### Docker Manager
```typescript
// Pass UID/GID as environment variables
environment.AWF_USER_UID = process.getuid().toString();
environment.AWF_USER_GID = process.getgid().toString();

// Pass as build args for local builds
agentService.build = {
  args: {
    USER_UID: process.getuid().toString(),
    USER_GID: process.getgid().toString(),
  }
};
```

## Testing

Run the integration test:
```bash
./tests/user-mode.test.sh
```

This verifies:
- awfuser is created
- gosu is installed
- UID/GID adjustment is implemented
- Privilege dropping is configured
