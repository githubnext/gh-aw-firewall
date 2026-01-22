# PRD: Test Local AWF in Smoke Copilot Workflow

## Goal

Run smoke-copilot workflow with AWF installed from the local repo (current PR branch) instead of a released version, and verify CI passes.

## Background

- PR #356 added `scripts/use-local-awf.sh` which can transform workflow files
- Currently, workflows use `curl ... install.sh | sudo AWF_VERSION=v0.8.2 bash` to install AWF
- We need to transform them to clone the repo, build locally, and npm link
- The smoke-copilot workflow is the key workflow to monitor

## Success Criteria

1. `smoke-copilot.lock.yml` uses local build commands instead of curl-based install
2. AWF invocation uses `--build-local` instead of `--image-tag X.Y.Z`
3. CI workflow (smoke-copilot) completes successfully (green)

## Non-Goals

- Transforming ALL workflow files (just smoke-copilot for this test)
- Merging the PR (just getting CI green)

## Implementation

### Files Modified

- `.github/workflows/smoke-copilot.lock.yml` - Transform AWF install to local build

### Transformation Details

The `use-local-awf.sh` script makes these changes:

1. **Install Step**: Replace curl-based installation with:
   ```bash
   cd /tmp
   git clone https://github.com/githubnext/gh-aw-firewall.git
   cd gh-aw-firewall
   npm ci
   npm run build
   sudo npm link
   ```

2. **AWF Invocation**: Replace `--image-tag 0.8.2` with `--build-local`

## Verification

1. After transformation, verify the file contains "local build" in the install step name
2. After commit, check that CI workflow is triggered
3. Monitor `gh pr checks 356` until smoke-copilot shows SUCCESS
4. Verify the workflow log shows AWF being built from source (npm ci, npm run build)
