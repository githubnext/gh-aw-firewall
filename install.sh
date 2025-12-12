#!/bin/bash
set -e

# Install script for awf (Agentic Workflow Firewall)
# 
# This script downloads, verifies, and installs the awf binary with SHA256 validation
# to protect against corrupted or tampered downloads.
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/githubnext/gh-aw-firewall/main/install.sh | sudo bash
#
# Security features:
#   - Uses curl -f to fail on HTTP errors (404, 403, etc.)
#   - Verifies SHA256 checksum from official checksums.txt
#   - Validates downloaded file is a valid ELF executable
#   - Detects HTML error pages that may slip through
#
# Requirements:
#   - curl
#   - sha256sum
#   - file
#   - sudo/root access
#
# Repository: https://github.com/githubnext/gh-aw-firewall
# Issue #107: https://github.com/githubnext/gh-aw-firewall/issues/107

REPO="githubnext/gh-aw-firewall"
BINARY_NAME="awf-linux-x64"
INSTALL_DIR="/usr/local/bin"
INSTALL_NAME="awf"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Check if running as root
check_sudo() {
    if [ "$EUID" -ne 0 ]; then 
        error "This script must be run with sudo or as root"
        exit 1
    fi
}

# Check required commands
check_requirements() {
    local missing=()
    
    for cmd in curl sha256sum file; do
        if ! command -v "$cmd" &> /dev/null; then
            missing+=("$cmd")
        fi
    done
    
    if [ ${#missing[@]} -ne 0 ]; then
        error "Missing required commands: ${missing[*]}"
        error "Please install them and try again"
        exit 1
    fi
}

# Get latest release version
get_latest_version() {
    info "Fetching latest release version..."
    
    # Try GitHub API with -f to fail on HTTP errors
    VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
    
    if [ -z "$VERSION" ]; then
        error "Failed to fetch latest version from GitHub API"
        error "Please check your internet connection and try again"
        exit 1
    fi
    
    info "Latest version: $VERSION"
}

# Download file
download_file() {
    local url="$1"
    local output="$2"
    
    info "Downloading from $url..."
    
    # Use -f to fail on HTTP errors (like 404)
    if ! curl -fsSL "$url" -o "$output"; then
        error "Failed to download $url"
        error "Please check if the release exists and try again"
        exit 1
    fi
    
    # Check if file is not empty
    if [ ! -s "$output" ]; then
        error "Downloaded file is empty"
        rm -f "$output"
        exit 1
    fi
    
    # Check if file is HTML (common for 404 pages)
    if file "$output" | grep -q "HTML"; then
        error "Downloaded file appears to be an HTML page (possibly 404)"
        error "Please check if the release exists: https://github.com/${REPO}/releases"
        rm -f "$output"
        exit 1
    fi
}

# Verify checksum
verify_checksum() {
    local file="$1"
    local checksums_file="$2"
    
    info "Verifying SHA256 checksum..."
    
    # Extract the checksum for our binary from checksums.txt
    # Format: "checksum  filename" (two spaces) - use exact filename match at end of line
    local expected_sum=$(awk -v fname="$BINARY_NAME" '$2 == fname {print $1; exit}' "$checksums_file")
    
    if [ -z "$expected_sum" ]; then
        error "Could not find checksum for $BINARY_NAME in checksums.txt"
        exit 1
    fi
    
    # Validate checksum format (64 hex characters)
    if ! echo "$expected_sum" | grep -qE '^[a-f0-9]{64}$'; then
        error "Invalid checksum format: $expected_sum"
        exit 1
    fi
    
    # Calculate actual checksum
    local actual_sum=$(sha256sum "$file" | awk '{print $1}')
    
    if [ "$expected_sum" != "$actual_sum" ]; then
        error "Checksum verification failed!"
        error "Expected: $expected_sum"
        error "Got:      $actual_sum"
        error "The downloaded file may be corrupted or tampered with"
        exit 1
    fi
    
    info "Checksum verification passed ✓"
}

# Main installation function
main() {
    info "Starting awf installation..."
    
    # Check requirements
    check_sudo
    check_requirements
    
    # Get version
    get_latest_version
    
    # Create temp directory with safety checks
    TEMP_DIR=$(mktemp -d)
    
    # Validate temp directory was created and is safe
    if [ -z "$TEMP_DIR" ] || [ ! -d "$TEMP_DIR" ]; then
        error "Failed to create temporary directory"
        exit 1
    fi
    
    # Ensure it's actually in /tmp for safety
    case "$TEMP_DIR" in
        /tmp/*) ;; # OK
        *)
            error "Temporary directory is not in /tmp (got: $TEMP_DIR)"
            rm -rf "$TEMP_DIR" 2>/dev/null || true
            exit 1
            ;;
    esac
    
    # Set up cleanup trap
    trap "rm -rf '$TEMP_DIR'" EXIT
    
    # Download URLs
    BASE_URL="https://github.com/${REPO}/releases/download/${VERSION}"
    BINARY_URL="${BASE_URL}/${BINARY_NAME}"
    CHECKSUMS_URL="${BASE_URL}/checksums.txt"
    
    # Download binary and checksums
    download_file "$BINARY_URL" "$TEMP_DIR/$BINARY_NAME"
    download_file "$CHECKSUMS_URL" "$TEMP_DIR/checksums.txt"
    
    # Verify checksum
    verify_checksum "$TEMP_DIR/$BINARY_NAME" "$TEMP_DIR/checksums.txt"
    
    # Make binary executable
    chmod +x "$TEMP_DIR/$BINARY_NAME"
    
    # Test if it's a valid ELF executable
    if ! file "$TEMP_DIR/$BINARY_NAME" | grep -q "ELF.*executable"; then
        error "Downloaded file is not a valid Linux executable"
        exit 1
    fi
    
    # Install binary
    info "Installing to $INSTALL_DIR/$INSTALL_NAME..."
    mv "$TEMP_DIR/$BINARY_NAME" "$INSTALL_DIR/$INSTALL_NAME"
    
    # Verify installation
    if [ -x "$INSTALL_DIR/$INSTALL_NAME" ]; then
        info "Installation successful! ✓"
        info ""
        info "Run 'awf --help' to get started"
        info "Note: awf requires Docker to be installed and running"
    else
        error "Installation failed - binary not found at $INSTALL_DIR/$INSTALL_NAME"
        exit 1
    fi
}

# Run main function
main
