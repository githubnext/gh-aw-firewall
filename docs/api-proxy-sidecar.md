# API Proxy Sidecar for Credential Management

The AWF firewall supports an optional Node.js-based API proxy sidecar that securely holds LLM API credentials and automatically injects authentication headers while routing all traffic through Squid to respect domain whitelisting.

> [!NOTE]
> For a comprehensive deep dive into how AWF handles authentication tokens and credential isolation, see the [Authentication Architecture](authentication-architecture.md) guide.

## Overview

When enabled, the API proxy sidecar:
- **Isolates credentials**: API keys never exposed to agent container
- **Auto-authentication**: Automatically injects Bearer tokens and API keys
- **Dual provider support**: Supports both OpenAI (Codex) and Anthropic (Claude) APIs
- **Transparent proxying**: Agent code uses standard environment variables
- **Squid routing**: All traffic routes through Squid to respect domain whitelisting

## Architecture

```
┌─────────────────────────────────────────────────┐
│ AWF Network (172.30.0.0/24)                     │
│                                                  │
│  ┌──────────────┐       ┌─────────────────┐   │
│  │   Squid      │◄──────│  Node.js Proxy  │   │
│  │ 172.30.0.10  │       │  172.30.0.30    │   │
│  └──────┬───────┘       └─────────────────┘   │
│         │                        ▲              │
│         │  ┌──────────────────────────────┐    │
│         │  │      Agent Container         │    │
│         │  │      172.30.0.20             │    │
│         │  │  OPENAI_BASE_URL=            │    │
│         │  │    http://api-proxy:10000    │────┘
│         │  │  ANTHROPIC_BASE_URL=         │
│         │  │    http://api-proxy:10001    │
│         │  └──────────────────────────────┘
│         │
└─────────┼─────────────────────────────────────┘
          │ (Domain whitelist enforced)
          ↓
  api.openai.com or api.anthropic.com
```

**Traffic Flow:**
1. Agent makes request to `api-proxy:10000` or `api-proxy:10001`
2. API proxy injects authentication headers
3. API proxy routes through Squid via HTTP_PROXY/HTTPS_PROXY
4. Squid enforces domain whitelist (only allowed domains pass)
5. Request reaches api.openai.com or api.anthropic.com

## Usage

### Basic Usage

```bash
# Set API keys in environment
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."

# Enable API proxy sidecar
awf --enable-api-proxy \
  --allow-domains api.openai.com,api.anthropic.com \
  -- your-command
```

### Codex (OpenAI) Example

```bash
export OPENAI_API_KEY="sk-..."

awf --enable-api-proxy \
  --allow-domains api.openai.com \
  -- npx @openai/codex -p "write a hello world function"
```

The agent container will automatically use `http://api-proxy:10000` as the base URL.

### Claude Code Example

```bash
export ANTHROPIC_API_KEY="sk-ant-..."

awf --enable-api-proxy \
  --allow-domains api.anthropic.com \
  -- claude-code "write a hello world function"
```

The agent container will automatically use `http://api-proxy:10001` as the base URL.

### Both Providers

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."

awf --enable-api-proxy \
  --allow-domains api.openai.com,api.anthropic.com \
  -- your-multi-llm-tool
```

## Environment Variables

When API keys are provided, the sidecar sets these environment variables in the agent container:

| Variable | Value | When Set | Description |
|----------|-------|----------|-------------|
| `OPENAI_BASE_URL` | `http://api-proxy:10000` | When `OPENAI_API_KEY` is provided | OpenAI API proxy endpoint |
| `ANTHROPIC_BASE_URL` | `http://api-proxy:10001` | When `ANTHROPIC_API_KEY` is provided | Anthropic API proxy endpoint |

These are standard environment variables recognized by:
- OpenAI Python SDK
- OpenAI Node.js SDK
- Anthropic Python SDK
- Anthropic TypeScript SDK
- Codex CLI tools
- Claude Code CLI

