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
runtimes:
  bun:
    version: "latest"
network:
  allowed:
    - defaults
    - github
    - node
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
env:
  GH_TOKEN: "${{ secrets.GH_AW_GITHUB_MCP_SERVER_TOKEN }}"
steps:
  - name: Checkout repository
    uses: actions/checkout@8e8c483db84b4bee98b60c0593521ed34d9990e8
    with:
      persist-credentials: false
---

# Build Test: Bun

**IMPORTANT: Keep all outputs concise. Report results clearly with pass/fail status.**

## Test Requirements

1. **Verify Bun**: Bun is pre-installed. Run `bun --version` to confirm it's available on PATH.

2. **Clone Repository**: `gh repo clone Mossaka/gh-aw-firewall-test-bun /tmp/test-bun`
   - **CRITICAL**: If clone fails, immediately call `safeoutputs-missing_tool` with message "CLONE_FAILED: Unable to clone test repository" and stop execution

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

## Error Handling

**CRITICAL**: This workflow MUST fail visibly when errors occur:

1. **Clone failure**: If repository clone fails, call `safeoutputs-missing_tool` with "CLONE_FAILED: [error message]"
2. **Bun not available**: If `bun --version` fails, call `safeoutputs-missing_tool` with "BUN_NOT_FOUND: bun not available on PATH"
3. **Test failure**: Report in comment table with FAIL status and include failure details

DO NOT report success if any step fails. The workflow should produce a clear, actionable error message.
