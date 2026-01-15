---
name: Release
description: Build, test, and release AWF extension, then generate and prepend release highlights
on:
  push:
    tags:
      - 'v*.*.*'
  workflow_dispatch:
    inputs:
      dry_run:
        description: 'Dry run mode - builds artifacts but skips pushing images and creating releases'
        required: false
        default: 'false'
        type: boolean
permissions:
  contents: read
  pull-requests: read
  actions: read
  issues: read
roles:
  - admin
  - maintainer
timeout-minutes: 30
tools:
  bash:
    - "*"
  github:
    toolsets: [default]
safe-outputs:
  update-release:
jobs:
  release:
    needs: ["activation"]
    runs-on: ubuntu-latest
    permissions:
      contents: write
      packages: write
      id-token: write
    outputs:
      release_tag: ${{ steps.version_early.outputs.version }}
      release_id: ${{ steps.create_release.outputs.id }}
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build TypeScript
        run: npm run build

      - name: Extract version from tag
        id: version_early
        run: |
          if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
            VERSION=$(node -p "require('./package.json').version")
            echo "version=v$VERSION" >> $GITHUB_OUTPUT
            echo "version_number=$VERSION" >> $GITHUB_OUTPUT
          else
            VERSION="${GITHUB_REF#refs/tags/}"
            VERSION_NUMBER="${VERSION#v}"
            echo "version=$VERSION" >> $GITHUB_OUTPUT
            echo "version_number=$VERSION_NUMBER" >> $GITHUB_OUTPUT
          fi

      - name: Validate version matches tag
        run: |
          TAG_VERSION="${{ steps.version_early.outputs.version_number }}"
          PKG_VERSION=$(node -p "require('./package.json').version")

          if [ "$TAG_VERSION" != "$PKG_VERSION" ]; then
            echo "❌ ERROR: Version mismatch detected!"
            echo "  Tag version:        $TAG_VERSION"
            echo "  package.json version: $PKG_VERSION"
            echo ""
            echo "This usually happens when:"
            echo "  1. The tag was created before updating package.json"
            echo "  2. The wrong commit was tagged"
            echo ""
            echo "To fix this:"
            echo "  1. Update package.json version to match the tag"
            echo "  2. Commit the change"
            echo "  3. Move the tag: git tag -f ${{ steps.version_early.outputs.version }} && git push -f origin ${{ steps.version_early.outputs.version }}"
            exit 1
          fi

          echo "✅ Version validation passed: $TAG_VERSION"

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Install cosign
        uses: sigstore/cosign-installer@59acb6260d9c0ba8f4a2f9d9b48431a222b68e20 # v3.5.0

      - name: Build and push Squid image
        id: build_squid
        uses: docker/build-push-action@v5
        with:
          context: ./containers/squid
          push: ${{ github.event.inputs.dry_run != 'true' }}
          tags: |
            ghcr.io/${{ github.repository }}/squid:${{ steps.version_early.outputs.version_number }}
            ghcr.io/${{ github.repository }}/squid:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Sign Squid image with cosign
        if: ${{ github.event.inputs.dry_run != 'true' }}
        run: |
          cosign sign --yes \
            ghcr.io/${{ github.repository }}/squid@${{ steps.build_squid.outputs.digest }}

      - name: Generate SBOM for Squid image
        if: ${{ github.event.inputs.dry_run != 'true' }}
        uses: anchore/sbom-action@d94f46e13c6c62f59525ac9a1e147a99dc0b9bf5 # v0.17.0
        with:
          image: ghcr.io/${{ github.repository }}/squid@${{ steps.build_squid.outputs.digest }}
          format: spdx-json
          output-file: squid-sbom.spdx.json

      - name: Attest SBOM for Squid image
        if: ${{ github.event.inputs.dry_run != 'true' }}
        run: |
          cosign attest --yes \
            --predicate squid-sbom.spdx.json \
            --type spdxjson \
            ghcr.io/${{ github.repository }}/squid@${{ steps.build_squid.outputs.digest }}

      - name: Build and push Agent image
        id: build_agent
        uses: docker/build-push-action@v5
        with:
          context: ./containers/agent
          push: ${{ github.event.inputs.dry_run != 'true' }}
          tags: |
            ghcr.io/${{ github.repository }}/agent:${{ steps.version_early.outputs.version_number }}
            ghcr.io/${{ github.repository }}/agent:latest
          no-cache: true

      - name: Sign Agent image with cosign
        if: ${{ github.event.inputs.dry_run != 'true' }}
        run: |
          cosign sign --yes \
            ghcr.io/${{ github.repository }}/agent@${{ steps.build_agent.outputs.digest }}

      - name: Generate SBOM for Agent image
        if: ${{ github.event.inputs.dry_run != 'true' }}
        uses: anchore/sbom-action@d94f46e13c6c62f59525ac9a1e147a99dc0b9bf5 # v0.17.0
        with:
          image: ghcr.io/${{ github.repository }}/agent@${{ steps.build_agent.outputs.digest }}
          format: spdx-json
          output-file: agent-sbom.spdx.json

      - name: Attest SBOM for Agent image
        if: ${{ github.event.inputs.dry_run != 'true' }}
        run: |
          cosign attest --yes \
            --predicate agent-sbom.spdx.json \
            --type spdxjson \
            ghcr.io/${{ github.repository }}/agent@${{ steps.build_agent.outputs.digest }}

      - name: Install pkg for binary creation
        run: npm install -g pkg

      - name: Create binaries
        run: |
          mkdir -p release

          # Create standalone executable for Linux
          pkg . \
            --targets node18-linux-x64 \
            --output release/awf-linux-x64

          # Verify the binary was created
          echo "=== Contents of release directory ==="
          ls -lh release/
          echo "=== Verifying binary ==="
          test -f release/awf-linux-x64 && echo "✓ Binary exists at release/awf-linux-x64" || echo "✗ Binary NOT found!"
          file release/awf-linux-x64

      - name: Smoke test binary
        run: |
          npx tsx scripts/ci/smoke-test-binary.ts \
            release/awf-linux-x64 \
            ${{ steps.version_early.outputs.version_number }}

      - name: Create tarball for npm package
        run: |
          npm pack
          mv *.tgz release/awf.tgz

      - name: Generate checksums
        run: |
          cd release
          sha256sum * > checksums.txt

      - name: Get previous release tag
        id: previous_tag
        run: |
          set -euo pipefail
          CURRENT_TAG="${{ steps.version_early.outputs.version }}"
          PREVIOUS_TAG=$(git tag --sort=-version:refname | grep -v "^${CURRENT_TAG}$" | head -n1 || echo "")
          echo "previous_tag=$PREVIOUS_TAG" >> $GITHUB_OUTPUT
          echo "Previous tag: $PREVIOUS_TAG (current: $CURRENT_TAG)"

      - name: Generate changelog from commits
        id: changelog
        run: |
          set -euo pipefail
          CURRENT_TAG="${{ steps.version_early.outputs.version }}"
          PREVIOUS_TAG="${{ steps.previous_tag.outputs.previous_tag }}"

          echo "Generating changelog from $PREVIOUS_TAG to $CURRENT_TAG"

          if [ -n "$PREVIOUS_TAG" ]; then
            CHANGELOG=$(gh api repos/${{ github.repository }}/releases/generate-notes \
              -f tag_name="$CURRENT_TAG" \
              -f previous_tag_name="$PREVIOUS_TAG" \
              --jq '.body' 2>/dev/null || echo "")
          else
            CHANGELOG=$(gh api repos/${{ github.repository }}/releases/generate-notes \
              -f tag_name="$CURRENT_TAG" \
              --jq '.body' 2>/dev/null || echo "")
          fi

          if [ -z "$CHANGELOG" ]; then
            echo "GitHub API failed, falling back to git log"
            if [ -n "$PREVIOUS_TAG" ]; then
              CHANGELOG=$(git log --oneline --pretty=format:"* %s (%h)" "$PREVIOUS_TAG..HEAD" 2>/dev/null || echo "* Initial release")
            else
              CHANGELOG=$(git log --oneline --pretty=format:"* %s (%h)" 2>/dev/null || echo "* Initial release")
            fi
          fi

          echo "$CHANGELOG" > changelog_body.md

          if [ ! -s changelog_body.md ]; then
            echo "Error: Changelog generation failed or produced empty output"
            exit 1
          fi

          echo "Changelog generated successfully ($(wc -l < changelog_body.md) lines)"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Generate CLI help output
        id: cli_help
        run: |
          set -euo pipefail
          node dist/cli.js --help > cli_help.txt

          if [ ! -s cli_help.txt ]; then
            echo "Error: CLI help generation failed or produced empty output"
            exit 1
          fi

          echo "CLI help generated ($(wc -l < cli_help.txt) lines):"
          cat cli_help.txt

      - name: Create Release Notes
        id: release_notes
        env:
          VERSION: ${{ steps.version_early.outputs.version }}
          VERSION_NUMBER: ${{ steps.version_early.outputs.version_number }}
          REPOSITORY: ${{ github.repository }}
        run: |
          set -euo pipefail
          node scripts/generate-release-notes.js \
            changelog_body.md \
            cli_help.txt \
            release_notes.md

          if [ ! -s release_notes.md ]; then
            echo "Error: Release notes generation failed"
            exit 1
          fi

          rm -f changelog_body.md cli_help.txt
          echo "Release notes preview (first 20 lines):"
          head -20 release_notes.md

      - name: Preview release notes (dry run)
        if: ${{ github.event.inputs.dry_run == 'true' }}
        run: |
          echo "=== DRY RUN: Release notes that would be published ==="
          cat release_notes.md
          echo ""
          echo "=== DRY RUN: Skipping actual release creation ==="

      - name: Create GitHub Release
        id: create_release
        if: ${{ github.event.inputs.dry_run != 'true' }}
        uses: softprops/action-gh-release@v1
        with:
          tag_name: ${{ steps.version_early.outputs.version }}
          name: Release ${{ steps.version_early.outputs.version }}
          body_path: release_notes.md
          draft: false
          prerelease: ${{ contains(steps.version_early.outputs.version, 'alpha') || contains(steps.version_early.outputs.version, 'beta') || contains(steps.version_early.outputs.version, 'rc') }}
          files: |
            release/awf-linux-x64
            release/awf.tgz
            release/checksums.txt
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Upload artifacts (for debugging)
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: release-artifacts
          path: release/
          retention-days: 7
