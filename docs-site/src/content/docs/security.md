---
title: Security Architecture
description: Deep dive into the firewall's defense-in-depth security model, threat analysis, and protection mechanisms.
---

# Security Architecture

This document provides a comprehensive security analysis of the Agentic Workflow Firewall designed for security engineers evaluating the tool for production use.

## Executive Summary

The Agentic Workflow Firewall implements a **defense-in-depth** strategy using three independent security layers to control egress network traffic for AI agents. The architecture prevents unauthorized network access while maintaining the filesystem access and Docker capabilities required for modern agentic workflows.

**Security Layers:**
1. **L7 Application Filtering** - Squid proxy with domain-based ACLs
2. **L3/L4 Network Enforcement** - iptables NAT redirection and filtering rules
3. **Host-Level Protection** - Docker DOCKER-USER chain for container egress control

**Key Security Properties:**
- **Zero Trust Default**: All outbound traffic blocked unless explicitly whitelisted
- **Multi-Layer Defense**: Each layer independently enforces security policy
- **Attack Surface Reduction**: Minimal container capabilities, no privilege escalation
- **Complete Auditability**: All allowed and denied traffic logged with full context
- **Cryptographic Verification**: Proxy uses SNI inspection for HTTPS domain validation

## Threat Model

### Assumptions

**What We Trust:**
- Host operating system and kernel
- Docker daemon and containerd runtime
- Squid proxy implementation (mature, battle-tested software)
- iptables/netfilter kernel subsystem
- User-provided domain whitelist is intentional and correct

**What We Don't Trust:**
- AI agent behavior (may be malicious, compromised, or buggy)
- MCP servers (third-party code with network access)
- User commands running inside the firewall
- Spawned containers and child processes
- Application libraries and dependencies

### Threat Scenarios

#### 1. Direct Egress to Unauthorized Domains

**Attack:** Agent attempts HTTP/HTTPS requests to non-whitelisted domains.

**Mitigations:**
- **Layer 1**: iptables NAT redirects all HTTP/HTTPS to Squid (cannot bypass)
- **Layer 2**: Squid ACLs deny non-whitelisted domains (returns 403)
- **Layer 3**: Host DOCKER-USER chain blocks direct IP connections

**Result:** Attack fails. Traffic logged as `TCP_DENIED` in Squid access logs.

#### 2. DNS Poisoning

**Attack:** Use `--add-host` to map whitelisted domain to malicious IP.

**Mitigations:**
- **Docker wrapper interception**: `docker-wrapper.sh` blocks `--add-host` flag
- **Proxy verification**: Squid validates domains using SNI for HTTPS
- **Logging**: DNS resolution logged in Squid cache logs

**Result:** Attack blocked at Docker wrapper layer with error message.

**Example blocked command:**
```bash
# This is BLOCKED by the firewall
docker run --add-host=github.com:1.2.3.4 alpine curl https://github.com
# [FIREWALL] ERROR: --add-host is not allowed (enables DNS poisoning)
```

#### 3. Network Host Mode Bypass

**Attack:** Use `--network host` to escape bridge network isolation.

**Mitigations:**
- **Docker wrapper interception**: `docker-wrapper.sh` blocks `--network host`
- **Automatic network injection**: Wrapper forces `--network awf-net`
- **Host-level fallback**: Even if bypassed, DOCKER-USER chain filters egress

**Result:** Attack blocked at Docker wrapper layer.

**Example blocked command:**
```bash
# This is BLOCKED by the firewall
docker run --network host alpine curl https://example.com
# [FIREWALL] ERROR: --network host is not allowed (bypasses firewall)
```

#### 4. Privileged Container Escape

**Attack:** Use `--privileged` flag to gain CAP_SYS_ADMIN and disable iptables.

**Mitigations:**
- **Docker wrapper interception**: `docker-wrapper.sh` blocks `--privileged` flag
- **Minimal capabilities**: Copilot container runs with only NET_ADMIN (not SYS_ADMIN)
- **Host-level enforcement**: DOCKER-USER chain applies regardless of container capabilities

**Result:** Attack blocked at Docker wrapper layer.

**Example blocked command:**
```bash
# This is BLOCKED by the firewall
docker run --privileged alpine sh -c "iptables -F && curl https://example.com"
# [FIREWALL] ERROR: --privileged is not allowed (bypasses all security)
```

#### 5. IP-Based Direct Connection

**Attack:** Connect directly to IP address instead of domain name.

**Mitigations:**
- **Squid ACLs**: Only domain-based ACLs configured (no IP allowlists)
- **SNI requirement**: HTTPS requires SNI header with valid domain
- **iptables logging**: Non-proxied traffic logged with `[FW_BLOCKED_*]` prefix

**Result:** Attack fails. HTTPS requires SNI with whitelisted domain; HTTP to IP is denied by Squid.

**Example:**
```bash
# Direct IP access is BLOCKED
sudo awf --allow-domains github.com -- curl http://140.82.121.6
# Squid returns 403: Access Denied (IP not in domain allowlist)
```

#### 6. Protocol Downgrade/Bypass

**Attack:** Use non-HTTP protocols (SSH, FTP, custom protocols) to exfiltrate data.

**Mitigations:**
- **iptables filtering**: Only HTTP (80) and HTTPS (443) redirected to proxy
- **Host DOCKER-USER chain**: Blocks all other TCP/UDP ports (except DNS)
- **Default deny**: Unknown protocols logged and rejected

**Result:** Attack blocked at iptables layer. Logged with `[FW_BLOCKED_OTHER]` prefix.

