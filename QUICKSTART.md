# Quick Start Guide

Get started with the firewall wrapper in 5 minutes!

## Prerequisites

- Docker installed and running
- Node.js 18+ and npm
- GitHub Copilot CLI (if testing with copilot)

## Installation

```bash
# Clone the repository
git clone <your-repo-url> firewall-wrapper
cd firewall-wrapper

# Install dependencies
npm install

# Build the project
npm run build

# Make it available globally
npm link
```

## Verify Installation

```bash
firewall-wrapper --version
```

You should see: `0.1.0`

## Your First Command

Test that everything works:

```bash
firewall-wrapper \
  --allow-domains github.com \
  'curl -f https://api.github.com'
```

Expected output:
- `[INFO] Allowed domains: github.com`
- `[INFO] Starting containers...`
- `[SUCCESS] Containers started successfully`
- GitHub API JSON response
- `[SUCCESS] Command completed with exit code: 0`

## Test Domain Blocking

Verify that non-whitelisted domains are blocked:

```bash
firewall-wrapper \
  --allow-domains github.com \
  'curl -f --max-time 10 https://example.com'
```

This should **fail** with a connection error - that's correct behavior!

## Enable Debug Logging

See what's happening under the hood:

```bash
firewall-wrapper \
  --allow-domains github.com \
  --log-level debug \
  'curl https://api.github.com'
```

You'll see:
- Configuration details
- Squid config generation
- Docker container logs
- iptables rules being applied
- Network diagnostics

## Use with GitHub Copilot CLI

```bash
# Install GitHub Copilot CLI
npm install -g @github/copilot@latest

# Set your token
export GITHUB_TOKEN="your_copilot_token"

# Run copilot through the firewall
firewall-wrapper \
  --allow-domains github.com,api.github.com,githubusercontent.com \
  'copilot --prompt "What is GitHub Actions?"'
```

## Common Workflows

### Test MCP Server Access

```bash
# Allow arxiv domain
firewall-wrapper \
  --allow-domains arxiv.org \
  'curl -f https://arxiv.org'

# This should fail (domain not whitelisted)
firewall-wrapper \
  --allow-domains github.com \
  'curl -f https://arxiv.org'
```

### Debugging Failed Requests

When a command fails, keep containers running to inspect logs:

```bash
firewall-wrapper \
  --allow-domains github.com \
  --keep-containers \
  'your-failing-command'

# Then inspect logs
docker logs firewall-wrapper-squid
docker logs firewall-wrapper-copilot

# Clean up manually when done
docker stop firewall-wrapper-squid firewall-wrapper-copilot
docker rm firewall-wrapper-squid firewall-wrapper-copilot
```

### Multiple Domains

```bash
firewall-wrapper \
  --allow-domains github.com,api.github.com,githubusercontent.com,arxiv.org \
  'bash -c "curl https://api.github.com && curl https://arxiv.org"'
```

## Understanding the Output

### Normal Run
```
[INFO] Allowed domains: github.com, api.github.com
[INFO] Generating configuration files...
[INFO] Starting containers...
[SUCCESS] Containers started successfully
[INFO] Executing copilot command...
[your command output here]
[SUCCESS] Command completed with exit code: 0
```

### With Debug Logging
```
[DEBUG] Configuration: {...}
[DEBUG] Squid config written to: /tmp/firewall-wrapper-xxx/squid.conf
[DEBUG] Docker Compose config written to: /tmp/firewall-wrapper-xxx/docker-compose.yml
[INFO] Starting containers...
[entrypoint] Setting up iptables rules...
[iptables] Redirect HTTP (port 80) to Squid...
[SUCCESS] Containers started successfully
```

### When Domain is Blocked
```
[ERROR] curl: (28) Connection timed out
[INFO] Stopping containers...
[SUCCESS] Command completed with exit code: 28
```

## Troubleshooting

### "Command not found: firewall-wrapper"

**Solution**: Run `npm link` again or use the full path:
```bash
./dist/cli.js --allow-domains github.com 'curl https://api.github.com'
```

### "Cannot connect to Docker daemon"

**Solution**: Start Docker Desktop or the Docker service:
```bash
# macOS/Windows
# Start Docker Desktop

# Linux
sudo systemctl start docker
```

### "Port 3128 already in use"

**Solution**: Stop any existing Squid proxies or change the port in `src/docker-manager.ts`:
```bash
# Find what's using port 3128
lsof -i :3128

# Or kill existing containers
docker stop $(docker ps -q --filter "expose=3128")
```

### "iptables: Permission denied"

**Solution**: This shouldn't happen as we use `NET_ADMIN` capability. If it does:
```bash
# Verify Docker can use iptables
docker run --rm --cap-add NET_ADMIN ubuntu iptables -L
```

## Next Steps

1. **Read the full documentation**: [README.md](README.md)
2. **Explore integration with scout.yml**: [INTEGRATION.md](INTEGRATION.md)
3. **Review the implementation**: [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)
4. **Run the test suite**: `npm test` (once tests are added)
5. **Check GitHub Actions tests**: `.github/workflows/test-firewall-wrapper.yml`

## Getting Help

- Check [README.md](README.md) for detailed documentation
- Review [INTEGRATION.md](INTEGRATION.md) for scout.yml integration
- Look at test examples in `.github/workflows/test-firewall-wrapper.yml`
- Enable `--log-level debug` for detailed diagnostics
- Use `--keep-containers` to inspect container state

## Tips & Tricks

### Shell Alias
Add to your `.bashrc` or `.zshrc`:
```bash
alias fw='firewall-wrapper'
```

Then use:
```bash
fw --allow-domains github.com 'curl https://api.github.com'
```

### Environment Variable for Domains
```bash
export ALLOWED_DOMAINS="github.com,api.github.com,githubusercontent.com"
fw --allow-domains "$ALLOWED_DOMAINS" 'copilot ...'
```

### Quick Domain Testing
```bash
# Function to test if a domain is reachable through the firewall
test-domain() {
  firewall-wrapper --allow-domains "$1" "curl -f -s -o /dev/null https://$1 && echo '✓ $1 reachable' || echo '✗ $1 blocked'"
}

test-domain github.com
test-domain example.com
```

## Success!

You're now ready to use the firewall wrapper. Try integrating it into your GitHub Actions workflow or use it locally for testing restricted network environments.

Happy firewalling! 🔥🧱
