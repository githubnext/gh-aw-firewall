# Firewall Wrapper for GitHub Copilot CLI

A security wrapper that provides L7 (HTTP/HTTPS) egress control for GitHub Copilot CLI using Squid proxy and Docker containers. This tool restricts network access to a whitelist of approved domains while maintaining full filesystem access for the Copilot CLI and its MCP servers.

## Features

- **L7 Domain Whitelisting**: Control HTTP/HTTPS traffic at the application layer
- **Transparent Proxy**: Uses Squid proxy with iptables redirection
- **MCP Server Support**: MCP servers (stdio, HTTP, Docker) share the same firewall restrictions
- **Full Filesystem Access**: Copilot container has complete host filesystem access
- **Clean Isolation**: Containers are automatically cleaned up after execution
- **GitHub Actions Ready**: Designed for use in GitHub Actions Ubuntu runners

## Architecture

```
┌─────────────────────────────────────────┐
│  Host (GitHub Actions Runner / Local)   │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │   Firewall Wrapper CLI             │ │
│  │   - Parse arguments                │ │
│  │   - Generate Squid config          │ │
│  │   - Start Docker Compose           │ │
│  └────────────────────────────────────┘ │
│           │                              │
│           ▼                              │
│  ┌──────────────────────────────────┐   │
│  │   Docker Compose                 │   │
│  │  ┌────────────────────────────┐  │   │
│  │  │  Squid Proxy Container     │  │   │
│  │  │  - Domain ACL filtering    │  │   │
│  │  │  - HTTP/HTTPS proxy        │  │   │
│  │  └────────────────────────────┘  │   │
│  │           ▲                       │   │
│  │  ┌────────┼───────────────────┐  │   │
│  │  │ Copilot Container          │  │   │
│  │  │ - Full filesystem access   │  │   │
│  │  │ - iptables redirect        │  │   │
│  │  │ - Spawns MCP servers       │  │   │
│  │  │ - All traffic → Squid      │  │   │
│  │  └────────────────────────────┘  │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

## Installation

```bash
npm install
npm run build
npm link  # Makes firewall-wrapper available globally
```

Or in a GitHub Actions workflow:

```yaml
- name: Checkout firewall-wrapper
  uses: actions/checkout@v4
  with:
    repository: github/firewall-wrapper
    path: firewall-wrapper

- name: Install firewall-wrapper
  run: |
    cd firewall-wrapper
    npm install
    npm run build
    npm link
```

## Usage

### Basic Example

```bash
firewall-wrapper \
  --allow-domains github.com,api.github.com \
  'curl https://api.github.com'
```

### With GitHub Copilot CLI

```bash
firewall-wrapper \
  --allow-domains github.com,api.github.com,githubusercontent.com,anthropic.com \
  'copilot --prompt "List my repositories"'
```

### With MCP Servers

```bash
firewall-wrapper \
  --allow-domains github.com,arxiv.org,mcp.tavily.com \
  --log-level debug \
  'copilot --mcp arxiv,tavily --prompt "Search arxiv for recent AI papers"'
```

### Command-Line Options

```
firewall-wrapper [options] <command>

Options:
  --allow-domains <domains>  Comma-separated list of allowed domains (required)
                             Example: github.com,api.github.com,arxiv.org
  --log-level <level>        Log level: debug, info, warn, error (default: info)
  --keep-containers          Keep containers running after command exits
  --work-dir <dir>           Working directory for temporary files
  -V, --version              Output the version number
  -h, --help                 Display help for command

Arguments:
  command                    Command to execute (wrap in quotes)
```

## Domain Whitelisting

The `--allow-domains` option accepts:

- **Exact domains**: `github.com` matches only `github.com`
- **Subdomains**: `.github.com` or `github.com` both match `api.github.com`, `raw.githubusercontent.com`, etc.
- **Multiple domains**: Comma-separated list (no spaces)

### Example Domain Lists

For GitHub Copilot with GitHub API:
```bash
--allow-domains github.com,api.github.com,githubusercontent.com,githubassets.com
```

For MCP servers:
```bash
--allow-domains \
  github.com,\
  arxiv.org,\
  mcp.context7.com,\
  mcp.tavily.com,\
  learn.microsoft.com,\
  mcp.deepwiki.com
```

## GitHub Actions Integration

### Example Workflow

```yaml
name: Test Firewall Wrapper

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Firewall Wrapper
        run: |
          npm install
          npm run build
          npm link

      - name: Install GitHub Copilot CLI
        run: npm install -g @github/copilot@latest

      - name: Test with Copilot
        env:
          GITHUB_TOKEN: ${{ secrets.COPILOT_CLI_TOKEN }}
        run: |
          firewall-wrapper \
            --allow-domains github.com,api.github.com,githubusercontent.com \
            'copilot --help'
