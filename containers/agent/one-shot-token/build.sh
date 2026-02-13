#!/bin/bash
# Build the one-shot-token LD_PRELOAD library
# This script compiles the Rust shared library

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LINK_FILE="${SCRIPT_DIR}/one-shot-token.so"

echo "[build] Building one-shot-token with Cargo..."

cd "${SCRIPT_DIR}"

# Build the release version
cargo build --release

# Determine the output file based on platform
if [[ "$(uname)" == "Darwin" ]]; then
    OUTPUT_FILE="${SCRIPT_DIR}/target/release/libone_shot_token.dylib"
    echo "[build] Successfully built: ${OUTPUT_FILE} (macOS)"
else
    OUTPUT_FILE="${SCRIPT_DIR}/target/release/libone_shot_token.so"
    echo "[build] Successfully built: ${OUTPUT_FILE}"

    # Create symlink for backwards compatibility (Linux only)
    if [[ -L "${LINK_FILE}" ]]; then
        rm "${LINK_FILE}"
    fi
    ln -sf "target/release/libone_shot_token.so" "${LINK_FILE}"
    echo "[build] Created symlink: ${LINK_FILE} -> target/release/libone_shot_token.so"
fi

# Verify it's a valid shared library
if file "${OUTPUT_FILE}" | grep -qE "shared object|dynamically linked"; then
    echo "[build] Verified: valid shared library"
else
    echo "[build] ERROR: Output is not a valid shared library"
    exit 1
fi
