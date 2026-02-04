---
description: Build Test C++
on:
  workflow_dispatch:
  pull_request:
    types: [opened, synchronize, reopened]
roles: all
permissions:
  contents: read
  pull-requests: read
  issues: read
name: Build Test C++
engine: copilot
network:
  allowed:
    - defaults
    - github
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
    allowed: [build-test-cpp]
  messages:
    run-failure: "**Build Test Failed** [{workflow_name}]({run_url}) - See logs for details"
timeout-minutes: 30
strict: true
---

# Build Test: C++

**IMPORTANT: Keep all outputs concise. Report results clearly with pass/fail status.**

## Test Requirements

Clone and test the following projects from the test repository:

1. **Clone Repository**: `git clone https://github.com/Mossaka/gh-aw-firewall-test-cpp.git /tmp/test-cpp`

2. **Test Projects**:
   - `fmt`:
     ```bash
     cd /tmp/test-cpp/fmt
     mkdir -p build && cd build
     cmake ..
     make
     ```
   - `json`:
     ```bash
     cd /tmp/test-cpp/json
     mkdir -p build && cd build
     cmake ..
     make
     ```

3. **For each project**, capture:
   - CMake configuration success/failure
   - Build success/failure
   - Any error messages

## Output

Add a comment to the current pull request with a summary table:

| Project | CMake | Build | Status |
|---------|-------|-------|--------|
| fmt     | ✅/❌  | ✅/❌  | PASS/FAIL |
| json    | ✅/❌  | ✅/❌  | PASS/FAIL |

**Overall: PASS/FAIL**

If ALL builds pass, add the label `build-test-cpp` to the pull request.
If ANY build fails, report the failure with error details.