**Example:**
```bash
# SSH connections are BLOCKED
sudo awf --allow-domains github.com -- ssh git@github.com
# Connection fails - port 22 traffic blocked by iptables
```

#### 7. Docker Socket Privilege Escalation

**Attack:** Use mounted Docker socket to spawn an unfiltered container.

**Mitigations:**
- **Network enforcement**: All spawned containers forced onto `awf-net` by wrapper
- **Wrapper interception**: `docker-wrapper.sh` injects `--network awf-net` to all runs
- **Host-level filtering**: DOCKER-USER chain applies to ALL containers on bridge
- **Flag blocking**: Wrapper prevents `--network host`, `--privileged`, `--add-host`

**Result:** Spawned containers are subject to same firewall rules as parent.

**Attack scenario:**
```bash
# Attacker tries to spawn container with host network
sudo awf --allow-domains github.com -- \
  docker run --network host alpine curl https://example.com
# BLOCKED: wrapper intercepts and denies --network host
```

#### 8. Container Breakout via /host Mount

**Attack:** Modify host files to disable firewall or exfiltrate data.

**Mitigations:**
- **Filesystem access by design**: The firewall does NOT restrict filesystem access (intentional)
- **Network-only enforcement**: Protection layer is network traffic, not filesystem
- **Logging**: Cannot prevent file writes, but network exfiltration still blocked

**Non-Goal:** The firewall is designed to control **network egress only**. Filesystem access is required for agents to read/write files, and restricting it would break legitimate workflows.

**Note:** If an agent writes data to `/host`, it cannot exfiltrate it over the network to unauthorized domains. Filesystem writes are logged by container runtime and can be audited separately.

#### 9. Localhost Bypass Attack

**Attack:** Run a local HTTP server and proxy traffic through it to bypass Squid.

**Mitigations:**
- **Localhost exemption is intentional**: Required for stdio MCP servers
- **Limited scope**: Only affects traffic within the container (cannot egress to external IPs)
- **Single container isolation**: Each run gets fresh container, no persistent state

**Result:** Localhost traffic is allowed (by design) but cannot reach external networks. This is acceptable because:
- Stdio MCP servers communicate via stdin/stdout (no network)
- Local HTTP servers cannot forward to external IPs (blocked by DOCKER-USER chain)
- Container is ephemeral (destroyed after command completes)

#### 10. Squid Proxy Exploitation

**Attack:** Exploit vulnerability in Squid to bypass ACLs or gain unauthorized access.

**Mitigations:**
- **Minimal exposure**: Squid only accessible from copilot container, not externally
- **Upstream security**: Using official `ubuntu/squid` image with regular updates
- **Configuration hardening**: No caching, minimal features enabled, strict ACLs
- **Defense in depth**: Even if Squid is bypassed, host DOCKER-USER chain provides fallback

**Recommendation:** Regularly update Squid image to get security patches.

## Security Architecture

### Layer 1: Squid Proxy (L7 Application Filtering)

**Purpose**: Domain-based access control at the HTTP/HTTPS application layer.

**Implementation:**
- Squid runs as dedicated container on isolated network
- Configuration generated dynamically from user's domain whitelist
- ACLs use domain matching with automatic subdomain support
- HTTPS traffic filtered via CONNECT method and SNI inspection

**Configuration Example:**
```squid
# Domain ACL entries (generated from --allow-domains)
acl allowed_domains dstdomain .github.com
acl allowed_domains dstdomain .googleapis.com

# Deny non-whitelisted domains
http_access deny !allowed_domains

# Allow whitelisted domains
http_access allow localnet
http_access allow localhost
```

**HTTPS Handling:**
- Squid acts as **CONNECT proxy** (not SSL-intercepting proxy)
- No TLS termination or man-in-the-middle decryption
- Domain filtering based on **SNI (Server Name Indication)** header
- Preserves end-to-end TLS encryption between client and origin

**Security Properties:**
- ✓ Cannot be bypassed from within copilot container (iptables NAT enforced)
- ✓ Validates domains cryptographically via SNI (cannot spoof for HTTPS)
- ✓ Logs all traffic (allowed and denied) with full context
- ✓ Isolated from external network (only accessible via bridge)

**Limitations:**
- Does not inspect encrypted payload (by design - privacy-preserving)
- Relies on DNS resolution for domain-to-IP mapping
- CONNECT method for HTTPS prevents URL path inspection

### Layer 2: iptables NAT (L3/L4 Network Redirection)

**Purpose**: Force all HTTP/HTTPS traffic through Squid proxy using network-layer redirection.

**Implementation:**
- iptables rules applied inside copilot container at startup
- Uses **NAT table OUTPUT chain** to intercept egress traffic
- Redirects HTTP (port 80) and HTTPS (port 443) to Squid via DNAT
- Allows essential traffic: localhost, DNS, traffic to Squid itself

**iptables Rules (in priority order):**
```bash
# 1. Allow localhost (for stdio MCP servers)
iptables -t nat -A OUTPUT -o lo -j RETURN
iptables -t nat -A OUTPUT -d 127.0.0.0/8 -j RETURN

# 2. Allow DNS
iptables -t nat -A OUTPUT -p udp --dport 53 -j RETURN
iptables -t nat -A OUTPUT -p tcp --dport 53 -j RETURN

# 3. Allow traffic to Squid proxy
iptables -t nat -A OUTPUT -d 172.30.0.10 -j RETURN

# 4. Redirect HTTP to Squid
iptables -t nat -A OUTPUT -p tcp --dport 80 -j DNAT --to-destination 172.30.0.10:3128

# 5. Redirect HTTPS to Squid
iptables -t nat -A OUTPUT -p tcp --dport 443 -j DNAT --to-destination 172.30.0.10:3128
```

