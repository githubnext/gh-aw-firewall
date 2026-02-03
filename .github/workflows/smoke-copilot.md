---
description: Smoke Copilot
on:
  schedule: every 12h
  workflow_dispatch:
  pull_request:
    types: [opened, synchronize, reopened]
  reaction: "eyes"
roles: all
permissions:
  contents: read
  pull-requests: read
  issues: read
  actions: read
name: Smoke Copilot
engine: copilot
network:
  allowed:
    - defaults
    - node
    - github
    - playwright
tools:
  agentic-workflows:
  cache-memory: true
  edit:
  bash:
    - "*"
  github:
  playwright:
    allowed_domains:
      - github.com
  web-fetch:
sandbox:
  mcp:
    container: "ghcr.io/github/gh-aw-mcpg"
safe-outputs:
    add-comment:
      hide-older-comments: true
    add-labels:
      allowed: [smoke-copilot]
    messages:
      footer: "> 📰 *BREAKING: Report filed by [{workflow_name}]({run_url})*"
      run-started: "📰 BREAKING: [{workflow_name}]({run_url}) is now investigating this {event_type}. Sources say the story is developing..."
      run-success: "📰 VERDICT: [{workflow_name}]({run_url}) has concluded. All systems operational. This is a developing story. 🎤"
      run-failure: "📰 DEVELOPING STORY: [{workflow_name}]({run_url}) reports {status}. Our correspondents are investigating the incident..."
timeout-minutes: 5
strict: true
post-steps:
  - name: Install awf from source
    run: |
      echo "=== Installing awf from source code ==="
      cd ${{ github.workspace }}
      npm ci
      npm run build
      
      # Create symlink to override installed binary
      sudo ln -sf ${{ github.workspace }}/dist/cli.js /usr/local/bin/awf
      sudo chmod +x ${{ github.workspace }}/dist/cli.js
      
      # Verify installation
      echo "awf version after source install:"
      awf --version || node ${{ github.workspace }}/dist/cli.js --version
---

# Smoke Test: Copilot Engine Validation

**IMPORTANT: Keep all outputs extremely short and concise. Use single-line responses where possible. No verbose explanations.**

## Test Requirements

1. **GitHub MCP Testing**: Review the last 2 merged pull requests in ${{ github.repository }}
2. **Playwright Testing**: Use playwright to navigate to https://github.com and verify the page title contains "GitHub"
3. **File Writing Testing**: Create a test file `/tmp/gh-aw/agent/smoke-test-copilot-${{ github.run_id }}.txt` with content "Smoke test passed for Copilot at $(date)" (create the directory if it doesn't exist)
4. **Bash Tool Testing**: Execute bash commands to verify file creation was successful (use `cat` to read the file back)

## Output

Add a **very brief** comment (max 5-10 lines) to the current pull request with:
- PR titles only (no descriptions)
- ✅ or ❌ for each test result
- Overall status: PASS or FAIL
- Mention the pull request author and any assignees

If all tests pass, add the label `smoke-copilot` to the pull request.
