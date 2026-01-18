#!/bin/bash
set -e

# use-local-awf.sh
# Transforms generated workflow YAML files to use locally built AWF binaries
# instead of released versions from GHCR.
#
# This script is useful for testing AWF changes before releasing, allowing
# workflows to use the local development build.
#
# Usage: ./scripts/use-local-awf.sh [--dry-run] [files...]
#
# Options:
#   --dry-run    Show what would be changed without modifying files
#
# Arguments:
#   files        Specific lock.yml files to transform (default: all .lock.yml in .github/workflows/)
#
# Example:
#   ./scripts/use-local-awf.sh                               # Transform all workflow files
#   ./scripts/use-local-awf.sh --dry-run                     # Preview changes
#   ./scripts/use-local-awf.sh .github/workflows/smoke-claude.lock.yml  # Transform specific file

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DRY_RUN=false
FILES=()

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      FILES+=("$1")
      shift
      ;;
  esac
done

# Default to all .lock.yml files in .github/workflows/
if [[ ${#FILES[@]} -eq 0 ]]; then
  while IFS= read -r -d '' file; do
    FILES+=("$file")
  done < <(find "$REPO_ROOT/.github/workflows" -name "*.lock.yml" -print0 2>/dev/null)
fi

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No .lock.yml files found to transform."
  exit 0
fi

echo "==========================================="
echo "Transforming workflows to use local AWF"
echo "==========================================="
echo "Mode: $([ "$DRY_RUN" = true ] && echo "DRY RUN" || echo "MODIFY")"
echo "Files to process: ${#FILES[@]}"
echo ""

# The new install step that builds and links locally
# This replaces the curl-based installation
NEW_INSTALL_STEP='      - name: Install awf binary (local build)
        run: |
          echo "Building and installing AWF locally..."
          cd /tmp
          if [ -d "gh-aw-firewall" ]; then
            cd gh-aw-firewall
            git pull
          else
            git clone https://github.com/githubnext/gh-aw-firewall.git
            cd gh-aw-firewall
          fi
          npm ci
          npm run build
          sudo npm link
          which awf
          awf --version'

MODIFIED_COUNT=0
SKIPPED_COUNT=0

for file in "${FILES[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "SKIP: $file (not found)"
    ((SKIPPED_COUNT++))
    continue
  fi

  FILENAME=$(basename "$file")
  MODIFIED=false

  # Check if file has AWF install step that uses curl
  if grep -q 'curl.*install\.sh.*AWF_VERSION' "$file"; then
    echo "Processing: $FILENAME"

    if [[ "$DRY_RUN" = true ]]; then
      echo "  Would replace: curl-based AWF install -> local build"
    else
      # Create a temporary file
      TEMP_FILE=$(mktemp)

      # Use awk to replace the entire install step block
      # The step starts with "- name: Install awf binary" and ends before the next "- name:" or at a dedent
      awk '
        BEGIN { in_install_step = 0; skip_until_next_step = 0 }

        # Detect start of Install awf binary step
        /^[[:space:]]*- name: Install awf binary[[:space:]]*$/ {
          in_install_step = 1
          skip_until_next_step = 1
          # Print the replacement step
          print "      - name: Install awf binary (local build)"
          print "        run: |"
          print "          echo \"Building and installing AWF locally...\""
          print "          cd /tmp"
          print "          if [ -d \"gh-aw-firewall\" ]; then"
          print "            cd gh-aw-firewall"
          print "            git pull"
          print "          else"
          print "            git clone https://github.com/githubnext/gh-aw-firewall.git"
          print "            cd gh-aw-firewall"
          print "          fi"
          print "          npm ci"
          print "          npm run build"
          print "          sudo npm link"
          print "          which awf"
          print "          awf --version"
          next
        }

        # If we are skipping lines until next step
        skip_until_next_step == 1 {
          # Check if this is the start of a new step (another "- name:")
          if (/^[[:space:]]*- name:/ && !/Install awf binary/) {
            skip_until_next_step = 0
            in_install_step = 0
            print
            next
          }
          # Skip this line (part of the old install step)
          next
        }

        # Print all other lines
        { print }
      ' "$file" > "$TEMP_FILE"

      mv "$TEMP_FILE" "$file"
      MODIFIED=true
      echo "  ✓ Replaced AWF install step with local build"
    fi
  fi

  # Replace --image-tag X.Y.Z with --build-local
  if grep -q '\-\-image-tag [0-9]' "$file"; then
    if [[ "$DRY_RUN" = true ]]; then
      echo "  Would replace: --image-tag <version> -> --build-local"
    else
      # Replace --image-tag followed by version number with --build-local
      sed -i -E 's/--image-tag [0-9]+\.[0-9]+\.[0-9]+/--build-local/g' "$file"
      MODIFIED=true
      echo "  ✓ Replaced --image-tag with --build-local"
    fi
  fi

  if [[ "$MODIFIED" = true ]]; then
    ((MODIFIED_COUNT++))
  elif [[ "$DRY_RUN" = false ]] && ! grep -q 'Install awf binary' "$file"; then
    echo "SKIP: $FILENAME (no AWF install step found)"
    ((SKIPPED_COUNT++))
  fi
done

echo ""
echo "==========================================="
echo "Summary"
echo "==========================================="
echo "Files modified: $MODIFIED_COUNT"
echo "Files skipped:  $SKIPPED_COUNT"

if [[ "$DRY_RUN" = true ]]; then
  echo ""
  echo "This was a dry run. No files were modified."
  echo "Remove --dry-run to apply changes."
fi

echo "==========================================="
