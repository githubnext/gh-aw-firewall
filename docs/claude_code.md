# Claude Code Integration

This guide explains how to use the Agentic Workflow Firewall with Anthropic's Claude API for code generation and other AI coding tasks.

## Overview

Claude Code refers to using Anthropic's Claude API for code-related tasks such as:
- Code generation and completion
- Code review and analysis
- Documentation generation
- Debugging assistance
- Code refactoring suggestions

The firewall provides L7 domain whitelisting to control Claude API access while maintaining security.

## Required Domains

To use Claude Code through the firewall, you need to whitelist:

- `anthropic.com` - Main Anthropic domain (includes api.anthropic.com automatically)
- `api.anthropic.com` - Claude API endpoint (automatically included when anthropic.com is whitelisted)

### Common Domain Combinations

**Claude API only:**
```bash
--allow-domains anthropic.com
```

**Claude API + GitHub (for repository access):**
```bash
--allow-domains anthropic.com,github.com,githubusercontent.com
```

**Claude API + npm (for package management):**
```bash
--allow-domains anthropic.com,registry.npmjs.org
```

## Installation

### Using the Anthropic SDK

Install the official Anthropic SDK through the firewall:

```bash
sudo awf \
  --allow-domains registry.npmjs.org,anthropic.com \
  'npm install @anthropic-ai/sdk'
```

### Global Installation

```bash
sudo awf \
  --allow-domains registry.npmjs.org,anthropic.com \
  'npm install -g @anthropic-ai/sdk'
```

## Usage Examples

### Basic API Request

```bash
# Simple curl request to Claude API
sudo awf \
  --allow-domains anthropic.com \
  'curl -f https://api.anthropic.com'
```

### Using the SDK

Create a simple script to test Claude API:

```javascript
// test-claude.js
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function testClaude() {
  const message = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    messages: [
      { role: 'user', content: 'Write a Hello World function in JavaScript' }
    ],
  });
  
  console.log(message.content);
}

testClaude();
```

Run it through the firewall:

```bash
export ANTHROPIC_API_KEY="your-api-key-here"

sudo -E awf \
  --allow-domains anthropic.com \
  'node test-claude.js'
```

**Note:** Use `sudo -E` to preserve environment variables through sudo.

### Code Generation Workflow

```bash
export ANTHROPIC_API_KEY="your-api-key-here"

sudo -E awf \
  --allow-domains anthropic.com,github.com,registry.npmjs.org \
  'bash -c "npm install @anthropic-ai/sdk && node generate-code.js"'
```

### With GitHub Integration

```bash
export ANTHROPIC_API_KEY="your-api-key-here"
export GITHUB_TOKEN="your-github-token"

sudo -E awf \
  --allow-domains anthropic.com,github.com,api.github.com,githubusercontent.com \
  'node claude-github-bot.js'
```

## Environment Variables

### Required

- `ANTHROPIC_API_KEY` - Your Anthropic API key (required for SDK authentication)

### Optional

