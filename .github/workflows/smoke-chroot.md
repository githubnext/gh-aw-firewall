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

# Smoke Test: Chroot Feature Validation

**IMPORTANT: You are running inside awf with `--enable-chroot` enabled. You have direct access to host binaries.**

## Context

The `--enable-chroot` feature allows you to transparently access host binaries (Python, Node, Go, Java, .NET) at their standard paths. You can run these directly without any special commands.

## Test Tasks

### 1. Language Runtime Version Tests
Run each runtime and capture its version:

```bash
python3 --version
node --version
go version
java --version 2>&1 | head -1
dotnet --version
```

### 2. Standard Library Tests
Verify each runtime can access its standard libraries:

```bash
# Python stdlib
python3 -c "import json, os, sys, http.client; print('Python stdlib OK')"

# Node.js builtins
node -e "require('fs'); require('path'); require('os'); console.log('Node builtins OK')"

# Go compilation
cd /tmp && echo 'package main; func main() { println("Go OK") }' > test.go && go run test.go && rm test.go

# .NET runtime list
dotnet --list-runtimes
```

### 3. Security Boundary Tests
Verify security restrictions are in place:

```bash
# Check Docker socket is hidden
ls -la /var/run/docker.sock

# Check iptables is blocked
iptables -L 2>&1

# Check /usr is read-only
touch /usr/testfile 2>&1

# Check /tmp is writable
echo test > /tmp/awf-test && cat /tmp/awf-test && rm /tmp/awf-test
```

### 4. User Identity Test
```bash
whoami
id
```

## Output Requirements

Create a PR comment with a summary table:

| Test | Result |
|------|--------|
| Python version | [version] |
| Node.js version | [version] |
| Go version | [version] |
| Java version | [version] |
| .NET version | [version] |
| Python stdlib | PASS/FAIL |
| Node builtins | PASS/FAIL |
| Go compilation | PASS/FAIL |
| .NET runtime | PASS/FAIL |
| Docker socket hidden | PASS/FAIL |
| iptables blocked | PASS/FAIL |
| /usr read-only | PASS/FAIL |
| /tmp writable | PASS/FAIL |
| User not root | PASS/FAIL |

If ALL tests pass, add the label `smoke-chroot`.

## Expected Results

- All runtimes should be accessible at standard paths
- Standard library tests should all pass
- Docker socket should be mapped to /dev/null
- iptables commands should fail with "Permission denied"
- /usr should be read-only
- /tmp should be writable
- User should NOT be root
