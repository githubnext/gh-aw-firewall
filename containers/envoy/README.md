# Envoy API Proxy Sidecar

This container provides secure API key management for LLM providers (OpenAI Codex and Anthropic Claude).

## Purpose

The Envoy proxy acts as a sidecar that:
- Holds API keys securely (isolated from agent container)
- Automatically injects authentication headers
- Proxies requests to LLM API endpoints

## Architecture

- **IP Address**: 172.30.0.30 on awf-net
- **Ports**:
  - 10000: OpenAI API proxy (Codex)
  - 10001: Anthropic API proxy (Claude)

## Configuration

API keys are passed via environment variables:
- `OPENAI_API_KEY` - Optional OpenAI API key
- `ANTHROPIC_API_KEY` - Optional Anthropic API key

The entrypoint script dynamically generates `envoy.yaml` with:
- Request header injection for authentication
- TLS termination for upstream connections
- HTTP/2 support for API endpoints

## Security

- No API keys exposed to agent container
- Agent only receives proxy URLs (OPENAI_BASE_URL, ANTHROPIC_BASE_URL)
- All unnecessary Linux capabilities dropped
- Resource limits: 512MB memory, 100 PIDs

## Usage

Enable via CLI flag:
```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
awf --enable-api-proxy --allow-domains api.openai.com,api.anthropic.com -- command
```

## Example Workflows

### Codex Usage
```bash
export OPENAI_API_KEY="sk-..."
awf --enable-api-proxy \
  --allow-domains api.openai.com \
  -- curl http://api-proxy:10000/v1/completions -H "Content-Type: application/json"
```

### Claude Code Usage
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
awf --enable-api-proxy \
  --allow-domains api.anthropic.com \
  -- curl http://api-proxy:10001/v1/messages -H "Content-Type: application/json"
```
