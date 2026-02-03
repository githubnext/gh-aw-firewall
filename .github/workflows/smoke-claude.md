---
description: Smoke test workflow that validates Claude engine functionality by reviewing recent PRs twice daily
on:
  schedule: every 12h
  workflow_dispatch:
  pull_request:
    types: [opened, synchronize, reopened]
  reaction: "heart"
roles: all
permissions:
  contents: read
  issues: read
  pull-requests: read
  
name: Smoke Claude
engine:
  id: claude
  max-turns: 15
strict: true
imports:
  - shared/mcp-pagination.md
network:
  allowed:
    - defaults
    - github
    - playwright
sandbox:
  mcp:
    container: "ghcr.io/github/gh-aw-mcpg"
tools:
  cache-memory: true
  github:
    toolsets: [repos, pull_requests]
  playwright:
    allowed_domains:
      - github.com
  edit:
  bash:
    - "*"
safe-outputs:
    add-comment:
      hide-older-comments: true
    add-labels:
      allowed: [smoke-claude]
    messages:
      footer: "> 💥 *[THE END] — Illustrated by [{workflow_name}]({run_url})*"
      run-started: "💥 **WHOOSH!** [{workflow_name}]({run_url}) springs into action on this {event_type}! *[Panel 1 begins...]*"
      run-success: "🎬 **THE END** — [{workflow_name}]({run_url}) **MISSION: ACCOMPLISHED!** The hero saves the day! ✨"
      run-failure: "💫 **TO BE CONTINUED...** [{workflow_name}]({run_url}) {status}! Our hero faces unexpected challenges..."
timeout-minutes: 10
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

# Smoke Test: Claude Engine Validation

**IMPORTANT: Keep all outputs extremely short and concise. Use single-line responses where possible. No verbose explanations.**

## Test Requirements

1. **GitHub MCP Testing**: Review the last 2 merged pull requests in ${{ github.repository }}
2. **Playwright Testing**: Use playwright to navigate to https://github.com and verify the page title contains "GitHub"
3. **File Writing Testing**: Create a test file `/tmp/gh-aw/agent/smoke-test-claude-${{ github.run_id }}.txt` with content "Smoke test passed for Claude at $(date)" (create the directory if it doesn't exist)
4. **Bash Tool Testing**: Execute bash commands to verify file creation was successful (use `cat` to read the file back)

## Output

Add a **very brief** comment (max 5-10 lines) to the current pull request with:
- PR titles only (no descriptions)
- ✅ or ❌ for each test result
- Overall status: PASS or FAIL

If all tests pass, add the label `smoke-claude` to the pull request.
