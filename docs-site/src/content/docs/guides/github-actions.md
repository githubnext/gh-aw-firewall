---
title: GitHub Actions Integration
description: Using the firewall in GitHub Actions workflows
---

## Installation in GitHub Actions

In GitHub Actions workflows, the runner already has root access:

```yaml
- name: Checkout awf
  uses: actions/checkout@v4
  with:
    repository: githubnext/gh-aw-firewall
    path: awf

- name: Install awf
  run: |
    cd awf
    npm install
    npm run build
    # Create sudo wrapper for runner
    sudo tee /usr/local/bin/awf > /dev/null <<'EOF'
    #!/bin/bash
    exec $(which node) $(pwd)/dist/cli.js "$@"
    EOF
    sudo chmod +x /usr/local/bin/awf
```

## Example Workflow

```yaml
name: Test Firewall

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

      - name: Install Firewall
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
          awf \
            --allow-domains github.com,api.github.com,googleapis.com \
            -- copilot --help
```

## Using Pre-built Binary

```yaml
- name: Download awf binary
  run: |
    curl -L https://github.com/githubnext/gh-aw-firewall/releases/latest/download/awf-linux-x64 -o awf
    chmod +x awf
    sudo mv awf /usr/local/bin/

- name: Test firewall
  run: |
    sudo awf --allow-domains github.com -- curl https://api.github.com
```

## With MCP Servers

```yaml
- name: Run Copilot with MCP
  env:
    GITHUB_TOKEN: ${{ secrets.COPILOT_CLI_TOKEN }}
    GITHUB_PERSONAL_ACCESS_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    sudo -E awf \
      --allow-domains github.com,api.github.com,googleapis.com \
      -- copilot --allow-tool github --prompt "Create an issue"
```

## Best Practices

1. **Cache Dependencies**: Cache npm modules to speed up workflow runs
2. **Use Secrets**: Store tokens securely in GitHub Secrets
3. **Debug Output**: Use `--log-level debug` for troubleshooting
4. **Preserve Logs**: Upload Squid/Copilot logs as artifacts for debugging

```yaml
- name: Upload logs
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: firewall-logs
    path: /tmp/*-logs-*/
```

## Troubleshooting in CI

See logs in real-time during workflow execution:

```yaml
- name: Run with debug logging
  run: |
    sudo awf \
      --allow-domains github.com \
      --log-level debug \
      -- your-command
```
