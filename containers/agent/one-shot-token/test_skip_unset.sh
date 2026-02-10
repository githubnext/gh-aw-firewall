#!/bin/bash

# Test skip-unset mode
export GITHUB_TOKEN="test-token-12345"
export AWF_ONE_SHOT_SKIP_UNSET="1"

echo "=== Testing skip-unset mode ==="
LD_PRELOAD=./one-shot-token.so bash -c '
  echo "First read: $(printenv GITHUB_TOKEN)"
  echo "Second read: $(printenv GITHUB_TOKEN)"
  echo "Third read: $(printenv GITHUB_TOKEN)"
'

echo ""
echo "=== Testing normal mode (without skip-unset) ==="
unset AWF_ONE_SHOT_SKIP_UNSET
export GITHUB_TOKEN="test-token-67890"

LD_PRELOAD=./one-shot-token.so bash -c '
  echo "First read: $(printenv GITHUB_TOKEN)"
  echo "Second read: $(printenv GITHUB_TOKEN)"
'
