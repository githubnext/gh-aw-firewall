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
  max-turns: 15
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

# Verify Language Runtimes

Check that common language runtimes are installed and print their versions.

Run these commands and report the results:

```bash
python3 --version
node --version
go version
java --version 2>&1 | head -1
dotnet --version
```

Add a comment to the PR with a table showing each runtime and its version. If all runtimes are found, add the label `smoke-chroot`.
