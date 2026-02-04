---
description: Build Test Deno
on:
  workflow_dispatch:
  pull_request:
    types: [opened, synchronize, reopened]
roles: all
permissions:
  contents: read
  pull-requests: read
  issues: read
name: Build Test Deno
engine: copilot
network:
  allowed:
    - defaults
    - github
    - node
    - "deno.land"
    - "jsr.io"
    - "dl.deno.land"
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
    allowed: [build-test-deno]
  messages:
    run-failure: "**Build Test Failed** [{workflow_name}]({run_url}) - See logs for details"
timeout-minutes: 15
strict: true
---

# Build Test: Deno

**IMPORTANT: Keep all outputs concise. Report results clearly with pass/fail status.**

## Test Requirements

1. **Install Deno**:
   ```bash
   curl -fsSL https://deno.land/install.sh | sh
   export DENO_INSTALL="$HOME/.deno"
   export PATH="$DENO_INSTALL/bin:$PATH"
   ```

2. **Clone Repository**: `git clone https://github.com/Mossaka/gh-aw-firewall-test-deno.git /tmp/test-deno`

3. **Test Projects**:
   - `oak`: `cd /tmp/test-deno/oak && deno test`
   - `std`: `cd /tmp/test-deno/std && deno test`

4. **For each project**, capture:
   - Test pass/fail count
   - Any error messages

## Output

Add a comment to the current pull request with a summary table:

| Project | Tests | Status |
|---------|-------|--------|
| oak     | X/Y   | PASS/FAIL |
| std     | X/Y   | PASS/FAIL |

**Overall: PASS/FAIL**

If ALL tests pass, add the label `build-test-deno` to the pull request.
If ANY test fails, report the failure with error details.
