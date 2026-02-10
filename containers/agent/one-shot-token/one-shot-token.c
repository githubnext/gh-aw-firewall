/**
 * One-Shot Token LD_PRELOAD Library
 *
 * Intercepts getenv() calls for sensitive token environment variables.
 * On first access, returns the real value and immediately unsets the variable.
 * Subsequent calls return NULL, preventing token reuse by malicious code.
 *
 * Compile: gcc -shared -fPIC -o one-shot-token.so one-shot-token.c -ldl
 * Usage: LD_PRELOAD=/path/to/one-shot-token.so ./your-program
 */

#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
#include <stdio.h>

/* Sensitive token environment variable names */
static const char *SENSITIVE_TOKENS[] = {
    /* GitHub tokens */
    "COPILOT_GITHUB_TOKEN",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "GITHUB_API_TOKEN",
    "GITHUB_PAT",
    "GH_ACCESS_TOKEN",
    /* OpenAI tokens */
    "OPENAI_API_KEY",
    "OPENAI_KEY",
    /* Anthropic/Claude tokens */
    "ANTHROPIC_API_KEY",
    "CLAUDE_API_KEY",
    /* Codex tokens */
    "CODEX_API_KEY",
    NULL
};

/* Track which tokens have been accessed (one flag per token) */
static int token_accessed[sizeof(SENSITIVE_TOKENS) / sizeof(SENSITIVE_TOKENS[0])] = {0};

/* Mutex for thread safety */
static pthread_mutex_t token_mutex = PTHREAD_MUTEX_INITIALIZER;

/* Pointer to the real getenv function */
static char *(*real_getenv)(const char *name) = NULL;

/* pthread_once control for thread-safe initialization */
static pthread_once_t getenv_init_once = PTHREAD_ONCE_INIT;

/* Initialize the real getenv pointer (called exactly once via pthread_once) */
static void init_real_getenv_once(void) {
    real_getenv = dlsym(RTLD_NEXT, "getenv");
    if (real_getenv == NULL) {
        fprintf(stderr, "[one-shot-token] FATAL: Could not find real getenv: %s\n", dlerror());
        /* Cannot recover - abort to prevent undefined behavior */
        abort();
    }
}

/* Ensure real_getenv is initialized (thread-safe) */
static void init_real_getenv(void) {
    pthread_once(&getenv_init_once, init_real_getenv_once);
}

/* Check if a variable name is a sensitive token */
static int get_token_index(const char *name) {
    if (name == NULL) return -1;

    for (int i = 0; SENSITIVE_TOKENS[i] != NULL; i++) {
        if (strcmp(name, SENSITIVE_TOKENS[i]) == 0) {
            return i;
        }
    }
    return -1;
}

/**
 * Intercepted getenv function
 *
 * For sensitive tokens:
 * - First call: returns the real value, then unsets the variable
 * - Subsequent calls: returns NULL
 *
 * For all other variables: passes through to real getenv
 */
char *getenv(const char *name) {
    init_real_getenv();

    int token_idx = get_token_index(name);

    /* Not a sensitive token - pass through */
    if (token_idx < 0) {
        return real_getenv(name);
    }

    /* Sensitive token - handle one-shot access */
    pthread_mutex_lock(&token_mutex);

    char *result = NULL;

    if (!token_accessed[token_idx]) {
        /* First access - get the real value */
        result = real_getenv(name);

        if (result != NULL) {
            /* Make a copy since unsetenv will invalidate the pointer */
            /* Note: This memory is intentionally never freed - it must persist
             * for the lifetime of the caller's use of the returned pointer */
            result = strdup(result);

            /* Unset the variable so it can't be accessed again */
            unsetenv(name);

            fprintf(stderr, "[one-shot-token] Token %s accessed and cleared\n", name);
        }

        /* Mark as accessed even if NULL (prevents repeated log messages) */
        token_accessed[token_idx] = 1;
    } else {
        /* Already accessed - return NULL */
        result = NULL;
    }

    pthread_mutex_unlock(&token_mutex);

    return result;
}

/**
 * Also intercept secure_getenv for completeness
 * (some security-conscious code uses this instead of getenv)
 */
char *secure_getenv(const char *name) {
    /* secure_getenv returns NULL if the program is running with elevated privileges.
     * We delegate to our intercepted getenv which handles the one-shot logic. */
    return getenv(name);
}
