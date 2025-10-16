#!/bin/bash
set -e

# Script to download artifacts from GitHub Actions workflow runs
# Usage: ./scripts/download-latest-artifact.sh [RUN_ID] [WORKFLOW_FILE] [ARTIFACT_NAME]
#   RUN_ID: Specific run ID to download from (optional, defaults to latest run)
#   WORKFLOW_FILE: Path to workflow file (optional, defaults to test-copilot-mcp.yml)
#   ARTIFACT_NAME: Name of artifact to download (optional, defaults to copilot-mcp-logs)
#
# Examples:
#   ./scripts/download-latest-artifact.sh
#   ./scripts/download-latest-artifact.sh 1234567890
#   ./scripts/download-latest-artifact.sh "" ".github/workflows/test-copilot-everything-mcp.yml" "copilot-everything-mcp-logs"
#   ./scripts/download-latest-artifact.sh 1234567890 ".github/workflows/test-copilot-playwright-mcp.yml" "copilot-playwright-mcp-logs"

# Default values
DEFAULT_WORKFLOW=".github/workflows/test-copilot-mcp.yml"
DEFAULT_ARTIFACT="copilot-mcp-logs"
DEFAULT_REPO="githubnext/gh-aw-firewall"

# Parse arguments
SPECIFIC_RUN_ID="${1:-}"
WORKFLOW_FILE="${2:-$DEFAULT_WORKFLOW}"
ARTIFACT_NAME="${3:-$DEFAULT_ARTIFACT}"
REPO="${4:-$DEFAULT_REPO}"

echo "=========================================="
echo "Downloading Workflow Artifact"
echo "=========================================="
echo "Repository: $REPO"
echo "Workflow: $WORKFLOW_FILE"
echo "Artifact: $ARTIFACT_NAME"
echo ""

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "Error: GitHub CLI (gh) is not installed."
    echo "Install it from: https://cli.github.com/"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo "Error: Not authenticated with GitHub CLI."
    echo "Run: gh auth login"
    exit 1
fi

# Determine run ID
if [ -n "$SPECIFIC_RUN_ID" ]; then
    echo "Using provided run ID: $SPECIFIC_RUN_ID"
    RUN_ID="$SPECIFIC_RUN_ID"
else
    # Get the latest run ID for this workflow
    echo "Finding latest workflow run..."
    RUN_ID=$(gh run list \
        --repo "$REPO" \
        --workflow "$WORKFLOW_FILE" \
        --limit 1 \
        --json databaseId \
        --jq '.[0].databaseId')

    if [ -z "$RUN_ID" ]; then
        echo "Error: No workflow runs found for $WORKFLOW_FILE"
        exit 1
    fi
    echo "Latest run ID: $RUN_ID"
fi

echo "Run URL: https://github.com/$REPO/actions/runs/$RUN_ID"
echo ""

# Download the artifact
echo "Downloading artifact '$ARTIFACT_NAME'..."
gh run download "$RUN_ID" \
    --repo "$REPO" \
    --name "$ARTIFACT_NAME" \
    --dir "./artifacts-run-$RUN_ID"

if [ $? -eq 0 ]; then
    echo ""
    echo "=========================================="
    echo "✓ Download complete!"
    echo "=========================================="
    echo "Artifact saved to: ./artifacts-run-$RUN_ID"
    echo ""
    echo "Contents:"
    ls -lh "./artifacts-run-$RUN_ID"
else
    echo "Error: Failed to download artifact"
    exit 1
fi