## Security Benefits

### Credential Isolation

API keys are held in the sidecar container, not the agent:
- Agent code cannot read API keys from environment
- Compromised agent cannot exfiltrate credentials
- Keys are not exposed to the agent container’s stdout/stderr logs
- Keys are stored in sidecar and deployment configuration on disk; protect host filesystem and config accordingly (only non-sensitive key prefixes may be logged for debugging)

### Network Isolation

The proxy enforces domain-level egress control:
- Agent can only reach `api-proxy` hostname
- Sidecar routes ALL traffic through Squid proxy
- Squid enforces domain whitelist (L7 filtering)
- No firewall exemption needed for sidecar

### Resource Limits

The sidecar has strict resource constraints:
- 512MB memory limit
- 100 process limit
- All unnecessary capabilities dropped
- `no-new-privileges` security option

## How It Works

### 1. Container Startup

When `--enable-api-proxy` is set:
1. Node.js API proxy starts at 172.30.0.30
2. API keys passed via environment variables
3. HTTP_PROXY/HTTPS_PROXY configured to route through Squid
4. Agent container waits for sidecar health check

### 2. Request Flow

```
Agent Code
  ↓ (makes HTTP request to api-proxy:10000)
Node.js API Proxy
  ↓ (injects Authorization: Bearer $OPENAI_API_KEY)
  ↓ (routes via HTTP_PROXY to Squid)
Squid Proxy
  ↓ (enforces domain whitelist)
  ↓ (TLS connection to api.openai.com)
OpenAI API
```

### 3. Header Injection

The Node.js proxy automatically adds:
- **OpenAI**: `Authorization: Bearer $OPENAI_API_KEY`
- **Anthropic**: `x-api-key: $ANTHROPIC_API_KEY` and `anthropic-version: 2023-06-01`

## Configuration Reference

### CLI Options

```bash
awf --enable-api-proxy [OPTIONS] -- COMMAND
```

**Required environment variables** (at least one):
- `OPENAI_API_KEY` - OpenAI API key
- `ANTHROPIC_API_KEY` - Anthropic API key

**Recommended domain whitelist**:
- `api.openai.com` - For OpenAI/Codex
- `api.anthropic.com` - For Anthropic/Claude

### Container Configuration

The sidecar container:
- **Image**: `ghcr.io/github/gh-aw-firewall/api-proxy:latest`
- **Base**: `node:22-alpine`
- **Network**: `awf-net` at `172.30.0.30`
- **Ports**: 10000 (OpenAI), 10001 (Anthropic)
- **Proxy**: Routes via Squid at `http://172.30.0.10:3128`

### Health Check

API proxy healthcheck on `/health` endpoint:
- **Interval**: 5s
- **Timeout**: 3s
- **Retries**: 5
- **Start period**: 5s

## Troubleshooting

### API keys not detected

```
⚠️  API proxy enabled but no API keys found in environment
   Set OPENAI_API_KEY or ANTHROPIC_API_KEY to use the proxy
```

**Solution**: Export API keys before running awf:
```bash
export OPENAI_API_KEY="sk-..."
# or
export ANTHROPIC_API_KEY="sk-ant-..."
```

### Sidecar health check failing

Check if API proxy container started:
```bash
docker ps | grep awf-api-proxy
```

View API proxy logs:
```bash
docker logs awf-api-proxy
```

### API requests timing out

Ensure domains are whitelisted:
```bash
--allow-domains api.openai.com,api.anthropic.com
```

Check Squid logs for denials:
```bash
docker exec awf-squid cat /var/log/squid/access.log | grep DENIED
```

## Limitations

- Only supports OpenAI and Anthropic APIs
- Keys must be in environment (not file-based)
- No support for Azure OpenAI endpoints
- No request/response logging (by design for security)

## Future Enhancements

Potential improvements:
- Support for additional LLM providers
- Request rate limiting
- Token usage tracking
- Key rotation support
- Vault integration for key storage
