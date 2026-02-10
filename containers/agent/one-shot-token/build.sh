#!/bin/bash
# Build the one-shot-token LD_PRELOAD library
# This script compiles the shared library for x86_64 Ubuntu

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_FILE="${SCRIPT_DIR}/one-shot-token.c"
OUTPUT_FILE="${SCRIPT_DIR}/one-shot-token.so"

echo "[build] Compiling one-shot-token.so..."

# Compile as a shared library with position-independent code
# -shared: create a shared library
# -fPIC: position-independent code (required for shared libs)
# -ldl: link with libdl for dlsym
# -lpthread: link with pthread for mutex
# -O2: optimize for performance
# -Wall -Wextra: enable warnings
gcc -shared -fPIC \
    -O2 -Wall -Wextra \
    -o "${OUTPUT_FILE}" \
    "${SOURCE_FILE}" \
    -ldl -lpthread

echo "[build] Successfully built: ${OUTPUT_FILE}"

# Verify it's a valid shared library
if file "${OUTPUT_FILE}" | grep -q "shared object"; then
    echo "[build] Verified: valid shared object"
else
    echo "[build] ERROR: Output is not a valid shared object"
    exit 1
fi
