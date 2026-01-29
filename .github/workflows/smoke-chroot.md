---
description: Smoke test workflow that validates the --enable-chroot feature by testing host binary access, network firewall, and security boundaries
on:
  workflow_dispatch:
  pull_request:
    types: [opened, synchronize, reopened]
    paths:
      - 'src/**'
      - 'containers/**'
      - 'package.json'
      - '.github/workflows/smoke-chroot.md'
  reaction: "rocket"
roles: all
permissions:
  contents: read
  issues: read
  pull-requests: read

name: Smoke Chroot
engine:
  id: claude
  max-turns: 10
strict: true
network:
  allowed:
    - defaults
    - github
sandbox:
  mcp:
    container: "ghcr.io/githubnext/gh-aw-mcpg"
tools:
  github:
    toolsets: [repos, pull_requests]
  bash:
    - "*"
safe-outputs:
    add-comment:
      hide-older-comments: true
    add-labels:
      allowed: [smoke-chroot]
    messages:
      footer: "> Tested by [{workflow_name}]({run_url})"
      run-started: "**Testing chroot feature** [{workflow_name}]({run_url}) is validating --enable-chroot functionality..."
      run-success: "**Chroot tests passed!** [{workflow_name}]({run_url}) - All security and functionality tests succeeded."
      run-failure: "**Chroot tests failed** [{workflow_name}]({run_url}) {status} - See logs for details."
timeout-minutes: 20
---

# Smoke Test: Chroot Feature Validation

**IMPORTANT: The chroot tests have already been run in a previous step. Your job is to read and report the results.**

## Context

The `--enable-chroot` feature of the Agentic Workflow Firewall (awf) has been tested in a previous workflow step. The tests ran with sudo privileges outside the sandbox container.

The test results are available at: `chroot-test-results.md` in the workspace root.

## Your Task

1. **Read the test results file**:
   ```bash
   cat chroot-test-results.md
   ```

2. **Add a PR comment** with the full test results. The comment should include:
   - The version comparison table
   - Standard library test results
   - Network firewall test results
   - Security boundary test results
   - User identity test results
   - Overall pass/fail status

3. **Add the label** `smoke-chroot` if ALL tests passed.

## Important Notes

- Do NOT try to run `sudo awf --enable-chroot` commands yourself - they won't work in this sandbox environment
- Just read the pre-generated results and report them
- The test results markdown is already formatted nicely - you can include it directly in the PR comment