**Security Properties:**
- ✓ Enforced at kernel level (cannot be bypassed by user-space applications)
- ✓ Applied before container starts executing user command
- ✓ NET_ADMIN capability required (but not CAP_SYS_ADMIN)
- ✓ Works for all processes in container, including spawned child processes

**Scope:**
- These NAT rules apply to the **copilot container itself**
- Spawned containers use DOCKER-USER chain enforcement (Layer 3)

### Layer 3: Host DOCKER-USER Chain (Container Egress Control)

**Purpose**: Host-level firewall enforcement for ALL containers on the firewall bridge network.

**Implementation:**
- Uses Docker's **DOCKER-USER iptables chain** (executes before Docker's own rules)
- Creates dedicated `FW_WRAPPER` chain with filtering rules
- Applies to all egress traffic from containers on `awf-net` bridge (172.30.0.0/24)
- Blocks traffic from spawned containers even if they try to bypass layers 1 and 2

**Chain Structure:**
```bash
# Create dedicated FW_WRAPPER chain
iptables -t filter -N FW_WRAPPER

# 1. Allow Squid proxy to reach external destinations (unrestricted)
iptables -t filter -A FW_WRAPPER -s 172.30.0.10 -j ACCEPT

# 2. Allow established/related connections (return traffic)
iptables -t filter -A FW_WRAPPER -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# 3. Allow localhost
iptables -t filter -A FW_WRAPPER -o lo -j ACCEPT
iptables -t filter -A FW_WRAPPER -d 127.0.0.0/8 -j ACCEPT

# 4. Allow DNS
iptables -t filter -A FW_WRAPPER -p udp --dport 53 -j ACCEPT
iptables -t filter -A FW_WRAPPER -p tcp --dport 53 -j ACCEPT

# 5. Allow traffic to Squid proxy
iptables -t filter -A FW_WRAPPER -p tcp -d 172.30.0.10 --dport 3128 -j ACCEPT

# 6. Block multicast and link-local
iptables -t filter -A FW_WRAPPER -m addrtype --dst-type MULTICAST -j REJECT
iptables -t filter -A FW_WRAPPER -d 169.254.0.0/16 -j REJECT
iptables -t filter -A FW_WRAPPER -d 224.0.0.0/4 -j REJECT

# 7. Log and block UDP (except DNS)
iptables -t filter -A FW_WRAPPER -p udp ! --dport 53 -j LOG --log-prefix '[FW_BLOCKED_UDP] '
iptables -t filter -A FW_WRAPPER -p udp ! --dport 53 -j REJECT

# 8. Log and block all other traffic (default deny)
iptables -t filter -A FW_WRAPPER -j LOG --log-prefix '[FW_BLOCKED_OTHER] '
iptables -t filter -A FW_WRAPPER -j REJECT

# Insert jump rule in DOCKER-USER (applies to all egress from awf-net bridge)
iptables -t filter -I DOCKER-USER -i fw-bridge -j FW_WRAPPER
```

**Security Properties:**
- ✓ Applies to ALL containers on `awf-net`, not just copilot container
- ✓ Enforced at host level (cannot be modified from inside containers)
- ✓ Executes before Docker's own DOCKER-ISOLATION rules
- ✓ Blocks traffic even if container has NET_ADMIN capability
- ✓ Prevents spawned containers from bypassing firewall

**Critical Insight:**
The DOCKER-USER chain is Docker's official extension point for custom firewall rules. It's executed for **every packet** leaving containers on the bridge, before Docker's own isolation rules. This means even if an attacker:
- Disables iptables rules inside their container
- Spawns a new container with different network settings
- Tries to use raw sockets or custom protocols

They **cannot bypass** the host-level DOCKER-USER filtering.

### Defense-in-Depth Visualization

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: Host DOCKER-USER Chain (iptables on host)         │
│ • Applies to ALL containers on awf-net bridge               │
│ • Blocks non-HTTP/HTTPS egress (except DNS, localhost)      │
│ • Cannot be modified from inside containers                 │
│ • Last line of defense                                      │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: iptables NAT (inside copilot container)           │
│ • Redirects HTTP/HTTPS to Squid proxy (DNAT)               │
│ • Enforced at kernel level (netfilter)                      │
│ • Applied before user command executes                      │
│ • Works for spawned child processes                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: Squid Proxy ACLs (application layer)              │
│ • Domain-based filtering with subdomain matching           │
│ • SNI validation for HTTPS traffic                          │
│ • Comprehensive logging of all requests                     │
│ • Returns 403 for non-whitelisted domains                   │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
                  Allowed Domains Only
