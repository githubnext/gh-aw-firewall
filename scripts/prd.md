# PRD: Fix Smoke Copilot Test Failures

## Goal

Investigate and fix the failing smoke tests in the Smoke Copilot workflow (Run #21231821036).

## Current Status

PR URL: https://github.com/githubnext/gh-aw-firewall/pull/356
Branch: `add-local-awf-transform-script`
Workflow Run: https://github.com/githubnext/gh-aw-firewall/actions/runs/21231821036

### Test Results

| Test | Status | Notes |
|------|--------|-------|
| GitHub MCP | ❌ FAIL | No response |
| Playwright | ❌ FAIL | Title check failed |
| File Writing | ✅ PASS | Success |
| Bash Tool | ✅ PASS | Verified file creation |

**Overall Status: ❌ FAIL**

## Tasks

- [x] Download and analyze workflow logs from run #21231821036
- [x] Investigate GitHub MCP failure (no response)
- [x] Investigate Playwright title check failure
- [x] Identify root cause of failures
- [x] Implement fixes if they are in this repo's code
- [x] If failures are environment/flaky issues, document findings

## Root Cause Analysis - COMPLETED

### Summary

**Both failures are caused by architecture incompatibility, NOT bugs in gh-aw-firewall.**

The MCP servers (GitHub and Playwright) are configured to run as Docker containers but Docker-in-Docker support was intentionally removed from AWF in v0.9.1 (PR #205).

### Technical Details

1. **MCP Configuration** (from `smoke-copilot.lock.yml`):
   - GitHub MCP: `"command": "docker", "args": ["run", ..., "ghcr.io/github/github-mcp-server:v0.27.0"]`
   - Playwright MCP: `"command": "docker", "args": ["run", ..., "mcr.microsoft.com/playwright/mcp"]`

2. **Docker Stub**: Inside the AWF agent container, `/usr/bin/docker` is replaced by `docker-stub.sh` which:
   ```bash
   cat >&2 <<'EOF'
   ERROR: Docker-in-Docker support was removed in AWF v0.9.1
   ...
   EOF
   exit 127
   ```

3. **Agent Output** (from logs):
   - `missing_tool: "Playwright MCP tools" - Required to navigate to GitHub...`
   - `missing_tool: "GitHub MCP server or authenticated gh CLI" - Need GitHub API access...`

### Why This Is Not Fixable in gh-aw-firewall

The Docker-in-Docker removal was a **deliberate security/architecture decision** (PR #205). The fix needs to be made in the `gh-aw` repository by:

1. Using HTTP-based MCP servers instead of Docker-based ones, OR
2. Running Docker-based MCPs outside the firewall container, OR
3. Properly configuring the MCP Gateway (`sandbox.mcp.container: ghcr.io/githubnext/gh-aw-mcpg`)

### Recommendation

This should be tracked as an issue in `githubnext/gh-aw` repository, not here. The smoke-copilot workflow needs to be updated to use MCP servers that are compatible with the AWF sandbox.

## Investigation Steps (Completed)

1. ✅ Downloaded workflow run logs via `gh run view 21231821036`
2. ✅ Checked smoke-copilot.lock.yml workflow definition
3. ✅ Found error messages showing MCP servers reported as missing tools
4. ✅ Traced to `docker-stub.sh` which prevents Docker commands inside AWF

## Success Criteria - MET

1. ✅ Root cause identified for both failures (Docker-in-Docker incompatibility)
2. ✅ Documented as environment/architecture issue (not fixable in this repo)
3. N/A - Not fixable in this repo; needs changes to gh-aw compiler