steps:
  - name: Check dry run mode
    run: |
      if [ "${{ github.event.inputs.dry_run }}" = "true" ]; then
        echo "=== DRY RUN MODE ==="
        echo "Skipping AI agent - no release to update in dry run mode"
        echo "The release job has already previewed what would be created."
        exit 0
      fi
  - name: Setup environment and fetch release data
    if: ${{ github.event.inputs.dry_run != 'true' }}
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    run: |
      set -e
      mkdir -p /tmp/gh-aw/release-data
      
      # Get the release tag from the push event
      if [[ "$GITHUB_REF" == refs/tags/* ]]; then
        RELEASE_TAG="${GITHUB_REF#refs/tags/}"
      else
        # For workflow_dispatch, get from package.json
        RELEASE_TAG="v$(node -p "require('./package.json').version")"
      fi
      echo "Processing release: $RELEASE_TAG"
      echo "RELEASE_TAG=$RELEASE_TAG" >> "$GITHUB_ENV"
      
      # Get the current release information
      gh release view "$RELEASE_TAG" --json name,tagName,createdAt,publishedAt,url,body > /tmp/gh-aw/release-data/current_release.json
      echo "✓ Fetched current release information"
      
      # Get the previous release to determine the range
      PREV_RELEASE_TAG=$(gh release list --limit 2 --json tagName --jq '.[1].tagName // empty')
      
      if [ -z "$PREV_RELEASE_TAG" ]; then
        echo "No previous release found. This appears to be the first release."
        echo "PREV_RELEASE_TAG=" >> "$GITHUB_ENV"
        echo "[]" > /tmp/gh-aw/release-data/pull_requests.json
      else
        echo "Previous release: $PREV_RELEASE_TAG"
        echo "PREV_RELEASE_TAG=$PREV_RELEASE_TAG" >> "$GITHUB_ENV"
        
        # Get all merged PRs between the two releases
        echo "Fetching pull requests merged between releases..."
        PREV_PUBLISHED_AT=$(gh release view "$PREV_RELEASE_TAG" --json publishedAt --jq .publishedAt)
        CURR_PUBLISHED_AT=$(gh release view "$RELEASE_TAG" --json publishedAt --jq .publishedAt)
        gh pr list \
          --state merged \
          --limit 1000 \
          --json number,title,author,labels,mergedAt,url,body \
          --jq "[.[] | select(.mergedAt >= \"$PREV_PUBLISHED_AT\" and .mergedAt <= \"$CURR_PUBLISHED_AT\")]" \
          > /tmp/gh-aw/release-data/pull_requests.json
        
        PR_COUNT=$(jq length "/tmp/gh-aw/release-data/pull_requests.json")
        echo "✓ Fetched $PR_COUNT pull requests"
      fi
      
      # Get the CHANGELOG.md content if it exists
      if [ -f "CHANGELOG.md" ]; then
        cp CHANGELOG.md /tmp/gh-aw/release-data/CHANGELOG.md
        echo "✓ Copied CHANGELOG.md for reference"
      fi
      
      # Get README for project context
      if [ -f "README.md" ]; then
        cp README.md /tmp/gh-aw/release-data/README.md
        echo "✓ Copied README.md for context"
      fi
      
      echo "✓ Setup complete. Data available in /tmp/gh-aw/release-data/"
---

# Release Highlights Generator

Generate an engaging release highlights summary for **${{ github.repository }}** release `${RELEASE_TAG}`.

## Data Available

All data is pre-fetched in `/tmp/gh-aw/release-data/`:
- `current_release.json` - Release metadata (tag, name, dates, existing body)
- `pull_requests.json` - PRs merged between `${PREV_RELEASE_TAG}` and `${RELEASE_TAG}` (empty array if first release)
- `CHANGELOG.md` - Full changelog for context (if exists)
- `README.md` - Project overview for context

## Output Requirements

Create a **"🚀 Release Highlights"** section that:
- Is concise and scannable (users grasp key changes in 30 seconds)
- Uses professional, enthusiastic tone (not overly casual)
- Categorizes changes logically (features, fixes, security, breaking changes)
- Focuses on user impact (why changes matter, not just what changed)

## Workflow

### 1. Load Data

```bash
# View release metadata
cat /tmp/gh-aw/release-data/current_release.json | jq

# List PRs (empty if first release)
cat /tmp/gh-aw/release-data/pull_requests.json | jq -r '.[] | "- #\(.number): \(.title) by @\(.author.login)"'

# Check CHANGELOG context
head -100 /tmp/gh-aw/release-data/CHANGELOG.md 2>/dev/null || echo "No CHANGELOG"
```

### 2. Categorize & Prioritize

Group PRs by category (omit categories with no items):
- **⚠️ Breaking Changes** - Requires user action (ALWAYS list first if present)
- **✨ New Features** - User-facing capabilities
- **🔒 Security** - Security improvements
- **🐛 Bug Fixes** - Issue resolutions
- **⚡ Performance** - Speed/efficiency improvements
- **📚 Documentation** - Guide/reference updates

### 3. Write Highlights

Structure:
```markdown
## 🚀 Release Highlights

[1-2 sentence summary of the release theme/focus]

### ⚠️ Breaking Changes
[If any - list FIRST with migration guidance]

### ✨ What's New
[Top 3-5 features with user benefit]

### 🔒 Security Improvements
[Notable security fixes - focus on user impact]

### 🐛 Bug Fixes & Improvements
[Notable fixes - focus on user impact]

---
```

**Writing Guidelines:**
- Lead with benefits: "Container isolation now drops NET_ADMIN capability" not "Added capability dropping"
- Be specific: "Reduced build times by 40%" not "Faster builds"
- Skip internal changes unless they have user impact
- Keep breaking changes prominent with action items
- Use emojis appropriately to make it scannable

### 4. Handle Special Cases

**First Release** (no `${PREV_RELEASE_TAG}`):
```markdown
## 🎉 First Release

Welcome to the inaugural release of AWF (Agent Workflow Firewall)!

### Key Features
[List primary features with brief descriptions]
```

**Maintenance Release** (no user-facing changes):
```markdown
## 🔧 Maintenance Release

Dependency updates and internal improvements to keep things running smoothly.
```

## Output Format

**CRITICAL**: You MUST call the `update_release` tool to update the release with the generated highlights:

```javascript
update_release({
  tag: "${RELEASE_TAG}",
  operation: "prepend",
  body: "## 🚀 Release Highlights\n\n[Your complete markdown highlights here]"
})
```

**Required Parameters:**
- `tag` - Release tag from `${RELEASE_TAG}` environment variable
- `operation` - Must be `"prepend"` to add before existing notes
- `body` - Complete markdown content (include all formatting, emojis)

**WARNING**: If you don't call the `update_release` tool, the release notes will NOT be updated!