- `ANTHROPIC_BASE_URL` - Custom API endpoint (default: https://api.anthropic.com)
- `ANTHROPIC_TIMEOUT_MS` - Request timeout in milliseconds

### Passing Environment Variables

Always use `sudo -E` to preserve environment variables:

```bash
export ANTHROPIC_API_KEY="your-key"
export GITHUB_TOKEN="your-token"

sudo -E awf \
  --allow-domains anthropic.com,github.com \
  'your-command'
```

## GitHub Actions Integration

Example workflow for using Claude Code in CI/CD:

```yaml
name: Claude Code Analysis

on: [push, pull_request]

jobs:
  analyze-code:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Firewall
        run: |
          npm install
          npm run build
          npm link

      - name: Install Anthropic SDK
        run: npm install @anthropic-ai/sdk

      - name: Run Claude Code Analysis
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          sudo -E awf \
            --allow-domains anthropic.com,github.com \
            'node analyze-code.js'
```

## Security Best Practices

### API Key Management

1. **Never hardcode API keys** in scripts or configuration files
2. **Use environment variables** for API keys
3. **Store keys in GitHub Secrets** for CI/CD workflows
4. **Rotate keys regularly** and use separate keys for development/production

### Domain Whitelisting

Only whitelist domains you actually need:

```bash
# ✓ Good - minimal domains
sudo -E awf \
  --allow-domains anthropic.com \
  'node claude-script.js'

# ✗ Avoid - unnecessary domains
sudo -E awf \
  --allow-domains anthropic.com,example.com,unnecessary.com \
  'node claude-script.js'
```

### Rate Limiting

Claude API has rate limits. Be mindful of:
- Request frequency
- Token usage
- Concurrent requests

The firewall doesn't enforce rate limits - these are handled by the Claude API itself.

## Troubleshooting

### Connection Issues

**Problem:** Cannot connect to Claude API

```
Error: connect ETIMEDOUT
```

**Solution:** Ensure `anthropic.com` is in the allowlist:

```bash
sudo -E awf --allow-domains anthropic.com 'your-command'
```

### Authentication Errors

**Problem:** API authentication fails

```
Error: 401 Unauthorized
```

**Solutions:**
1. Check that `ANTHROPIC_API_KEY` is set correctly
2. Use `sudo -E` to preserve environment variables
3. Verify your API key is valid and not expired

```bash
# Correct usage
export ANTHROPIC_API_KEY="sk-ant-..."
sudo -E awf --allow-domains anthropic.com 'node script.js'
```

### Domain Blocking

**Problem:** Requests being blocked even with anthropic.com whitelisted

Check the Squid logs to see what's being blocked:

```bash
# After running your command, check logs
sudo cat /tmp/squid-logs-*/access.log | grep DENIED
```

### Subdomain Issues

**Problem:** Subdomains like `api.anthropic.com` are blocked

**Solution:** The main domain `anthropic.com` should automatically include all subdomains. If issues persist, explicitly add the subdomain:

```bash
sudo -E awf \
  --allow-domains anthropic.com,api.anthropic.com \
  'your-command'
```

## Testing

### Manual Testing

Test Claude API connectivity:

```bash
# Test 1: Basic connectivity
sudo awf \
  --allow-domains anthropic.com \
  'curl -v -f https://api.anthropic.com'

# Test 2: DNS resolution
sudo awf \
  --allow-domains anthropic.com \
  'nslookup api.anthropic.com'

# Test 3: SDK installation
sudo awf \
  --allow-domains registry.npmjs.org,anthropic.com \
  'npm install --no-save @anthropic-ai/sdk'
```

### Automated Testing

Run the Claude Code integration tests:

```bash
# Run Claude Code tests
npm run test:integration -- claude-code.test.ts

# Run all integration tests
npm run test:integration
```

## Performance Considerations

### Caching

The firewall uses Squid proxy which provides HTTP caching. However, Claude API responses are typically unique and won't benefit from caching.

### Connection Reuse

The firewall supports connection reuse through Squid's connection pooling, which can improve performance for multiple API requests.

### Timeouts

Adjust timeouts for long-running Claude API requests:

```javascript
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 60000, // 60 seconds
});
```

## Examples

### Code Review Bot

```javascript
// claude-review.js
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function reviewCode(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  
  const message = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `Review this code for bugs and improvements:\n\n${code}`
      }
    ],
  });
  
  return message.content;
}

// Usage through firewall
// sudo -E awf --allow-domains anthropic.com 'node claude-review.js src/myfile.js'
```

### Documentation Generator

```javascript
// generate-docs.js
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');

async function generateDocs(codeFile, outputFile) {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
  
  const code = fs.readFileSync(codeFile, 'utf8');
  
  const message = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `Generate comprehensive documentation for this code:\n\n${code}`
      }
    ],
  });
  
  fs.writeFileSync(outputFile, message.content[0].text);
  console.log(`Documentation written to ${outputFile}`);
}

// Usage through firewall
// sudo -E awf --allow-domains anthropic.com 'node generate-docs.js src/app.js docs/app.md'
```

## Additional Resources

- [Anthropic API Documentation](https://docs.anthropic.com/)
- [Claude API Quickstart](https://docs.anthropic.com/claude/docs/quickstart)
- [Anthropic SDK on npm](https://www.npmjs.com/package/@anthropic-ai/sdk)
- [Firewall Usage Guide](usage.md)
- [GitHub Actions Integration](github_actions.md)

## Related Documentation

- [Usage Guide](usage.md) - General firewall usage
- [GitHub Actions Integration](github_actions.md) - CI/CD integration
- [Troubleshooting](troubleshooting.md) - Common issues and solutions
- [Security Best Practices](security.md) - Security guidelines
