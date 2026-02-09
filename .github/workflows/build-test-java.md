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
env:
  GH_TOKEN: "${{ secrets.GH_AW_GITHUB_MCP_SERVER_TOKEN }}"
---

# Build Test: Java

**IMPORTANT: Keep all outputs concise. Report results clearly with pass/fail status.**

## Test Requirements

### 1. Verify Java Proxy Configuration

Before running any tests, verify that Java proxy configuration is properly set:

```bash
# Verify JAVA_TOOL_OPTIONS is set
echo "JAVA_TOOL_OPTIONS=$JAVA_TOOL_OPTIONS"

# Extract and display proxy settings
java -XshowSettings:properties -version 2>&1 | grep -E "http\.(proxyHost|proxyPort|nonProxyHosts)|https\.(proxyHost|proxyPort)"
```

**Expected configuration**:
- `http.proxyHost` should be set to Squid IP (e.g., `172.30.0.10`)
- `http.proxyPort` should be `3128`
- `https.proxyHost` should be set to Squid IP
- `https.proxyPort` should be `3128`
- If host access is enabled, `http.nonProxyHosts` should include `localhost|127.0.0.1|host.docker.internal`

If proxy settings are missing or incorrect, report the issue and fail the workflow.

### 2. Clone Repository

`gh repo clone Mossaka/gh-aw-firewall-test-java /tmp/test-java`
- **CRITICAL**: If clone fails, immediately call `safeoutputs-missing_tool` with message "CLONE_FAILED: Unable to clone test repository" and stop execution

### 3. Test Projects

Run Maven compile and test for each project:
- `gson`: `cd /tmp/test-java/gson && mvn compile && mvn test`
- `caffeine`: `cd /tmp/test-java/caffeine && mvn compile && mvn test`

### 4. Capture Results

For each project, capture:
- Compile success/failure
- Test pass/fail count
- Any error messages

## Output

Add a comment to the current pull request with a summary including:

1. **Java Proxy Configuration Status**:
   - ✅ Proxy settings verified OR ❌ Proxy settings missing/incorrect
   - Display the actual `JAVA_TOOL_OPTIONS` value
   - List detected proxy properties (http.proxyHost, http.proxyPort, https.proxyHost, https.proxyPort, http.nonProxyHosts if present)

2. **Build/Test Results Table**:

| Project  | Compile | Tests | Status |
|----------|---------|-------|--------|
| gson     | ✅/❌   | X/Y   | PASS/FAIL |
| caffeine | ✅/❌   | X/Y   | PASS/FAIL |

**Overall: PASS/FAIL**

If ALL tests pass AND proxy configuration is correct, add the label `build-test-java` to the pull request.
If ANY test fails OR proxy configuration is incorrect, report the failure with error details.

## Error Handling

**CRITICAL**: This workflow MUST fail visibly when errors occur:

1. **Proxy configuration failure**: If Java proxy settings are missing or incorrect, report in comment with actual vs expected values
2. **Clone failure**: If repository clone fails, call `safeoutputs-missing_tool` with "CLONE_FAILED: [error message]"
3. **Build failure**: Report in comment table with ❌ and include error output
4. **Test failure**: Report in comment table with FAIL status and include failure details

DO NOT report success if any step fails. The workflow should produce a clear, actionable error message.
