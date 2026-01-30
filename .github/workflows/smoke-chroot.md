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
  id: copilot
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
steps:
  - name: Capture host versions for verification
    run: |
      echo "=== Capturing host versions for post-verification ==="
      echo "HOST_PYTHON_VERSION=$(python3 --version 2>&1 | head -1)" >> /tmp/host-versions.env
      echo "HOST_NODE_VERSION=$(node --version 2>&1 | head -1)" >> /tmp/host-versions.env
      echo "HOST_GO_VERSION=$(go version 2>&1 | head -1)" >> /tmp/host-versions.env
      cat /tmp/host-versions.env
---

# Verify Language Runtimes Match Host

This smoke test validates that `--enable-chroot` provides transparent access to host binaries by comparing versions.

## Step 1: Read Host Versions

First, read the host versions that were captured in the setup step:

```bash
cat /tmp/host-versions.env
```

## Step 2: Run Tests via AWF Chroot

Run the same version commands through `awf --enable-chroot` and verify they match:

```bash
# Test Python version matches host
sudo awf --enable-chroot --allow-domains localhost -- python3 --version

# Test Node version matches host
sudo awf --enable-chroot --allow-domains localhost -- node --version

# Test Go version matches host
sudo awf --enable-chroot --allow-domains localhost -- go version
```

## Step 3: Verify Versions Match

Compare the versions from chroot with the host versions from `/tmp/host-versions.env`.

Create a summary table showing:
| Runtime | Host Version | Chroot Version | Match? |
|---------|--------------|----------------|--------|

If ALL versions match, the test passes. Add a comment to the PR with the comparison table.

If all runtimes match, add the label `smoke-chroot`.
