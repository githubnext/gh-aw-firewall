#!/bin/bash
# ralph-ci-monitor.sh
# General Ralph loop for CI monitoring
#
# Usage: ./scripts/ralph-ci-monitor.sh <iterations>

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <iterations>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for ((i=1; i<=$1; i++)); do
  echo ""
  echo "==========================================="
  echo "Ralph Loop Iteration $i/$1"
  echo "Time: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "==========================================="
  echo ""

  result=$(claude --permission-mode acceptEdits -p "@${SCRIPT_DIR}/ralph-prompt.md \
  1. Find the highest-priority task and implement it. \
  2. Run your tests and type checks. \
  3. Update the PRD with what was done. \
  4. Append your progress to progress.txt. \
  5. Commit your changes. \
  ONLY WORK ON A SINGLE TASK. \
  If the PRD is complete, output <promise>COMPLETE</promise>.")

  echo "$result"

  if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
    echo ""
    echo "==========================================="
    echo "✓ CI is GREEN! Ralph loop complete after $i iterations."
    echo "==========================================="
    exit 0
  fi
done

echo ""
echo "==========================================="
echo "✗ Max iterations ($1) reached without completion"
echo "==========================================="
exit 1
