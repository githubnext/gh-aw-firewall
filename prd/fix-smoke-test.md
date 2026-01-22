# PRD: Fix Smoke Copilot Test Failures

## Goal

Code review, Investigate and fix the failing smoke tests in the Smoke Copilot workflow on https://github.com/githubnext/gh-aw-firewall/pull/356 and push upstream to trigger the workflows

## Success Criteria

monitor pipelines, and Pipeline logs should not have issues with MCP servers. Even if the pipeline is green, if the logs say "GitHub MCP: Failed (no response)", it's a failure.

## Investigation Summary

### Root Cause 1: MCP Gateway Not Used (Fixed in previous commit)
The original workflow (compiled with gh-aw v0.36.0) was missing MCP Gateway setup steps.
- MCP servers were trying to run as Docker containers inside the AWF sandbox
- AWF doesn't support Docker-in-Docker, causing MCP servers to fail silently
- Fixed by recompiling with gh-aw v0.37.3 which properly includes MCP Gateway

### Root Cause 2: --build-local Flag Incompatible with Binary Install (Fixed)
The workflow used `--build-local` flag which requires AWF source files, but AWF was installed
as a pre-built binary via `install_awf_binary.sh`. This caused container build failures:
```
unable to prepare context: path "/snapshot/gh-aw-firewall/containers/agent" not found
```

**Fix**: Replaced `--build-local` with `--image-tag 0.10.0` to use pre-built GHCR containers
matching the installed AWF version.

## Status

- [x] Investigated MCP Gateway issue
- [x] Recompiled workflow with gh-aw v0.37.3
- [x] Fixed --build-local incompatibility
- [x] Verify GitHub MCP works in pipeline logs

## Result

**COMPLETE** - Workflow run 21232751884 passed with all tests:
- GitHub MCP: Retrieved last 2 merged PRs
- Playwright: Verified github.com title
- File Writing: Created test file
- Bash: Verified file creation
