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
  max-turns: 20
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
timeout-minutes: 15
---

# Smoke Test: Chroot Feature Validation

**IMPORTANT: Keep all outputs concise. Report test results clearly with pass/fail status.**

## Context

You are testing the `--enable-chroot` feature of the Agentic Workflow Firewall (awf). This feature allows agents to transparently access host binaries (Python, Node, Go, etc.) while maintaining network firewall restrictions and security isolation.

The awf binary has been built locally from this repository and installed at `/usr/local/bin/awf`.

## Test Requirements

Run the following tests using `sudo awf --enable-chroot` and report results:

### 1. Host Binary Access Tests
Test that host binaries are accessible inside the chroot:

```bash
# Test Python
sudo awf --enable-chroot --allow-domains localhost -- python3 --version

# Test Node.js
sudo awf --enable-chroot --allow-domains localhost -- node --version

# Test that Python stdlib works
sudo awf --enable-chroot --allow-domains localhost -- python3 -c "import json, os, sys; print('Python stdlib OK')"
```

### 2. Network Firewall Tests
Test that network restrictions are enforced:

```bash
# Allowed domain should work
sudo awf --enable-chroot --allow-domains api.github.com -- curl -s https://api.github.com/zen

# Blocked domain should fail (expect 403 or connection error)
sudo awf --enable-chroot --allow-domains api.github.com -- curl -s --connect-timeout 5 https://example.com
```

### 3. Security Boundary Tests
Test that security restrictions are enforced:

```bash
# Docker socket should be hidden (mapped to /dev/null)
sudo awf --enable-chroot --allow-domains localhost -- ls -la /var/run/docker.sock

# iptables should be blocked
sudo awf --enable-chroot --allow-domains localhost -- iptables -L 2>&1

# System directories should be read-only
sudo awf --enable-chroot --allow-domains localhost -- touch /usr/testfile 2>&1

# Tmp should be writable
sudo awf --enable-chroot --allow-domains localhost -- bash -c "echo test > /tmp/awf-test && cat /tmp/awf-test && rm /tmp/awf-test"
```

### 4. User Identity Test
Test that user identity is preserved:

```bash
sudo awf --enable-chroot --allow-domains localhost -- whoami
sudo awf --enable-chroot --allow-domains localhost -- id
```

## Output Requirements

After running all tests, create a summary with:

1. **Test Results Table**: List each test category with PASS/FAIL status
2. **Versions Found**: Python, Node.js versions detected
3. **Security Checks**: Confirmation that Docker socket is hidden, iptables blocked, /usr read-only
4. **Any Failures**: Details of any failed tests

Add a comment to the current pull request with the test summary. If ALL tests pass, add the label `smoke-chroot`.

## Expected Results

- Python and Node.js should be accessible at standard paths
- api.github.com requests should succeed
- example.com requests should be blocked (403)
- Docker socket should show as /dev/null (character device 1,3)
- iptables should return "Permission denied"
- /usr should be read-only
- /tmp should be writable
- User should NOT be root
