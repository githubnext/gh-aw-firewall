#!/bin/bash
# ralph-ci-monitor.sh
# Ralph loop to monitor PR CI using Claude
#
# This script repeatedly checks CI status for PR #356 until:
# - All Smoke Copilot jobs pass (outputs <promise>COMPLETE</promise>)
# - Maximum iterations reached
# - A failure is detected and reported
#
# Usage: ./scripts/ralph-ci-monitor.sh [max_iterations] [wait_seconds]
#
# Examples:
#   ./scripts/ralph-ci-monitor.sh        # Default: 30 iterations, 60s wait
#   ./scripts/ralph-ci-monitor.sh 10     # 10 iterations, 60s wait
#   ./scripts/ralph-ci-monitor.sh 10 30  # 10 iterations, 30s wait

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MAX_ITERATIONS=${1:-30}
WAIT_SECONDS=${2:-60}
PR_NUMBER=356
PROMPT_FILE="$SCRIPT_DIR/ralph-prompt.md"

echo "==========================================="
echo "Ralph CI Monitor for PR #$PR_NUMBER"
echo "==========================================="
echo "Max iterations: $MAX_ITERATIONS"
echo "Wait between checks: ${WAIT_SECONDS}s"
echo "Prompt file: $PROMPT_FILE"
echo ""

# Verify prompt file exists
if [[ ! -f "$PROMPT_FILE" ]]; then
    echo "ERROR: Prompt file not found: $PROMPT_FILE"
    exit 1
fi

# Verify claude is available
if ! command -v claude &> /dev/null; then
    echo "ERROR: claude CLI not found. Please install Claude Code."
    exit 1
fi

# Verify gh is available
if ! command -v gh &> /dev/null; then
    echo "ERROR: gh CLI not found. Please install GitHub CLI."
    exit 1
fi

for i in $(seq 1 $MAX_ITERATIONS); do
    echo ""
    echo "==========================================="
    echo "Ralph Loop Iteration $i/$MAX_ITERATIONS"
    echo "Time: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "==========================================="
    echo ""

    # Run Claude with the prompt
    # Using --print to get output and --allowedTools to permit bash commands
    OUTPUT=$(claude --print --allowedTools "Bash(gh:*)" "$(cat "$PROMPT_FILE")" 2>&1) || true

    echo "$OUTPUT"

    # Check for completion marker
    if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then
        echo ""
        echo "==========================================="
        echo "✓ CI is GREEN! Ralph loop complete."
        echo "==========================================="
        exit 0
    fi

    # Check for failure indication (if Claude reports failure details)
    if echo "$OUTPUT" | grep -qi "FAILURE\|failed\|error"; then
        echo ""
        echo "==========================================="
        echo "⚠ CI failure detected. Check output above."
        echo "==========================================="
        # Don't exit - continue monitoring in case it's a transient issue
    fi

    # Wait before next iteration (unless this is the last iteration)
    if [[ $i -lt $MAX_ITERATIONS ]]; then
        echo ""
        echo "Waiting ${WAIT_SECONDS} seconds before next check..."
        sleep "$WAIT_SECONDS"
    fi
done

echo ""
echo "==========================================="
echo "✗ Max iterations ($MAX_ITERATIONS) reached without CI turning green"
echo "==========================================="
exit 1
