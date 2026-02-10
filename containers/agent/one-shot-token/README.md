# One-Shot Token Library

## Overview

The one-shot token library is an `LD_PRELOAD` shared library that provides **single-use access** to sensitive GitHub token environment variables. When a process reads a protected token via `getenv()`, the library returns the value once and immediately unsets the environment variable, preventing subsequent reads.

This protects against malicious code that might attempt to exfiltrate tokens after the legitimate application has already consumed them.

## Protected Environment Variables

The library intercepts access to these token variables:

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

```bash
# Build the library
./build.sh

# Test with a simple program
export GITHUB_TOKEN="test-token-12345"
LD_PRELOAD=./one-shot-token.so bash -c '
  echo "First read: $(printenv GITHUB_TOKEN)"
  echo "Second read: $(printenv GITHUB_TOKEN)"
'
```

Expected output:
```
[one-shot-token] Token GITHUB_TOKEN accessed and cleared
First read: test-token-12345
Second read:
```

## Security Considerations

### What This Protects Against

- **Token reuse by injected code**: If malicious code runs after the legitimate application has read its token, it cannot retrieve the token again
- **Token leakage via environment inspection**: Tools like `printenv` or reading `/proc/self/environ` will not show the token after first access

### What This Does NOT Protect Against

- **Memory inspection**: The token exists in process memory (as the returned string)
- **Interception before first read**: If malicious code runs before the legitimate code reads the token, it gets the value
- **Static linking**: Programs statically linked with libc bypass LD_PRELOAD
- **Direct syscalls**: Code that reads `/proc/self/environ` directly (without getenv) bypasses this protection

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
