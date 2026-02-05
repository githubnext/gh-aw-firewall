---
description: Build Test Node.js
on:
  workflow_dispatch:
  pull_request:
    types: [opened, synchronize, reopened]
roles: all
permissions:
  contents: read
  pull-requests: read
  issues: read
name: Build Test Node.js
engine: copilot
runtimes:
  node:
    version: "20"
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
    allowed: [build-test-node]
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

# Build Test: Node.js

**IMPORTANT: Keep all outputs concise. Report results clearly with pass/fail status.**

## Test Requirements

Clone and test the following projects from the test repository:

1. **Clone Repository**: `gh repo clone Mossaka/gh-aw-firewall-test-node /tmp/test-node`
   - **CRITICAL**: If clone fails, immediately call `safeoutputs-missing_tool` with message "CLONE_FAILED: Unable to clone test repository" and stop execution

2. **Test Projects**:
   - `clsx`: `cd /tmp/test-node/clsx && npm install && npm test`
   - `execa`: `cd /tmp/test-node/execa && npm install && npm test`
   - `p-limit`: `cd /tmp/test-node/p-limit && npm install && npm test`

3. **For each project**, capture:
   - Install success/failure
   - Test pass/fail count
   - Any error messages

## Output

Add a comment to the current pull request with a summary table:

| Project | Install | Tests | Status |
|---------|---------|-------|--------|
| clsx    | ✅/❌   | X/Y   | PASS/FAIL |
| execa   | ✅/❌   | X/Y   | PASS/FAIL |
| p-limit | ✅/❌   | X/Y   | PASS/FAIL |

**Overall: PASS/FAIL**

If ALL tests pass, add the label `build-test-node` to the pull request.
If ANY test fails, report the failure with error details.

## Error Handling

**CRITICAL**: This workflow MUST fail visibly when errors occur:

1. **Clone failure**: If repository clone fails, call `safeoutputs-missing_tool` with "CLONE_FAILED: [error message]"
2. **Install failure**: Report in comment table with ❌ and include error output
3. **Test failure**: Report in comment table with FAIL status and include failure details

DO NOT report success if any step fails. The workflow should produce a clear, actionable error message.
