---
description: Build Test Java
on:
  workflow_dispatch:
  pull_request:
    types: [opened, synchronize, reopened]
roles: all
permissions:
  contents: read
  pull-requests: read
  issues: read
name: Build Test Java
engine: copilot
runtimes:
  java:
    version: "21"
network:
  allowed:
    - defaults
    - github
    - java
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
    allowed: [build-test-java]
  messages:
    run-failure: "**Build Test Failed** [{workflow_name}]({run_url}) - See logs for details"
timeout-minutes: 15
strict: true
---

# Build Test: Java

**IMPORTANT: Keep all outputs concise. Report results clearly with pass/fail status.**

## Test Requirements

Clone and test the following projects from the test repository:

1. **Clone Repository**: `git clone https://github.com/Mossaka/gh-aw-firewall-test-java.git /tmp/test-java`

2. **Test Projects**:
   - `gson`: `cd /tmp/test-java/gson && mvn compile && mvn test`
   - `caffeine`: `cd /tmp/test-java/caffeine && mvn compile && mvn test`

3. **For each project**, capture:
   - Compile success/failure
   - Test pass/fail count
   - Any error messages

## Output

Add a comment to the current pull request with a summary table:

| Project  | Compile | Tests | Status |
|----------|---------|-------|--------|
| gson     | ✅/❌   | X/Y   | PASS/FAIL |
| caffeine | ✅/❌   | X/Y   | PASS/FAIL |

**Overall: PASS/FAIL**

If ALL tests pass, add the label `build-test-java` to the pull request.
If ANY test fails, report the failure with error details.