```

**Why Three Layers?**

1. **Layer 1 (Squid)** provides **precise application-layer control** with domain matching
2. **Layer 2 (NAT)** ensures traffic **cannot bypass Squid** from within copilot container
3. **Layer 3 (DOCKER-USER)** prevents **spawned containers from escaping** the firewall

If any single layer fails or is bypassed, the other two layers still enforce the policy.

## Container Security Model

### Copilot Container

**Base Image:** `ubuntu:22.04` (official Ubuntu image)

**Installed Packages:**
- System: `iptables`, `curl`, `ca-certificates`, `dnsutils`
- Development: `git`, `nodejs`, `npm`
- Docker: `docker-ce-cli` (client only, uses host daemon)

**Capabilities:**
- **Granted**: `NET_ADMIN` (required for iptables NAT manipulation)
- **Not Granted**: `SYS_ADMIN`, `SYS_MODULE`, `SYS_PTRACE`, etc.

**Why NET_ADMIN is Safe:**
- Allows iptables manipulation **inside container's network namespace only**
- Cannot modify host network stack or other container's rules
- Cannot load kernel modules or change sysctl parameters
- Does not grant privilege escalation or container escape abilities

**Filesystem Mounts:**
- `/host` → entire host filesystem (read-write) - **intentional for agent file access**
- `$HOME` → user home directory (read-write) - **for Copilot CLI and MCP config**
- `/var/run/docker.sock` → Docker socket (read-write) - **for Docker-in-Docker**

**Why Filesystem Access is Granted:**

The firewall's security boundary is **network egress**, not filesystem access. AI agents need:
- Read access to source code and files for analysis
- Write access to generate/modify code and outputs
- Docker socket access to spawn MCP servers and tools

**Security Tradeoff:**
- ✓ Agents can read/write files (required for functionality)
- ✓ Network exfiltration is blocked (data cannot leave via HTTP/HTTPS)
- ✗ Agents could write sensitive data to disk
- ✗ Not protected: local file exfiltration, privilege escalation via host filesystem

**Recommendation:** Use filesystem access controls (AppArmor, SELinux) if you need to restrict file access in addition to network filtering.

### Squid Container

**Base Image:** `ubuntu/squid:latest` (official Ubuntu Squid image)

**Capabilities:**
- No additional capabilities (runs as unprivileged `proxy` user)
- Minimal attack surface (single-purpose proxy)

**Network:**
- Fixed IP: `172.30.0.10/24`
- Only accessible from copilot container and spawned containers
- Not exposed on host network (port 3128 not published)

**Firewall Exemption:**
- Squid has **unrestricted outbound access** (necessary to reach whitelisted domains)
- Host DOCKER-USER chain allows all traffic from `172.30.0.10`
- This is safe because Squid enforces ACLs before making outbound connections

**Configuration Security:**
- Config generated dynamically (not user-editable at runtime)
- No caching enabled (prevents cache poisoning attacks)
- Minimal forwarding headers (privacy-preserving)
- Strict port restrictions (only 80 and 443)

### Docker Wrapper (`docker-wrapper.sh`)

**Purpose**: Intercept `docker run` commands to enforce firewall policy on spawned containers.

**Implementation:**
- Symlinked at `/usr/bin/docker` (real docker at `/usr/bin/docker-real`)
- Shell script that parses `docker run` arguments
- Automatically injects security flags before delegation to real docker

**Security Enforcement:**

1. **Blocks dangerous flags:**
   - `--privileged` - Grants full host access, can disable firewall
   - `--add-host` - Enables DNS poisoning to bypass domain filtering
   - `--network host` - Bypasses bridge network isolation

2. **Injects required flags:**
   - `--network awf-net` - Forces container onto firewall bridge
   - `-e HTTP_PROXY=http://172.30.0.10:3128` - Configures proxy (compatibility)
   - `-e HTTPS_PROXY=http://172.30.0.10:3128` - Configures proxy (compatibility)

**Logging:**
- All docker commands logged to `/tmp/docker-wrapper.log` (inside container)
- Includes timestamp, decision (injected/blocked/passed-through), and full command
- Useful for debugging and auditing agent behavior

**Example Log Entries:**
```
[2025-01-15T10:30:45-05:00] WRAPPER CALLED: docker run -i --rm alpine curl https://github.com
[2025-01-15T10:30:45-05:00] INJECTING --network awf-net and proxy env vars
[2025-01-15T10:30:50-05:00] WRAPPER CALLED: docker run --privileged alpine sh
[2025-01-15T10:30:50-05:00] BLOCKED: --privileged bypasses all firewall restrictions
```

**Bypass Resistance:**
- Wrapper cannot be bypassed by calling `/usr/bin/docker-real` (requires knowing internal implementation)
- Even if bypassed, host DOCKER-USER chain still enforces filtering
- Container cannot replace wrapper (filesystem read-only for system paths)

## Network Architecture

### Isolated Bridge Network

**Network:** `awf-net` (172.30.0.0/24)
- **Squid Proxy:** 172.30.0.10
- **Copilot Container:** 172.30.0.20
- **Spawned Containers:** DHCP (172.30.0.21 - 172.30.0.254)

**Bridge Interface:** `fw-bridge` (explicitly named for iptables rules)

**DNS Resolution:**
- Google Public DNS: 8.8.8.8, 8.8.4.4 (configured in both Squid and containers)
- Docker's embedded DNS: 127.0.0.11 (for service discovery)
- DNS traffic allowed through all firewall layers

**Network Isolation:**
- Bridge network not connected to other Docker networks
- No published ports (proxy not accessible externally)
- No inter-container traffic except copilot → Squid → external

**Routing:**
```
Container → (iptables NAT) → Squid Proxy → (Squid ACL) → External Network
    ↓ (blocked traffic)
   REJECT (iptables filter or Squid 403)
```

### Traffic Flow Analysis

#### Allowed HTTPS Request

```
1. Container process: curl https://api.github.com
2. DNS resolution: api.github.com → 140.82.121.6 (allowed via iptables)
3. TCP connect to 140.82.121.6:443
4. iptables NAT: DNAT 140.82.121.6:443 → 172.30.0.10:3128
5. Squid receives CONNECT request for api.github.com:443
6. Squid checks ACL: .github.com in allowed_domains? YES
7. Squid establishes TCP connection to 140.82.121.6:443
8. Squid logs: TCP_TUNNEL/200 GET https://api.github.com/
9. TLS handshake: curl ←(via Squid)→ GitHub (end-to-end encrypted)
10. HTTP request/response (encrypted, Squid doesn't inspect)
11. Connection closed, logged by Squid
```

