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

/* Pointer to the real secure_getenv function (may be NULL if unavailable) */
static char *(*real_secure_getenv)(const char *name) = NULL;

/* Flag to track whether we've tried to resolve secure_getenv */
static int secure_getenv_initialized = 0;

/* Initialize the real getenv pointer */
static void init_real_getenv(void) {
    if (real_getenv == NULL) {
        real_getenv = dlsym(RTLD_NEXT, "getenv");
        if (real_getenv == NULL) {
            fprintf(stderr, "[one-shot-token] ERROR: Could not find real getenv: %s\n", dlerror());
            /* Fall back to a no-op to prevent crash */
            abort();
        }
    }
}

/* Initialize the real secure_getenv pointer (thread-safe) */
static void init_real_secure_getenv(void) {
    pthread_mutex_lock(&token_mutex);
    if (!secure_getenv_initialized) {
        real_secure_getenv = dlsym(RTLD_NEXT, "secure_getenv");
        secure_getenv_initialized = 1;
        /* Only log once when secure_getenv is not available */
        if (real_secure_getenv == NULL) {
            /* secure_getenv is not available on all systems, which is fine */
            fprintf(stderr, "[one-shot-token] INFO: secure_getenv not available, will fall back to getenv\n");
        }
    }
    pthread_mutex_unlock(&token_mutex);
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
 * Intercepted secure_getenv function
 *
 * This function preserves secure_getenv semantics (returns NULL in privileged contexts)
 * while applying the same one-shot token protection as getenv.
 *
 * For sensitive tokens:
 * - First call: returns the real value (if not in privileged context), then unsets the variable
 * - Subsequent calls: returns NULL
 *
 * For all other variables: passes through to real secure_getenv (or getenv if unavailable)
 */
char *secure_getenv(const char *name) {
    init_real_secure_getenv();
    init_real_getenv();

    /* If secure_getenv is not available, fall back to our intercepted getenv */
    if (real_secure_getenv == NULL) {
        return getenv(name);
    }

    int token_idx = get_token_index(name);

    /* Not a sensitive token - pass through to real secure_getenv */
    if (token_idx < 0) {
        return real_secure_getenv(name);
    }

    /* Sensitive token - handle one-shot access with secure_getenv semantics */
    pthread_mutex_lock(&token_mutex);

    char *result = NULL;

    if (!token_accessed[token_idx]) {
        /* First access - get the real value using secure_getenv */
        result = real_secure_getenv(name);

        if (result != NULL) {
            /* Make a copy since unsetenv will invalidate the pointer */
            /* Note: This memory is intentionally never freed - it must persist
             * for the lifetime of the caller's use of the returned pointer */
            result = strdup(result);

            /* Unset the variable so it can't be accessed again */
            unsetenv(name);

            fprintf(stderr, "[one-shot-token] Token %s accessed and cleared (via secure_getenv)\n", name);
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
