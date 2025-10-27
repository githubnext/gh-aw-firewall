#!/bin/bash
# Integration test for bash escaping issue (gh-aw PR #2493)
# Tests that AWF properly handles parentheses in Copilot CLI tool names

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "==========================================="
echo "Bash Escaping Integration Tests"
echo "Testing fix for gh-aw PR #2493"
echo "==========================================="

# Ensure we're using the local awf build
cd "$PROJECT_ROOT"
if [ ! -f "dist/cli.js" ]; then
    echo "Building awf..."
    npm run build
fi

# Export minimal environment for Copilot (even though we won't actually run it fully)
export GITHUB_TOKEN="${GITHUB_TOKEN:-dummy-token-for-testing}"

# Test 1: Reproduce the exact failure from PR #2493
echo ""
echo "Test 1: Reproduce bash syntax error with parentheses in tool names"
echo "-------------------------------------------------------------------"
echo "Running: awf with --allow-tool 'shell(cat)', 'shell(date)', 'shell(echo)'"
echo ""

# This command should fail with the current code (bash syntax error)
# After the fix, it should either succeed or fail with a different error (not bash syntax)
set +e
sudo -E node "$PROJECT_ROOT/dist/cli.js" \
  --log-level debug \
  --allow-domains github.com,api.github.com,registry.npmjs.org,api.enterprise.githubcopilot.com \
  "npx @github/copilot@0.0.351 --allow-tool 'shell(cat)' --allow-tool 'shell(date)' --allow-tool 'shell(echo)' --help" \
  2>&1 | tee /tmp/awf-test-1.log

EXIT_CODE=$?
set -e

echo ""
echo "Exit code: $EXIT_CODE"

# Check for bash syntax error (the bug we're trying to fix)
if grep -q "syntax error near unexpected token" /tmp/awf-test-1.log; then
    echo "❌ FAILED: Bash syntax error detected (bug not fixed)"
    echo "   This is expected BEFORE the fix is applied"
    BASH_SYNTAX_ERROR=1
else
    echo "✅ PASSED: No bash syntax error detected"
    BASH_SYNTAX_ERROR=0
fi

# Check for Copilot validation error (what we might see with incorrect escaping)
if grep -q "Invalid rule format.*shell\\\\(cat\\\\)" /tmp/awf-test-1.log; then
    echo "❌ FAILED: Copilot validation error (incorrect escaping)"
    echo "   Copilot received escaped format instead of clean format"
    VALIDATION_ERROR=1
else
    echo "✅ PASSED: No Copilot validation error detected"
    VALIDATION_ERROR=0
fi

# Test 2: Verify with simple echo command (should always work)
echo ""
echo "Test 2: Baseline test with simple command (no special chars)"
echo "-------------------------------------------------------------------"
echo "Running: awf with simple echo command"
echo ""

set +e
sudo -E node "$PROJECT_ROOT/dist/cli.js" \
  --log-level debug \
  --allow-domains github.com \
  "echo 'Hello World'" \
  2>&1 | tee /tmp/awf-test-2.log

EXIT_CODE_2=$?
set -e

echo ""
echo "Exit code: $EXIT_CODE_2"

if [ $EXIT_CODE_2 -eq 0 ]; then
    echo "✅ PASSED: Simple command executed successfully"
    SIMPLE_TEST=0
else
    echo "❌ FAILED: Simple command failed (baseline broken)"
    SIMPLE_TEST=1
fi

# Test 3: Test with dollar signs (existing functionality)
echo ""
echo "Test 3: Test dollar sign escaping for Docker Compose"
echo "-------------------------------------------------------------------"
echo "Running: awf with command containing dollar sign"
echo ""

set +e
sudo -E node "$PROJECT_ROOT/dist/cli.js" \
  --log-level debug \
  --allow-domains github.com \
  'echo "Testing dollar sign: $HOME"' \
  2>&1 | tee /tmp/awf-test-3.log

EXIT_CODE_3=$?
set -e

echo ""
echo "Exit code: $EXIT_CODE_3"

if [ $EXIT_CODE_3 -eq 0 ] && grep -q "Testing dollar sign:" /tmp/awf-test-3.log; then
    echo "✅ PASSED: Dollar sign handled correctly"
    DOLLAR_TEST=0
else
    echo "❌ FAILED: Dollar sign escaping broken"
    DOLLAR_TEST=1
fi

# Summary
echo ""
echo "==========================================="
echo "Test Summary"
echo "==========================================="
echo "Test 1 (Parentheses): Bash syntax error=$BASH_SYNTAX_ERROR, Validation error=$VALIDATION_ERROR"
echo "Test 2 (Simple command): Exit code=$SIMPLE_TEST"
echo "Test 3 (Dollar signs): Exit code=$DOLLAR_TEST"
echo ""

# Determine overall status
if [ $BASH_SYNTAX_ERROR -eq 1 ]; then
    echo "⚠️  ISSUE REPRODUCED: Bash syntax error with parentheses"
    echo "   This confirms the bug exists. Apply the fix and re-run this test."
    exit 1
elif [ $VALIDATION_ERROR -eq 1 ]; then
    echo "⚠️  INCORRECT FIX: Copilot validation error"
    echo "   The escaping is too aggressive. Copilot should receive 'shell(cat)' not 'shell\\(cat\\)'"
    exit 1
elif [ $SIMPLE_TEST -ne 0 ] || [ $DOLLAR_TEST -ne 0 ]; then
    echo "❌ REGRESSION: Basic functionality broken"
    exit 1
else
    echo "✅ ALL TESTS PASSED"
    echo "   Bash escaping is working correctly!"
    exit 0
fi
