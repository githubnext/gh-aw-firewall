#!/bin/bash
# ralph-ci-monitor.sh
# General Ralph loop for iterative task execution
#
# Usage: ./scripts/ralph-ci-monitor.sh <iterations> <prd_file> [progress_file]
#
# Examples:
#   ./scripts/ralph-ci-monitor.sh 10 scripts/prd.md
#   ./scripts/ralph-ci-monitor.sh 10 scripts/prd.md scripts/progress.txt

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: $0 <iterations> <prd_file> [progress_file]"
  echo ""
  echo "Arguments:"
  echo "  iterations    Number of loop iterations"
  echo "  prd_file      Path to PRD markdown file"
  echo "  progress_file Path to progress file (default: progress.txt in same dir as PRD)"
  exit 1
fi

ITERATIONS=$1
PRD_FILE=$2
PROGRESS_FILE=${3:-"$(dirname "$PRD_FILE")/progress.txt"}

# Create progress file if it doesn't exist
touch "$PROGRESS_FILE"

echo "==========================================="
echo "Ralph Loop"
echo "==========================================="
echo "Iterations: $ITERATIONS"
echo "PRD: $PRD_FILE"
echo "Progress: $PROGRESS_FILE"
echo "==========================================="

for ((i=1; i<=$ITERATIONS; i++)); do
  echo ""
  echo "==========================================="
  echo "Ralph Loop Iteration $i/$ITERATIONS"
  echo "Time: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "==========================================="
  echo ""

  result=$(claude --permission-mode acceptEdits -p "@${PRD_FILE} @${PROGRESS_FILE} \
  1. Find the highest-priority task and implement it. \
  2. Run your tests and type checks. \
  3. Update the PRD with what was done. \
  4. Append your progress to ${PROGRESS_FILE}. \
  5. Commit your changes. \
  ONLY WORK ON A SINGLE TASK. \
  If the PRD is complete, output <promise>COMPLETE</promise>.")

  echo "$result"

  if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
    echo ""
    echo "==========================================="
    echo "✓ PRD complete after $i iterations."
    echo "==========================================="
    exit 0
  fi
done

echo ""
echo "==========================================="
echo "✗ Max iterations ($ITERATIONS) reached without completion"
echo "==========================================="
exit 1
