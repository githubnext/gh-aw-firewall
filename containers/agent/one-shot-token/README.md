# One-Shot Token Library

## Overview

The one-shot token library is an `LD_PRELOAD` shared library that provides **cached access** to sensitive environment variables containing GitHub, OpenAI, Anthropic/Claude, and Codex API tokens. When a process reads a protected token via `getenv()`, the library caches the value in memory and immediately unsets the environment variable. Subsequent `getenv()` calls return the cached value, allowing the process to read tokens multiple times while `/proc/self/environ` is cleared.

This protects against exfiltration via `/proc/self/environ` inspection while allowing legitimate multi-read access patterns that programs like the Copilot CLI require.

## Configuration

### Default Protected Tokens

By default, the library protects these token variables:

**GitHub:**
- `COPILOT_GITHUB_TOKEN`
- `GITHUB_TOKEN`
- `GH_TOKEN`
- `GITHUB_API_TOKEN`
- `GITHUB_PAT`
- `GH_ACCESS_TOKEN`

**OpenAI:**
- `OPENAI_API_KEY`
- `OPENAI_KEY`

**Anthropic/Claude:**
- `ANTHROPIC_API_KEY`
- `CLAUDE_API_KEY`

**Codex:**
- `CODEX_API_KEY`

### Custom Token List

You can configure a custom list of tokens to protect using the `AWF_ONE_SHOT_TOKENS` environment variable:

```bash
# Protect custom tokens instead of defaults
export AWF_ONE_SHOT_TOKENS="MY_API_KEY,MY_SECRET_TOKEN,CUSTOM_AUTH_KEY"

# Run your command with the library preloaded
LD_PRELOAD=/usr/local/lib/one-shot-token.so ./your-program
```

**Important notes:**
- When `AWF_ONE_SHOT_TOKENS` is set with valid tokens, **only** those tokens are protected (defaults are not included)
- If `AWF_ONE_SHOT_TOKENS` is set but contains only whitespace or commas (e.g., `"   "` or `",,,"`), the library falls back to the default token list to maintain protection
- Use comma-separated token names (whitespace is automatically trimmed)
- Maximum of 100 tokens can be protected
- The configuration is read once at library initialization (first `getenv()` call)
- Uses `strtok_r()` internally, which is thread-safe and won't interfere with application code using `strtok()`

## How It Works

### The LD_PRELOAD Mechanism

Linux's dynamic linker (`ld.so`) supports an environment variable called `LD_PRELOAD` that specifies shared libraries to load **before** all others. When a library is preloaded:

1. Its symbols take precedence over symbols in subsequently loaded libraries
2. This allows "interposing" or replacing standard library functions
3. The original function remains accessible via `dlsym(RTLD_NEXT, ...)`

```
┌─────────────────────────────────────────────────────────────────┐
│  Process Memory                                                 │
│                                                                 │
│  ┌──────────────────────┐                                       │
│  │ one-shot-token.so    │  ← Loaded first via LD_PRELOAD        │
│  │   getenv() ──────────┼──┐                                    │
│  └──────────────────────┘  │                                    │
│                            │ dlsym(RTLD_NEXT, "getenv")         │
│  ┌──────────────────────┐  │                                    │
│  │ libc.so              │  │                                    │
│  │   getenv() ←─────────┼──┘                                    │
│  └──────────────────────┘                                       │
│                                                                 │
│  Application calls getenv("GITHUB_TOKEN"):                      │
│  1. Resolves to one-shot-token.so's getenv()                    │
│  2. We check if it's a sensitive token                          │
│  3. If yes: cache value, unsetenv(), return cached value        │
│  4. If no: pass through to real getenv()                        │
└─────────────────────────────────────────────────────────────────┘
```

### Token Access Flow

```
First getenv("GITHUB_TOKEN") call:
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│ Application │────→│ one-shot-token.so │────→│ Real getenv │
│             │     │                    │     │             │
│             │←────│ Returns: "ghp_..." │←────│ "ghp_..."   │
└─────────────┘     │                    │     └─────────────┘
                    │ Then: unsetenv()   │
                    │ Mark as accessed   │
                    └──────────────────────┘

Second getenv("GITHUB_TOKEN") call:
┌─────────────┐     ┌──────────────────┐
│ Application │────→│ one-shot-token.so │
│             │     │                    │
│             │←────│ Returns: "ghp_..." │  (from in-memory cache)
└─────────────┘     └──────────────────────┘
```

