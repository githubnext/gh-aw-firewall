---
title: Releasing
description: Release process for creating new versions
---

## Prerequisites

- Push access to the repository
- Ability to create and push tags

## Release Steps

### 1. Update Version

Update the version in `package.json`:

```bash
# For a patch release (0.1.0 -> 0.1.1)
npm version patch

# For a minor release (0.1.1 -> 0.2.0)
npm version minor

# For a major release (0.2.0 -> 1.0.0)
npm version major
```

This will:
- Update version in `package.json`
- Create a git commit
- Create a git tag

### 2. Push Changes

```bash
# Push commits and tags
git push origin main --follow-tags
```

### 3. Automated Release

The GitHub Actions workflow (`.github/workflows/release.yml`) will automatically:
- Build the project
- Create binaries with `pkg`
- Generate checksums
- Create GitHub release
- Upload artifacts

### 4. Verify Release

1. Go to [Releases](https://github.com/githubnext/gh-aw-firewall/releases)
2. Verify the new release is created
3. Check that binaries and checksums are attached
4. Review release notes

## Manual Release (if needed)

```bash
# Build the project
npm run build

# Create binary
npx pkg package.json

# Generate checksums
sha256sum awf-linux-x64 > checksums.txt

# Create release on GitHub
gh release create v0.1.0 \
  --title "Release v0.1.0" \
  --notes "Release notes here" \
  awf-linux-x64 \
  checksums.txt
```

## Release Notes Template

The release notes template is in `docs/RELEASE_TEMPLATE.md`.

**Available placeholders:**
- `{{CHANGELOG}}` - Auto-generated changelog
- `{{CLI_HELP}}` - Output of `awf --help`
- `{{VERSION}}` - Version with 'v' prefix (e.g., `v0.3.0`)
- `{{VERSION_NUMBER}}` - Version without 'v' (e.g., `0.3.0`)

## Versioning Guidelines

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR** version: Incompatible API changes
- **MINOR** version: New functionality (backward compatible)
- **PATCH** version: Bug fixes (backward compatible)

**Examples:**
- Add new CLI option: MINOR
- Fix bug in domain parsing: PATCH
- Remove deprecated feature: MAJOR
- Update documentation: PATCH

## Post-Release

1. Announce release in relevant channels
2. Update documentation if needed
3. Close related issues
4. Monitor for issues in the new release