#### Blocked HTTPS Request

```
1. Container process: curl https://example.com
2. DNS resolution: example.com → 93.184.216.34 (allowed via iptables)
3. TCP connect to 93.184.216.34:443
4. iptables NAT: DNAT 93.184.216.34:443 → 172.30.0.10:3128
5. Squid receives CONNECT request for example.com:443
6. Squid checks ACL: .example.com in allowed_domains? NO
7. Squid logs: TCP_DENIED/403 CONNECT example.com:443
8. Squid returns 403 Access Denied to curl
9. curl fails with connection error
```

#### Blocked Non-HTTP Protocol

```
1. Container process: ssh git@github.com
2. DNS resolution: github.com → 140.82.121.4 (allowed via iptables)
3. TCP connect to 140.82.121.4:22
4. iptables NAT: No match (only ports 80/443 redirected)
5. iptables filter (DOCKER-USER chain): Port 22 not in allow rules
6. iptables logs: [FW_BLOCKED_OTHER] SRC=172.30.0.20 DST=140.82.121.4 PROTO=TCP DPT=22
7. iptables REJECT: icmp-port-unreachable sent
8. ssh connection fails
```

## Logging and Auditability

### Squid Access Logs

**Location:** `/var/log/squid/access.log` (preserved to `/tmp/squid-logs-<timestamp>/`)

**Custom Log Format:**
```
logformat firewall_detailed %ts.%03tu %>a:%>p %{Host}>h %<a:%<p %rv %rm %>Hs %Ss:%Sh %ru "%{User-Agent}>h"
```

**Fields:**
- `%ts.%03tu`: Unix timestamp with milliseconds
- `%>a:%>p`: Client IP:port (e.g., 172.30.0.20:54321)
- `%{Host}>h`: Domain from Host header or SNI
- `%<a:%<p`: Destination IP:port
- `%rv`: HTTP protocol version
- `%rm`: HTTP method (GET, POST, CONNECT)
- `%>Hs`: HTTP status code (200=allowed, 403=denied)
- `%Ss:%Sh`: Squid decision code (TCP_TUNNEL, TCP_DENIED, etc.)
- `%ru`: Full URL
- `%{User-Agent}>h`: Client user agent

**Example Log Entries:**

Allowed request:
```
1737823845.123 172.30.0.20:54321 api.github.com 140.82.121.6:443 HTTP/1.1 CONNECT 200 TCP_TUNNEL:HIER_DIRECT https://api.github.com/ "curl/7.88.1"
```

Blocked request:
```
1737823850.456 172.30.0.20:54322 example.com 93.184.216.34:443 HTTP/1.1 CONNECT 403 TCP_DENIED:HIER_NONE https://example.com/ "curl/7.88.1"
```

**Security Value:**
- Complete audit trail of all HTTP/HTTPS traffic
- Exact timestamp for correlation with other logs
- Domain and IP address for forensic analysis
- Decision code shows why request was allowed/denied
- User-Agent helps identify source application

### iptables Kernel Logs

**Location:** Kernel ring buffer (`dmesg` or `/var/log/kern.log`)

**Log Prefixes:**
- `[FW_BLOCKED_UDP]`: Non-DNS UDP traffic blocked
- `[FW_BLOCKED_OTHER]`: TCP/other protocols blocked

**Example Log Entry:**
```
[FW_BLOCKED_OTHER] IN=fw-bridge OUT=eth0 SRC=172.30.0.20 DST=140.82.121.4 PROTO=TCP SPT=45678 DPT=22 
```

**Fields:**
- `IN`: Input interface (fw-bridge = traffic from firewall containers)
- `OUT`: Output interface (eth0 = egress to external network)
- `SRC`: Source IP (container IP on awf-net)
- `DST`: Destination IP
- `PROTO`: Protocol (TCP, UDP, ICMP)
- `SPT/DPT`: Source/destination ports

**Security Value:**
- Logs protocols that Squid doesn't handle (SSH, FTP, custom protocols)
- Detects bypass attempts (direct IP connections, non-HTTP ports)
- Kernel-level logs cannot be tampered with from containers

### Log Preservation

