---
description: Build Test Bun
on:
  workflow_dispatch:
  pull_request:
    types: [opened, synchronize, reopened]
roles: all
permissions:
  contents: read
  pull-requests: read
  issues: read
name: Build Test Bun
engine: copilot
network:
  allowed:
    - defaults
    - github
    - node
    - "bun.sh"
tools:
  bash:
    - "*"
  github:
sandbox:
  mcp:
    container: "ghcr.io/github/gh-aw-mcpg"
safe-outputs:
  add-comment:
    hide-older-comments: true
  add-labels:
    allowed: [build-test-bun]
  messages:
    run-failure: "**Build Test Failed** [{workflow_name}]({run_url}) - See logs for details"
timeout-minutes: 15
strict: true
---

# Build Test: Bun

**IMPORTANT: Keep all outputs concise. Report results clearly with pass/fail status.**

## Test Requirements

1. **Install Bun**:
   ```bash
   curl -fsSL https://bun.sh/install | bash
   export BUN_INSTALL="$HOME/.bun"
   export PATH="$BUN_INSTALL/bin:$PATH"
   ```

2. **Clone Repository**: `git clone https://github.com/Mossaka/gh-aw-firewall-test-bun.git /tmp/test-bun`

3. **Test Projects**:
   - `elysia`: `cd /tmp/test-bun/elysia && bun install && bun test`
   - `hono`: `cd /tmp/test-bun/hono && bun install && bun test`

4. **For each project**, capture:
   - Install success/failure
   - Test pass/fail count
   - Any error messages

## Output

Add a comment to the current pull request with a summary table:

| Project | Install | Tests | Status |
|---------|---------|-------|--------|
| elysia  | ✅/❌   | X/Y   | PASS/FAIL |
| hono    | ✅/❌   | X/Y   | PASS/FAIL |

**Overall: PASS/FAIL**

If ALL tests pass, add the label `build-test-bun` to the pull request.
If ANY test fails, report the failure with error details.
