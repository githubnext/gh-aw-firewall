# PRD: Fix Smoke Copilot Test Failures

## Goal

Code review, Investigate and fix the failing smoke tests in the Smoke Copilot workflow on https://github.com/githubnext/gh-aw-firewall/pull/356

## Success Criteria

Pipeline logs should not have issues with MCP servers. Even if the pipeline is green, if the logs say ❌ GitHub MCP: Failed (no response), it's a failure.

## Investigation Results

### Root Cause

The smoke-copilot workflow fails to access the GitHub MCP server because:

1. **Missing MCP Gateway Setup**: The `smoke-copilot.lock.yml` is missing the "Start MCP gateway" step that is present in `release.lock.yml`

2. **MCP Server Configuration Issue**: The current MCP config in `smoke-copilot.lock.yml` tries to run `docker run` to start the GitHub MCP server:
   ```json
   "command": "docker",
   "args": ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", ...]
   ```
   But inside the AWF (Agent Workflow Firewall) container, Docker-in-Docker is not available, so the GitHub MCP server cannot be started.

3. **Contrast with release.lock.yml**: The `release.lock.yml` workflow properly sets up an MCP Gateway that:
   - Starts on the host machine (not inside the AWF container)
   - Uses `ghcr.io/githubnext/gh-aw-mcpg` container
   - Proxies MCP requests through HTTP to `host.docker.internal`
   - Allows MCP servers to work from within the sandboxed AWF environment

### Evidence

From workflow run #21231821036 logs:
- The agent output shows: `{"tool":"GitHub MCP server or authenticated gh CLI","reason":"Need GitHub API access to query merged pull requests from the repository","alternatives":"Set GH_TOKEN environment variable or use web_fetch with GitHub's public API","type":"missing_tool"}`
- The final test results: `❌ GitHub MCP: Failed (no response)`

### Technical Details

The `smoke-copilot.md` has `sandbox.mcp.container: "ghcr.io/githubnext/gh-aw-mcpg"` configured, but the compiled `smoke-copilot.lock.yml` (compiled by gh-aw v0.36.0) doesn't include the MCP gateway startup logic. This appears to be a gh-aw compiler issue where the `sandbox.mcp` configuration isn't being processed correctly.

## Resolution Options

### Option 1: Recompile with Updated gh-aw (Recommended)
Recompile `smoke-copilot.lock.yml` using a version of gh-aw that properly handles the `sandbox.mcp` configuration and generates the MCP Gateway startup steps.

### Option 2: Manually Add MCP Gateway Step
Add the MCP Gateway startup step to `smoke-copilot.lock.yml` similar to what's in `release.lock.yml`. This is a workaround and would require manual maintenance.

### Option 3: Remove GitHub MCP Requirement from Test
Modify the smoke test prompt to not require GitHub MCP functionality. This avoids the root cause but reduces test coverage.

## Tasks

- [x] Investigate PR #356 smoke test failures
- [x] Document root cause
- [ ] Implement fix (recompile workflow or add MCP gateway step) 
