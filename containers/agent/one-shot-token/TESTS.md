# One-Shot Token Tests

This directory contains test programs to verify that the one-shot-token library correctly clears sensitive tokens from the process environment.

## Test Programs

### test_environ_array.c

The primary test program that verifies environ array clearing for both C and Rust implementations.

**What it tests:**
- Sensitive tokens (GITHUB_TOKEN, OPENAI_API_KEY, etc.) are removed from the `extern char **environ` array after first access via `getenv()`
- Cached values remain accessible through subsequent `getenv()` calls
- Non-sensitive variables remain unaffected in the environ array

**Build:**
```bash
gcc -o test_environ_array test_environ_array.c
```

**Run with C library:**
```bash
LD_PRELOAD=/path/to/one-shot-token-c.so ./test_environ_array
```

**Run with Rust library:**
```bash
LD_PRELOAD=/path/to/libone_shot_token.so ./test_environ_array
```

**Expected output:**
```
✅ ALL TESTS PASSED: 7/7

SUCCESS: All sensitive tokens were cleared from the environ array while
         remaining accessible via getenv(). Non-sensitive variables were
         correctly preserved in the environment.
```

### test_proc_environ.c

A simpler test that checks `/proc/self/environ` directly.

**Note:** This test has limitations because `/proc/self/environ` is a kernel snapshot taken at process start and doesn't reflect runtime changes via `setenv()`. Use `test_environ_array.c` for accurate verification.

### test_proc_environ_fork.c

A test that uses child processes to read `/proc/PID/environ` from outside the process.

**Note:** Similar limitations as above - `/proc/PID/environ` shows initial environment, not runtime changes.

## Why test_environ_array.c is the Correct Test

The `extern char **environ` pointer is the authoritative source for the process's current environment. This is what:
- The libc `getenv()` function uses internally
- The `envp` parameter to `main()` points to at startup
- Child processes inherit when forked

The `/proc/self/environ` and `/proc/PID/environ` files are kernel-maintained snapshots of the process's initial environment and are **not** updated when the environment changes at runtime via `setenv()` or `unsetenv()`.

Therefore, testing the `environ` array directly is the correct way to verify that our `clear_from_environ()` function works properly.

## Test Results

Both the C and Rust implementations pass all tests:

**C Library (`one-shot-token-c.so`):**
- ✅ All 7 tests passed
- Tokens cleared from environ array
- Cached values accessible via getenv()
- Non-sensitive variables preserved

**Rust Library (`libone_shot_token.so`):**
- ✅ All 7 tests passed
- Tokens cleared from environ array
- Cached values accessible via getenv()
- Non-sensitive variables preserved

## Implementation Details

Both libraries implement a two-step clearing process:

1. **`unsetenv(name)`** - Standard POSIX function to remove environment variable
2. **`clear_from_environ(name)`** - Manual removal from the `environ` array by shifting entries

This defense-in-depth approach ensures complete removal even if `unsetenv()` doesn't fully clear the variable.

The `check_task_environ_exposure()` function verifies successful clearing by directly inspecting the `environ` pointer after the clearing operations.
