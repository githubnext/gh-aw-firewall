# API Proxy Sidecar for Credential Management

The AWF firewall supports an optional Envoy-based API proxy sidecar that securely holds LLM API credentials and automatically injects authentication headers.

## Overview

When enabled, the API proxy sidecar:
- **Isolates credentials**: API keys never exposed to agent container
- **Auto-authentication**: Automatically injects Bearer tokens and API keys
- **Dual provider support**: Supports both OpenAI (Codex) and Anthropic (Claude) APIs
- **Transparent proxying**: Agent code uses standard environment variables

## Architecture

```
┌─────────────────────────────────────────────────┐
│ AWF Network (172.30.0.0/24)                     │
│                                                  │
│  ┌──────────────┐       ┌─────────────────┐   │
│  │   Squid      │       │  Envoy Sidecar  │   │
│  │ 172.30.0.10  │       │  172.30.0.30    │   │
│  └──────────────┘       └─────────────────┘   │
│                                  │              │
│  ┌──────────────────────────────┴──────────┐  │
│  │      Agent Container                     │  │
│  │      172.30.0.20                         │  │
│  │  OPENAI_BASE_URL=http://api-proxy:10000 │  │
│  │  ANTHROPIC_BASE_URL=http://api-proxy:10001│ │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
         │                          │
         ↓                          ↓
  api.openai.com          api.anthropic.com
```

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

The sidecar sets these environment variables in the agent container:

| Variable | Value | Description |
|----------|-------|-------------|
| `OPENAI_BASE_URL` | `http://api-proxy:10000` | OpenAI API proxy endpoint |
| `ANTHROPIC_BASE_URL` | `http://api-proxy:10001` | Anthropic API proxy endpoint |

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
- Sidecar proxies to whitelisted domains only
- Squid proxy still enforces L7 filtering

### Resource Limits

The sidecar has strict resource constraints:
- 512MB memory limit
- 100 process limit
- All unnecessary capabilities dropped
- `no-new-privileges` security option

## How It Works

### 1. Container Startup

When `--enable-api-proxy` is set:
1. Envoy sidecar starts at 172.30.0.30
2. API keys passed via environment variables
3. Entrypoint generates `envoy.yaml` dynamically
4. Agent container waits for sidecar health check

### 2. Request Flow

```
Agent Code
  ↓ (makes HTTP request to api-proxy:10000)
Envoy Sidecar
  ↓ (injects Authorization: Bearer $OPENAI_API_KEY)
  ↓ (TLS connection to api.openai.com)
OpenAI API
```

### 3. Header Injection

Envoy automatically adds:
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
- **Image**: `ghcr.io/github/gh-aw-firewall/envoy:latest`
- **Base**: `envoyproxy/envoy:v1.31-latest`
- **Network**: `awf-net` at `172.30.0.30`
- **Ports**: 10000 (OpenAI), 10001 (Anthropic)

### Health Check

Envoy healthcheck on port 10000:
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

Check if Envoy container started:
```bash
docker ps | grep awf-api-proxy
```

View Envoy logs:
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
