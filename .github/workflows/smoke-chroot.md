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
  max-turns: 25
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

**IMPORTANT: Keep all outputs concise. Report test results clearly with pass/fail status.**

## Context

You are testing the `--enable-chroot` feature of the Agentic Workflow Firewall (awf). This feature allows agents to transparently access host binaries (Python, Node, Go, Java, .NET, etc.) while maintaining network firewall restrictions and security isolation.

The awf binary has been built locally from this repository and installed at `/usr/local/bin/awf`.

## Test Requirements

Run the following tests using `sudo awf --enable-chroot` and report results:

### 1. Language Runtime Version Verification

**CRITICAL TEST**: First, capture the host versions of all language runtimes, then verify they match inside the chroot.

#### Step 1: Capture Host Versions
Run these commands directly on the host (NOT inside awf) and save the versions:

```bash
# Capture host versions
echo "=== HOST VERSIONS ==="
python3 --version
node --version
go version
java --version 2>&1 | head -1
dotnet --version
```

#### Step 2: Capture Chroot Versions
Run the same commands inside the chroot and compare:

```bash
# Python
sudo awf --enable-chroot --allow-domains localhost -- python3 --version

# Node.js
sudo awf --enable-chroot --allow-domains localhost -- node --version

# Go
sudo awf --enable-chroot --allow-domains localhost -- go version

# Java
sudo awf --enable-chroot --allow-domains localhost -- java --version 2>&1

# .NET
sudo awf --enable-chroot --allow-domains localhost -- dotnet --version
```

#### Step 3: Verify Versions Match
Compare the host versions with chroot versions. They MUST match exactly. Report any mismatches as FAIL.

### 2. Standard Library Access Tests
Test that language runtimes can access their standard libraries:

```bash
# Python stdlib
sudo awf --enable-chroot --allow-domains localhost -- python3 -c "import json, os, sys, http.client; print('Python stdlib OK')"

# Node.js builtins
sudo awf --enable-chroot --allow-domains localhost -- node -e "require('fs'); require('path'); require('os'); console.log('Node builtins OK')"

# Go compilation (create a simple program)
sudo awf --enable-chroot --allow-domains localhost -- bash -c 'cd /tmp && echo "package main; func main() { println(\"Go OK\") }" > test.go && go run test.go && rm test.go'

# Java compilation
sudo awf --enable-chroot --allow-domains localhost -- bash -c 'cd /tmp && echo "public class Test { public static void main(String[] args) { System.out.println(\"Java OK\"); } }" > Test.java && javac Test.java && java Test && rm Test.java Test.class'

# .NET execution
sudo awf --enable-chroot --allow-domains localhost -- dotnet --list-runtimes
```

### 3. Network Firewall Tests
Test that network restrictions are enforced:

```bash
# Allowed domain should work
sudo awf --enable-chroot --allow-domains api.github.com -- curl -s https://api.github.com/zen

# Blocked domain should fail (expect 403 or connection error)
sudo awf --enable-chroot --allow-domains api.github.com -- curl -s --connect-timeout 5 https://example.com
```

### 4. Security Boundary Tests
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

### 5. User Identity Test
Test that user identity is preserved:

```bash
sudo awf --enable-chroot --allow-domains localhost -- whoami
sudo awf --enable-chroot --allow-domains localhost -- id
```

## Output Requirements

After running all tests, create a summary with:

1. **Version Comparison Table**: Show host version vs chroot version for each runtime (Python, Node, Go, Java, .NET)
2. **Version Match Status**: PASS if all versions match, FAIL if any mismatch
3. **Standard Library Tests**: PASS/FAIL for each runtime's stdlib test
4. **Network Tests**: PASS/FAIL for allowed/blocked domain tests
5. **Security Tests**: PASS/FAIL for Docker socket, iptables, read-only /usr, writable /tmp
6. **Identity Test**: Confirm user is NOT root

Add a comment to the current pull request with the test summary table. If ALL tests pass (including version matches), add the label `smoke-chroot`.

## Expected Results

| Runtime | Host Version | Chroot Version | Match? |
|---------|--------------|----------------|--------|
| Python  | 3.12.x       | 3.12.x         | PASS   |
| Node.js | 24.x.x       | 24.x.x         | PASS   |
| Go      | 1.23.x       | 1.23.x         | PASS   |
| Java    | 21.x.x       | 21.x.x         | PASS   |
| .NET    | 8.x.x        | 8.x.x          | PASS   |

- All stdlib/builtin tests should pass
- api.github.com requests should succeed
- example.com requests should be blocked (403)
- Docker socket should show as /dev/null (character device 1,3)
- iptables should return "Permission denied"
- /usr should be read-only
- /tmp should be writable
- User should NOT be root