**Automatic Preservation:**
- Squid logs: `/tmp/squid-logs-<timestamp>/` (always preserved if created)
- Copilot logs: `/tmp/copilot-logs-<timestamp>/` (Copilot CLI's own logs)
- Logs survive cleanup unless `--keep-containers` used (then in workdir)

**Access Logs:**
```bash
# View Squid access log (requires sudo due to file ownership)
sudo cat /tmp/squid-logs-<timestamp>/access.log

# Filter for blocked traffic
sudo grep "TCP_DENIED" /tmp/squid-logs-<timestamp>/access.log

# View iptables blocked traffic (kernel logs)
sudo dmesg | grep FW_BLOCKED
```

**Log Retention Recommendations:**
- Archive logs for compliance and incident investigation
- Rotate logs in production environments (Squid + syslog for iptables)
- Consider centralized logging (ship to SIEM) for CI/CD environments

## Attack Surface Analysis

### Exposed Attack Surfaces

1. **User Command Execution**
   - **Surface:** Arbitrary commands run inside copilot container
   - **Risk:** Command could attempt privilege escalation, filesystem attacks
   - **Mitigation:** Network egress controlled; filesystem access is intentional design
   - **Residual Risk:** Local filesystem attacks (out of scope for this firewall)

2. **Docker Socket Access**
   - **Surface:** Container can spawn new containers via Docker socket
   - **Risk:** Spawned containers could try to bypass firewall
   - **Mitigation:** Docker wrapper intercepts and enforces network; DOCKER-USER chain provides fallback
   - **Residual Risk:** None (multi-layer defense)

3. **Squid Proxy Service**
   - **Surface:** Squid accepts CONNECT/GET requests from copilot container
   - **Risk:** Squid vulnerability could allow ACL bypass
   - **Mitigation:** Minimal configuration, no caching, strict ACLs; host DOCKER-USER fallback
   - **Residual Risk:** Low (mature software, defense-in-depth)

4. **Network Namespace (NET_ADMIN capability)**
   - **Surface:** Container can modify iptables rules in its namespace
   - **Risk:** Could remove NAT redirection to Squid
   - **Mitigation:** Host DOCKER-USER chain enforces filtering regardless
   - **Residual Risk:** None (host-level enforcement cannot be bypassed)

### Not Exposed

- ✓ Squid proxy not accessible from host or external network
- ✓ Container has no privileged capabilities (except NET_ADMIN)
- ✓ No host network mode (bridge isolation enforced)
- ✓ No SSH/RDP access to containers
- ✓ No persistent volumes (ephemeral state only)

### Attack Surface Reduction Techniques

1. **Minimal container images** - Only essential packages installed
2. **Ephemeral containers** - Destroyed after each run, no persistent state
3. **Principle of least privilege** - Only NET_ADMIN capability, no SYS_ADMIN
4. **Immutable configuration** - Generated at runtime, cannot be modified during execution
5. **Explicit deny default** - All traffic blocked unless explicitly allowed

## Security Validation

### Testing Firewall Effectiveness

**Test 1: Verify Domain Blocking**
```bash
# Should succeed
sudo awf --allow-domains github.com -- curl -s https://api.github.com/zen

# Should fail (timeout or 403)
sudo awf --allow-domains github.com -- curl --max-time 5 https://example.com
```

**Test 2: Verify Subdomain Matching**
```bash
# api.github.com should work (subdomain of github.com)
sudo awf --allow-domains github.com -- curl -s https://api.github.com/zen
```

**Test 3: Verify Docker-in-Docker Enforcement**
```bash
# Spawned container should be filtered
sudo awf --allow-domains github.com -- \
  docker run --rm curlimages/curl -fsS --max-time 5 https://example.com
# Should fail (example.com not whitelisted)
```

**Test 4: Verify Attack Prevention**
```bash
# DNS poisoning attack should be blocked
sudo awf --allow-domains github.com -- \
  docker run --add-host=github.com:1.2.3.4 alpine curl https://github.com
# [FIREWALL] ERROR: --add-host is not allowed (enables DNS poisoning)

# Privileged container attack should be blocked
sudo awf --allow-domains github.com -- \
  docker run --privileged alpine curl https://example.com
# [FIREWALL] ERROR: --privileged is not allowed (bypasses all security)

# Host network bypass should be blocked
sudo awf --allow-domains github.com -- \
  docker run --network host alpine curl https://example.com
# [FIREWALL] ERROR: --network host is not allowed (bypasses firewall)
```

**Test 5: Verify Non-HTTP Protocol Blocking**
```bash
# SSH should be blocked (port 22 not allowed)
sudo awf --allow-domains github.com -- ssh -T git@github.com
# Connection should timeout or be rejected

# Verify in logs
sudo dmesg | grep FW_BLOCKED_OTHER | tail -5
```

### Continuous Security Monitoring

**Squid Log Monitoring:**
```bash
# Monitor denied requests in real-time
sudo tail -f /tmp/squid-logs-*/access.log | grep TCP_DENIED

# Count blocked requests
sudo grep -c "TCP_DENIED" /tmp/squid-logs-*/access.log

# Identify blocked domains
sudo grep "TCP_DENIED" /tmp/squid-logs-*/access.log | \
  awk '{print $3}' | sort | uniq -c | sort -rn
```

**iptables Log Monitoring:**
```bash
# Monitor blocked non-HTTP traffic
sudo dmesg -w | grep "FW_BLOCKED"

# Count UDP blocks
sudo dmesg | grep -c "FW_BLOCKED_UDP"

# Identify blocked destinations
sudo dmesg | grep "FW_BLOCKED" | \
  grep -oP 'DST=[\d.]+' | sort | uniq -c
```

## Known Limitations and Residual Risks

### By Design (Not Risks)

1. **Filesystem Access**
   - Agents have read-write access to host filesystem
   - Required for agent functionality (read code, write outputs)
   - Not a vulnerability - network exfiltration is still blocked

2. **Docker Socket Access**
   - Containers can spawn new containers
   - Required for MCP servers and Docker tools
   - Mitigated by wrapper interception and host-level filtering

3. **Localhost Exemption**
   - Localhost traffic allowed (127.0.0.0/8, lo interface)
   - Required for stdio MCP servers (child processes on localhost)
   - Safe because localhost cannot route to external networks

### Technical Limitations

1. **IPv6 Not Supported**
   - Firewall only configured for IPv4
   - IPv6 traffic will fail (not bypass - just fail)
   - Mitigation: Ensure containers use IPv4 DNS resolution

2. **Non-HTTP Protocols**
   - Only HTTP/HTTPS proxied through Squid
   - Other protocols (SSH, FTP, WebSocket) blocked by iptables
   - By design: Reduces attack surface, simplifies security model

3. **HTTP/3 (QUIC)**
   - Uses UDP, blocked by iptables (except DNS port 53)
   - Agents must fall back to HTTP/1.1 or HTTP/2 over TCP
   - By design: QUIC inspection requires different proxy approach

### Potential Bypass Scenarios (with Mitigations)

#### Scenario 1: iptables Rule Manipulation

**Attack:** Agent with NET_ADMIN modifies iptables NAT rules to disable redirection.

**Example:**
```bash
# Inside copilot container
iptables -t nat -F OUTPUT  # Clear NAT rules
curl https://example.com   # Attempt direct connection
```

**Mitigation:**
- Host DOCKER-USER chain still blocks traffic (filter table)
- Container can only modify its own network namespace, not host
- Even if NAT bypassed, DOCKER-USER chain drops non-allowed egress

**Result:** Attack fails at host level.

#### Scenario 2: Time-of-Check-Time-of-Use (TOCTOU)

**Attack:** Use whitelisted domain for DNS resolution, then reuse connection for non-whitelisted domain.

**Example:**
```bash
# Establish connection to github.com
curl https://github.com
# Try to reuse connection for different domain (HTTP/1.1 pipelining)
```

**Mitigation:**
- Squid validates domain on EVERY request (not just at connection time)
- HTTPS uses SNI which must match for each TLS handshake
- HTTP/1.1 Host header checked on every request

**Result:** Attack fails. Squid rejects requests with non-whitelisted Host/SNI.

#### Scenario 3: DNS Rebinding

**Attack:** Resolve whitelisted domain to malicious IP, then use Squid to connect.

**Example:**
1. Poison DNS: `github.com` → `10.0.0.1` (attacker's server)
2. Squid connects to `10.0.0.1:443` when proxying `https://github.com`
3. Attacker's server responds, Squid passes data back

**Mitigation:**
- Squid uses its own DNS resolvers (8.8.8.8, 8.8.4.4), not container's DNS
- Container cannot modify Squid's DNS resolution
- HTTPS SNI still validated (attacker's cert won't match github.com)

**Result:** Attack fails at TLS validation (certificate mismatch).

## Security Best Practices

### For Deployment

1. **Minimize Allowed Domains**
   - Only whitelist domains absolutely required for agent's task
   - Prefer specific subdomains over top-level domains when possible
   - Review and update allowlist regularly

2. **Enable Logging**
   - Always preserve and review Squid logs after execution
   - Set up centralized logging for CI/CD environments
   - Monitor for unexpected denied requests (may indicate compromise or misconfiguration)

3. **Regular Updates**
   - Update Squid container image regularly for security patches
   - Update copilot container base image for OS patches
   - Pin specific versions for reproducibility

4. **Least Privilege**
   - Don't grant more domains than necessary
   - Use short-lived credentials for API tokens
   - Rotate tokens regularly

5. **Defense in Depth**
   - Combine with other security controls (AppArmor, SELinux for filesystem)
   - Use firewall in addition to network segmentation (not instead of)
   - Implement additional monitoring and alerting

### For CI/CD Environments

1. **Secret Management**
   - Pass secrets via environment variables (not files)
   - Use `sudo -E` to preserve environment variables
   - Don't log commands that contain secrets

2. **Network Policies**
   - Define domain allowlists per workflow/job
   - Store allowlists in version control for auditability
   - Use `--allow-domains-file` for complex lists

3. **Monitoring**
   - Archive Squid logs for every CI run
   - Alert on denied requests (may indicate workflow changes needed)
   - Track domain usage over time

4. **Resource Cleanup**
   - Ensure cleanup runs even on failure (`if: always()` in GitHub Actions)
   - Pre-test cleanup to prevent resource exhaustion
   - Monitor Docker network pool usage

### For Agent Development

1. **Test with Minimal Domains**
   - Start with empty allowlist, add domains as needed
   - Use `--log-level debug` to see denied requests
   - Document required domains in agent README

2. **Handle Errors Gracefully**
   - Expect network requests to fail (may be blocked)
   - Provide clear error messages when domains are needed
   - Don't retry indefinitely on blocked domains

3. **Avoid IP-Based Access**
   - Always use domain names, not IP addresses
   - Squid cannot validate IP-based HTTPS (no SNI)
   - Improves security and logging clarity

## Compliance and Regulatory Considerations

### Audit Logging

The firewall provides complete audit trails suitable for compliance requirements:

- **What**: All HTTP/HTTPS requests (allowed and denied)
- **When**: Millisecond-precision timestamps
- **Who**: Source container IP (correlate with command logs)
- **Where**: Destination domain and IP
- **Why**: Allow/deny decision with reason code

**Retention:** Logs are preserved but not automatically rotated. Implement log retention policy based on your compliance requirements (SOC 2, HIPAA, GDPR, etc.).

### Data Protection

**Privacy Properties:**
- No TLS interception (end-to-end encryption preserved)
- No payload inspection (Squid doesn't decrypt HTTPS)
- Domain-level visibility only (not URL paths for HTTPS)
- User-Agent logged (may contain sensitive information)

**GDPR Considerations:**
- Logs may contain personal data (IP addresses, user agents)
- Implement data retention and deletion policies
- Consider pseudonymization for long-term storage

### Security Certifications

**Suitable for:**
- SOC 2 Type II (network access controls)
- ISO 27001 (information security management)
- NIST Cybersecurity Framework (network boundary protection)

**Not Sufficient Alone For:**
- PCI DSS (needs additional host hardening)
- FedRAMP (needs FIPS-validated crypto modules)
- HIPAA (needs encryption at rest, additional access controls)

## Incident Response

### Detecting Compromise

**Indicators of Compromise:**

1. **Unusual Denied Requests**
   - High volume of `TCP_DENIED` in Squid logs
   - Attempts to access known malicious domains
   - Rapid-fire requests to many different blocked domains

2. **Bypass Attempts**
   - `[FW_BLOCKED_OTHER]` logs for ports other than 80/443
   - Blocked `--privileged`, `--add-host`, or `--network host` in Docker wrapper logs
   - Unusual protocols in iptables logs

3. **Unexpected Allowed Requests**
   - Requests to whitelisted domains but unexpected URLs
   - Unusual User-Agent strings
   - Traffic at unusual times (for CI/CD jobs)

### Investigation Workflow

1. **Collect Logs**
   ```bash
   # Gather all relevant logs
   sudo cat /tmp/squid-logs-*/access.log > incident-squid.log
   sudo dmesg | grep FW_BLOCKED > incident-iptables.log
   ```

2. **Analyze Traffic Patterns**
   ```bash
   # Identify blocked domains
   grep TCP_DENIED incident-squid.log | awk '{print $3}' | sort | uniq -c
   
   # Timeline of events
   grep TCP_DENIED incident-squid.log | awk '{print $1, $3}'
   ```

3. **Correlate with Command Logs**
   - Match timestamps with job execution times
   - Identify which command triggered suspicious traffic
   - Review code/configuration that generated requests

4. **Containment**
   - Stop allowing suspected malicious domains
   - Review and restrict agent permissions
   - Update allowlists and policies

5. **Remediation**
   - Update agent code to remove malicious behavior
   - Patch vulnerabilities that enabled compromise
   - Enhance monitoring for similar patterns

## Security Roadmap and Future Enhancements

### Under Consideration

1. **TLS Interception Mode** (Optional)
   - Deep packet inspection for HTTPS traffic
   - URL path filtering in addition to domain filtering
   - Tradeoff: Breaks end-to-end encryption, adds complexity

2. **Rate Limiting**
   - Limit requests per domain/per time window
   - Prevent denial-of-service via allowed domains
   - Squid `delay_pools` feature

3. **Content-Type Filtering**
   - Block executables, archives from downloads
   - Prevent malware downloads via whitelisted domains
   - Squid ACLs on MIME types

4. **IPv6 Support**
   - Extend iptables rules to ip6tables
   - Squid IPv6 configuration
   - Dual-stack bridge network

5. **Alternative Proxy Backends**
   - Envoy, HAProxy, or custom Go proxy
   - More granular control, better performance
   - Maintain compatibility with existing interface

### Out of Scope

**The firewall intentionally does NOT:**
- Restrict filesystem access (required for agent functionality)
- Control process execution (agents need to run arbitrary commands)
- Implement authentication/authorization (handled by upstream agents)
- Provide data loss prevention (DLP) for file writes
- Replace network segmentation or VLANs

Use complementary security controls for these requirements.

## Comparison to Alternative Approaches

### vs. Host Firewall (iptables on Host)

**Advantages of This Firewall:**
- Domain-level filtering (iptables is IP-only)
- Automatic subdomain matching
- HTTPS domain validation via SNI
- Comprehensive logging with domain names
- Portable (works on any Docker host)

**When to Use Host Firewall:**
- Need to block all containers on host (not just specific workflows)
- Require protocol-level filtering (block all HTTP, not just specific domains)
- Performance critical (avoid proxy overhead)

### vs. Kubernetes Network Policies

**Advantages of This Firewall:**
- Lightweight (no Kubernetes cluster required)
- Domain-based (K8s policies are IP/port-based)
- Works with GitHub Actions runners
- Simpler deployment model

**When to Use K8s Network Policies:**
- Already running on Kubernetes
- Need east-west traffic control (pod-to-pod)
- Require namespace isolation
- Have dedicated network policy management team

### vs. Service Mesh (Istio, Linkerd)

**Advantages of This Firewall:**
- No sidecar overhead
- Simpler architecture
- Faster startup time
- Works outside Kubernetes

**When to Use Service Mesh:**
- Need mutual TLS between services
- Require circuit breaking and retries
- Have complex microservices architecture
- Need distributed tracing integration

### vs. Cloud Provider Firewall (AWS Security Groups, GCP Firewall Rules)

**Advantages of This Firewall:**
- Domain-based (cloud firewalls are IP/CIDR-based)
- Works anywhere (cloud, on-prem, local)
- No cloud vendor lock-in
- Lower cost (no cloud egress charges for blocked traffic)

**When to Use Cloud Firewall:**
- Already using cloud infrastructure
- Need VPC-level isolation
- Require integration with cloud IAM
- Need managed service with SLA

## Security Disclosure Policy

If you discover a security vulnerability in this firewall, please report it responsibly:

**DO NOT:**
- Open a public GitHub issue
- Disclose the vulnerability publicly before it's fixed
- Attempt to exploit the vulnerability in production environments

**DO:**
- Email: `opensource-security@github.com`
- Include: Detailed description, reproduction steps, impact assessment
- Allow: Reasonable time for patch development and release

See [SECURITY.md](https://github.com/githubnext/gh-aw-firewall/blob/main/SECURITY.md) for full disclosure policy.

## Conclusion

The Agentic Workflow Firewall provides robust network egress control for AI agents using a **defense-in-depth strategy** with three independent security layers. The architecture balances security (zero-trust network access) with functionality (full filesystem and Docker access), making it suitable for production use in CI/CD environments and local development.

**Key Takeaways:**
- ✓ Multi-layer defense prevents bypass attacks
- ✓ Domain-based filtering with automatic subdomain matching
- ✓ Complete auditability with comprehensive logging
- ✓ Production-ready with minimal configuration
- ✓ Open source and extensible

For questions or discussion about the security model, please open a [GitHub Discussion](https://github.com/githubnext/gh-aw-firewall/discussions).
