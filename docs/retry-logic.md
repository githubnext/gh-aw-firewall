# Dockerfile Retry Logic

## Overview

This document describes the retry logic added to the Dockerfiles to handle sporadic network issues during image builds.

## Problem

In CI/CD environments, `apt-get` and `curl` commands can occasionally fail due to:
- Transient network failures
- Repository server rate limiting
- DNS resolution timeouts
- TLS/SSL handshake failures

These failures cause Docker image builds to fail, requiring manual intervention or workflow retries.

## Solution

Added a `retry_command()` shell function to both Dockerfiles that automatically retries failed commands with exponential backoff.

### Retry Parameters

- **Max Attempts**: 5
- **Initial Delay**: 2 seconds
- **Backoff Strategy**: Exponential (delay doubles after each failure)
- **Delay Sequence**: 2s → 4s → 8s → 16s (total: 30s of retries)

### Implementation

```bash
retry_command() {
    local max_attempts=5;
    local attempt=1;
    local delay=2;
    while [ $attempt -le $max_attempts ]; do
        if eval "$@"; then
            return 0;
        fi;
        echo "Command failed (attempt $attempt/$max_attempts)";
        if [ $attempt -lt $max_attempts ]; then
            echo "Retrying in ${delay}s...";
            sleep $delay;
            delay=$((delay * 2));
        fi;
        attempt=$((attempt + 1));
    done;
    echo "Command failed after $max_attempts attempts";
    return 1;
}
```

### Modified Commands

#### Agent Dockerfile (`containers/agent/Dockerfile`)

All network-dependent commands now use retry logic:
- `apt-get update`
- `apt-get install` (multiple invocations)
- `curl` downloads (NodeSource setup script, Docker GPG key)

#### Squid Dockerfile (`containers/squid/Dockerfile`)

All network-dependent commands now use retry logic:
- `apt-get update`
- `apt-get install`

## Testing

### Manual Testing

To test the retry logic locally with intentional failures:

```bash
# Build with --no-cache to avoid caching successful builds
docker build --no-cache containers/agent -t test-agent
docker build --no-cache containers/squid -t test-squid
```

### Observing Retries

When a command fails, you'll see output like:

```
Command failed (attempt 1/5)
Retrying in 2s...
Command failed (attempt 2/5)
Retrying in 4s...
...
```

### Integration Tests

Integration tests automatically use the Docker images. To force local builds in tests:

```bash
# Run tests with local image builds
npm run test:integration -- --testNamePattern="Test 1"
```

Note: Tests use GHCR images by default. To test with local builds, add `buildLocal: true` to test options.

## Benefits

1. **Improved Reliability**: Handles transient network failures automatically
2. **Reduced Manual Intervention**: No need to manually retry failed builds
3. **Better CI/CD Experience**: Fewer spurious build failures
4. **Clear Feedback**: Retry messages help debug persistent issues

## Limitations

1. **Does not fix persistent failures**: If a command fails 5 times, the build still fails
2. **Adds build time**: Up to 30 seconds of additional time in worst case
3. **No per-package retry**: Entire `apt-get install` command retries, not individual packages

## Future Improvements

Potential enhancements:
- Make retry count and delays configurable via build args
- Add jitter to prevent thundering herd
- Separate retry logic for different failure types (network vs. authentication)
- Per-package retry granularity
