---
description: Build Test Rust
on:
  workflow_dispatch:
  pull_request:
    types: [opened, synchronize, reopened]
roles: all
permissions:
  contents: read
  pull-requests: read
  issues: read
name: Build Test Rust
engine: copilot
runtimes:
  rust:
    version: "stable"
network:
  allowed:
    - defaults
    - github
    - rust
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
    allowed: [build-test-rust]
  messages:
    run-failure: "**Build Test Failed** [{workflow_name}]({run_url}) - See logs for details"
timeout-minutes: 30
strict: true
---

# Build Test: Rust

**IMPORTANT: Keep all outputs concise. Report results clearly with pass/fail status.**

## Test Requirements

Clone and test the following projects from the test repository:

1. **Clone Repository**: `git clone https://github.com/Mossaka/gh-aw-firewall-test-rust.git /tmp/test-rust`

2. **Test Projects**:
   - `fd`: `cd /tmp/test-rust/fd && cargo build && cargo test`
   - `zoxide`: `cd /tmp/test-rust/zoxide && cargo build && cargo test`

3. **For each project**, capture:
   - Build success/failure
   - Test pass/fail count
   - Any error messages

## Output

Add a comment to the current pull request with a summary table:

| Project | Build | Tests | Status |
|---------|-------|-------|--------|
| fd      | ✅/❌  | X/Y   | PASS/FAIL |
| zoxide  | ✅/❌  | X/Y   | PASS/FAIL |

**Overall: PASS/FAIL**

If ALL tests pass, add the label `build-test-rust` to the pull request.
If ANY test fails, report the failure with error details.