```

### Replacing Manual Proxy Setup

If you currently have manual Squid proxy configuration like in scout.yml, you can replace it:

**Before (Manual Setup):**
```yaml
- name: Setup Proxy Configuration
  run: |
    cat > squid.conf << 'EOF'
    # ... squid config ...
    EOF

- name: Start Squid proxy
  run: |
    docker compose -f docker-compose.yml up -d
    iptables ...
```

**After (Using Wrapper):**
```yaml
- name: Execute Copilot with Firewall
  run: |
    firewall-wrapper \
      --allow-domains github.com,arxiv.org \
      'copilot --prompt "..."'
```

## How It Works

### 1. Configuration Generation
The wrapper generates:
- **Squid configuration** with domain ACLs
- **Docker Compose** configuration for both containers
- **Temporary work directory** for configs and logs

### 2. Container Startup
1. **Squid proxy starts first** with healthcheck
2. **Copilot container waits** for Squid to be healthy
3. **iptables rules applied** in copilot container to redirect all HTTP/HTTPS traffic

### 3. Traffic Routing
- All HTTP (port 80) and HTTPS (port 443) traffic → Squid proxy
- Squid filters based on domain whitelist
- Localhost traffic exempt (for stdio MCP servers)
- DNS queries allowed (for name resolution)

### 4. MCP Server Handling
- **Stdio MCP servers**: Run as child processes, no network needed
- **HTTP MCP servers**: Traffic routed through Squid proxy
- **Docker MCP servers**: Share network namespace, inherit restrictions

### 5. Cleanup
- Containers stopped and removed
- Temporary files deleted (unless `--keep-containers` specified)
- Exit code propagated from copilot command

## Testing

### Unit Tests
```bash
npm test
```

### Integration Tests
```bash
# Test domain whitelisting
firewall-wrapper --allow-domains github.com 'curl -f https://api.github.com'

# Test blocking
! firewall-wrapper --allow-domains github.com 'curl -f --max-time 5 https://evil.com'
```

### Debugging

Enable debug logging to see detailed information:

```bash
firewall-wrapper \
  --allow-domains github.com \
  --log-level debug \
  'your-command'
```

This will show:
- Squid configuration generation
- Docker container startup logs
- iptables rules applied
- Network connectivity tests
- Proxy traffic logs

To inspect Squid logs after execution:

```bash
firewall-wrapper \
  --allow-domains github.com \
  --keep-containers \
  'your-command'

# Then view logs:
docker logs firewall-wrapper-squid
```

## Troubleshooting

### Domain is Blocked
**Problem**: Request to allowed domain is being blocked

**Solution**:
1. Check domain spelling in `--allow-domains`
2. Add subdomains if needed (e.g., `api.github.com` in addition to `github.com`)
3. Enable debug logging to see Squid access logs

### Container Won't Start
**Problem**: Docker Compose fails to start containers

**Solution**:
1. Ensure Docker is running
2. Check for port conflicts (port 3128 must be available)
3. Verify Docker Compose is installed

### iptables Permission Denied
**Problem**: Cannot apply iptables rules

**Solution**:
- The copilot container needs `NET_ADMIN` capability
- This is automatically added by Docker Compose config
- Verify you're not running in a restricted environment

### MCP Server Can't Connect
**Problem**: MCP server cannot reach external API

**Solution**:
1. Add MCP server's domain to `--allow-domains`
2. Check if MCP server uses subdomain (e.g., `api.example.com`)
3. Verify DNS resolution is working

## Security Considerations

### What This Protects Against
- Unauthorized egress to non-whitelisted domains
- Data exfiltration via HTTP/HTTPS
- MCP servers accessing unexpected endpoints

### What This Does NOT Protect Against
- Non-HTTP/HTTPS protocols (raw TCP, UDP, etc.)
- IP-based connections (bypassing DNS)
- Localhost services
- Docker socket access (if mounted)

### Recommendations
- Use minimal domain whitelist
- Regularly audit allowed domains
- Monitor Squid logs for blocked requests
- Combine with network policies for additional security

## Contributing

Contributions welcome! Please ensure:
- TypeScript code follows existing style
- Tests pass: `npm test`
- Documentation is updated

## License

MIT

## Related Projects

- [Squid Proxy](http://www.squid-cache.org/)
- [GitHub Copilot CLI](https://github.com/github/copilot-cli)
- [Model Context Protocol](https://github.com/anthropics/mcp)
