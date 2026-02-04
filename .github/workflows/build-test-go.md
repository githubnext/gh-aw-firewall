---
description: Build Test Go
on:
  workflow_dispatch:
  pull_request:
    types: [opened, synchronize, reopened]
roles: all
permissions:
  contents: read
  pull-requests: read
  issues: read
name: Build Test Go
engine: copilot
runtimes:
  go:
    version: "1.22"
network:
  allowed:
    - defaults
    - github
    - go
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
    allowed: [build-test-go]
  messages:
    run-failure: "**Build Test Failed** [{workflow_name}]({run_url}) - See logs for details"
timeout-minutes: 15
strict: true
---

# Build Test: Go

**IMPORTANT: Keep all outputs concise. Report results clearly with pass/fail status.**

## Test Requirements

Clone and test the following projects from the test repository:

1. **Clone Repository**: `git clone https://github.com/Mossaka/gh-aw-firewall-test-go.git /tmp/test-go`

2. **Test Projects**:
   - `color`: `cd /tmp/test-go/color && go mod download && go test ./...`
   - `env`: `cd /tmp/test-go/env && go mod download && go test ./...`
   - `uuid`: `cd /tmp/test-go/uuid && go mod download && go test ./...`

3. **For each project**, capture:
   - Module download success/failure
   - Test pass/fail count
   - Any error messages

## Output

Add a comment to the current pull request with a summary table:

| Project | Download | Tests | Status |
|---------|----------|-------|--------|
| color   | ✅/❌    | X/Y   | PASS/FAIL |
| env     | ✅/❌    | X/Y   | PASS/FAIL |
| uuid    | ✅/❌    | X/Y   | PASS/FAIL |

**Overall: PASS/FAIL**

If ALL tests pass, add the label `build-test-go` to the pull request.
If ANY test fails, report the failure with error details.
