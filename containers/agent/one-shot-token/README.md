# One-Shot Token Library

## Overview

The one-shot token library is an `LD_PRELOAD` shared library that provides **single-use access** to sensitive environment variables containing GitHub, OpenAI, Anthropic/Claude, and Codex API tokens. When a process reads a protected token via `getenv()`, the library returns the value once and immediately unsets the environment variable, preventing subsequent reads.

This protects against malicious code that might attempt to exfiltrate tokens after the legitimate application has already consumed them.

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
│  3. If yes: call real getenv(), copy value, unsetenv(), return  │
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
│             │←────│ Returns: NULL      │  (token already accessed)
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
- Return that value to the caller
- Then call `unsetenv()` to remove it from the environment

### 3. State Tracking

We maintain an array of flags (`token_accessed[]`) to track which tokens have been read. Once a token is marked as accessed, subsequent calls return `NULL` without consulting the environment.

### 4. Memory Management

When we retrieve a token value, we `strdup()` it before calling `unsetenv()`. This is necessary because:
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

The Dockerfile compiles the library during image build:

```dockerfile
RUN gcc -shared -fPIC -O2 -Wall \
    -o /usr/local/lib/one-shot-token.so \
    /tmp/one-shot-token.c \
    -ldl -lpthread
```

### Locally (for testing)

```bash
./build.sh
```

This produces `one-shot-token.so` in the current directory.

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
[one-shot-token] Token GITHUB_TOKEN accessed and cleared
First read: test-token-12345
Second read:
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
[one-shot-token] Token MY_API_KEY accessed and cleared
First MY_API_KEY: secret-value-123
Second MY_API_KEY:
[one-shot-token] Token SECRET_TOKEN accessed and cleared
First SECRET_TOKEN: another-secret
Second SECRET_TOKEN:
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

- **Token reuse by injected code**: If malicious code runs after the legitimate application has read its token, it cannot retrieve the token again
- **Token leakage via environment inspection**: Tools like `printenv` or reading `/proc/self/environ` will not show the token after first access

### What This Does NOT Protect Against

- **Memory inspection**: The token exists in process memory (as the returned string)
- **Interception before first read**: If malicious code runs before the legitimate code reads the token, it gets the value
- **Static linking**: Programs statically linked with libc bypass LD_PRELOAD
- **Direct syscalls**: Code that reads `/proc/self/environ` directly (without getenv) bypasses this protection
  - **Mitigated by AWF**: The entrypoint scrubs sensitive env vars from the process environment before `exec`, so `/proc/self/environ` of the user process will not contain them

### Defense in Depth

This library is one layer in AWF's security model:
1. **Network isolation**: iptables rules redirect traffic through Squid proxy
2. **Domain allowlisting**: Squid blocks requests to non-allowed domains
3. **Capability dropping**: CAP_NET_ADMIN is dropped to prevent iptables modification
4. **One-shot tokens**: This library prevents token reuse

## Limitations

- **x86_64 Linux only**: The library is compiled for x86_64 Ubuntu
- **glibc programs only**: Programs using musl libc or statically linked programs are not affected
- **Single process**: Child processes inherit the LD_PRELOAD but have their own token state (each can read once)

## Files

- `one-shot-token.c` - Library source code
- `build.sh` - Local build script
- `README.md` - This documentation