### Thread Safety

The library uses a pthread mutex to ensure thread-safe access to the token state. Multiple threads calling `getenv()` simultaneously will be serialized for sensitive tokens, ensuring only one thread receives the actual value.

## Why This Works

### 1. Symbol Interposition

When `LD_PRELOAD=/usr/local/lib/one-shot-token.so` is set, the dynamic linker loads our library first. Any subsequent call to `getenv()` from the application or its libraries resolves to **our** implementation, not libc's.

### 2. Access to Original Function

We use `dlsym(RTLD_NEXT, "getenv")` to get a pointer to the **next** `getenv` in the symbol search order (libc's implementation). This allows us to:
- Call the real `getenv()` to retrieve the actual value
- Cache the value in an in-memory array
- Call `unsetenv()` to remove it from the environment (clears `/proc/self/environ`)
- Return the cached value to the caller

### 3. State Tracking and Caching

We maintain an array of flags (`token_accessed[]`) and a parallel cache array (`token_cache[]`). On first access, the token value is cached and the environment variable is unset. Subsequent calls return the cached value directly.

### 4. Memory Management

When we retrieve a token value, we `strdup()` it into the cache before calling `unsetenv()`. This is necessary because:
- `getenv()` returns a pointer to memory owned by the environment
- `unsetenv()` invalidates that pointer
- The caller expects a valid string, so we must copy it first

Note: This memory is intentionally never freed—it must remain valid for the lifetime of the caller's use.

## Integration with AWF

### Container Mode (non-chroot)

The library is built into the agent container image and loaded via:

```bash
export LD_PRELOAD=/usr/local/lib/one-shot-token.so
exec capsh --drop=$CAPS_TO_DROP -- -c "exec gosu awfuser $COMMAND"
```

### Chroot Mode

In chroot mode, the library must be accessible from within the chroot (host filesystem). The entrypoint:

1. Copies the library from container to `/host/tmp/awf-lib/one-shot-token.so`
2. Sets `LD_PRELOAD=/tmp/awf-lib/one-shot-token.so` inside the chroot
3. Cleans up the library on exit

## Building

### In Docker (automatic)

The Dockerfile compiles the Rust library during image build:

```dockerfile
RUN cargo build --release && \
    cp target/release/libone_shot_token.so /usr/local/lib/one-shot-token.so
```

### Locally (for testing)

Requires Rust toolchain (install via [rustup](https://rustup.rs/)):

```bash
./build.sh
```

This builds `target/release/libone_shot_token.so` and creates a symlink `one-shot-token.so` for backwards compatibility.

## Testing

### Basic Test (Default Tokens)

```bash
# Build the library
./build.sh

# Create a simple C program that calls getenv twice
cat > test_getenv.c << 'EOF'
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    const char *token1 = getenv("GITHUB_TOKEN");
    printf("First read: %s\n", token1 ? token1 : "");

    const char *token2 = getenv("GITHUB_TOKEN");
    printf("Second read: %s\n", token2 ? token2 : "");

    return 0;
}
EOF

# Compile the test program
gcc -o test_getenv test_getenv.c

# Test with the one-shot token library preloaded
export GITHUB_TOKEN="test-token-12345"
LD_PRELOAD=./one-shot-token.so ./test_getenv
```

Expected output:
```
[one-shot-token] Initialized with 11 default token(s)
[one-shot-token] Token GITHUB_TOKEN accessed and cached (value: test...)
First read: test-token-12345
Second read: test-token-12345
```

### Custom Token Test

```bash
# Build the library
./build.sh

# Test with custom tokens
export AWF_ONE_SHOT_TOKENS="MY_API_KEY,SECRET_TOKEN"
export MY_API_KEY="secret-value-123"
export SECRET_TOKEN="another-secret"

LD_PRELOAD=./one-shot-token.so bash -c '
  echo "First MY_API_KEY: $(printenv MY_API_KEY)"
  echo "Second MY_API_KEY: $(printenv MY_API_KEY)"
  echo "First SECRET_TOKEN: $(printenv SECRET_TOKEN)"
  echo "Second SECRET_TOKEN: $(printenv SECRET_TOKEN)"
'
```

Expected output:
```
[one-shot-token] Initialized with 2 custom token(s) from AWF_ONE_SHOT_TOKENS
[one-shot-token] Token MY_API_KEY accessed and cached (value: secr...)
First MY_API_KEY: secret-value-123
Second MY_API_KEY: secret-value-123
[one-shot-token] Token SECRET_TOKEN accessed and cached (value: anot...)
First SECRET_TOKEN: another-secret
Second SECRET_TOKEN: another-secret
```

### Integration with AWF

When using the library with AWF (Agentic Workflow Firewall):

```bash
# Use default tokens
sudo awf --allow-domains github.com -- your-command

# Use custom tokens
export AWF_ONE_SHOT_TOKENS="MY_TOKEN,CUSTOM_API_KEY"
sudo -E awf --allow-domains github.com -- your-command
```

Note: The `AWF_ONE_SHOT_TOKENS` variable must be exported before running `awf` so it's available when the library initializes.

## Security Considerations

### What This Protects Against

- **Token leakage via environment inspection**: `/proc/self/environ` and tools like `printenv` (in the same process) will not show the token after first access — the environment variable is unset
- **Token exfiltration via /proc**: Other processes reading `/proc/<pid>/environ` cannot see the token

### What This Does NOT Protect Against

- **Memory inspection**: The token exists in process memory (in the cache array)
- **Interception before first read**: If malicious code runs before the legitimate code reads the token, it gets the value
- **In-process getenv() calls**: Since values are cached, any code in the same process can still call `getenv()` and get the cached token
- **Static linking**: Programs statically linked with libc bypass LD_PRELOAD
- **Direct syscalls**: Code that reads `/proc/self/environ` directly (without getenv) bypasses this protection
- **Task-level /proc exposure**: `/proc/PID/task/TID/environ` may still expose tokens even after `unsetenv()`. The library checks and logs warnings about this exposure.

### Task-Level Environment Verification

After calling `unsetenv()` to clear tokens from `/proc/self/environ`, the library automatically checks if tokens are still exposed in `/proc/self/task/*/environ` files (per-task environment). This verification provides visibility into a known Linux kernel behavior where task-level environ files may retain values even after the process-level environment is cleared.

**Log messages:**
- `INFO: Token <name> verified cleared from N task(s)` - Token successfully cleared from all tasks (✓ secure)
- `WARNING: Token <name> still exposed in /proc/self/task/<tid>/environ` - Token still visible in task environ, where `<tid>` is the actual task ID (⚠ security concern)
- `INFO: No tasks found under /proc/self/task` - Task directory not accessible or empty
- `INFO: Could not access /proc/self/task` - Filesystem not available (e.g., non-Linux systems)

This verification runs automatically on first access to each sensitive token and helps identify potential security issues with task-level environment exposure.

### Defense in Depth

This library is one layer in AWF's security model:
1. **Network isolation**: iptables rules redirect traffic through Squid proxy
2. **Domain allowlisting**: Squid blocks requests to non-allowed domains
3. **Capability dropping**: CAP_NET_ADMIN is dropped to prevent iptables modification
4. **Token environment cleanup**: This library clears tokens from `/proc/self/environ` while caching for legitimate use

## Limitations

- **Linux only**: The library is compiled for Linux (x86_64 and potentially other architectures via Rust cross-compilation)
- **glibc programs only**: Programs using musl libc or statically linked programs are not affected
- **Single process**: Child processes inherit the LD_PRELOAD but have their own token state and cache (each starts fresh)

## Files

- `src/lib.rs` - Library source code (Rust)
- `Cargo.toml` - Rust package configuration
- `build.sh` - Local build script
- `one-shot-token.c` - Legacy C implementation (for reference)
- `README.md` - This documentation
