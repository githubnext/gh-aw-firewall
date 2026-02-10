/**
 * One-Shot Token LD_PRELOAD Library
 *
 * Intercepts getenv() calls for sensitive token environment variables.
 * On first access, returns the real value and immediately unsets the variable.
 * Subsequent calls return NULL, preventing token reuse by malicious code.
 *
 * Configuration:
 *   AWF_ONE_SHOT_TOKENS - Comma-separated list of token names to protect
 *   AWF_ONE_SHOT_SKIP_UNSET - If set to "1", skip unsetting but still log accesses
 *   If not set, uses built-in defaults
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
#include <ctype.h>

/* Default sensitive token environment variable names */
static const char *DEFAULT_SENSITIVE_TOKENS[] = {
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

/* Maximum number of tokens we can track (for static allocation). This limit
 * balances memory usage with practical needs - 100 tokens should be more than
 * sufficient for any reasonable use case while keeping memory overhead low. */
#define MAX_TOKENS 100

/* Runtime token list (populated from AWF_ONE_SHOT_TOKENS or defaults) */
static char *sensitive_tokens[MAX_TOKENS];
static int num_tokens = 0;

/* Track which tokens have been accessed (one flag per token) */
static int token_accessed[MAX_TOKENS] = {0};

/* Mutex for thread safety */
static pthread_mutex_t token_mutex = PTHREAD_MUTEX_INITIALIZER;

/* Initialization flag */
static int tokens_initialized = 0;

/* Skip unset flag - if true, log accesses but don't unset variables */
static int skip_unset = 0;

/* Pointer to the real getenv function */
static char *(*real_getenv)(const char *name) = NULL;

/* Pointer to the real secure_getenv function */
static char *(*real_secure_getenv)(const char *name) = NULL;

/* pthread_once control for thread-safe initialization */
static pthread_once_t getenv_init_once = PTHREAD_ONCE_INIT;
static pthread_once_t secure_getenv_init_once = PTHREAD_ONCE_INIT;

/* Initialize the real getenv pointer (called exactly once via pthread_once) */
static void init_real_getenv_once(void) {
    real_getenv = dlsym(RTLD_NEXT, "getenv");
    if (real_getenv == NULL) {
        fprintf(stderr, "[one-shot-token] FATAL: Could not find real getenv: %s\n", dlerror());
        /* Cannot recover - abort to prevent undefined behavior */
        abort();
    }
}

/* Initialize the real secure_getenv pointer (called exactly once via pthread_once) */
static void init_real_secure_getenv_once(void) {
    real_secure_getenv = dlsym(RTLD_NEXT, "secure_getenv");
    /* Note: secure_getenv may not be available on all systems, so we don't abort if NULL */
    if (real_secure_getenv == NULL) {
        fprintf(stderr, "[one-shot-token] WARNING: secure_getenv not available, falling back to getenv\n");
    }
}

/**
 * Initialize the token list from AWF_ONE_SHOT_TOKENS environment variable
 * or use defaults if not set. This is called once at first getenv() call.
 * Note: This function must be called with token_mutex held.
 */
static void init_token_list(void) {
    if (tokens_initialized) {
        return;
    }

    /* Check if we should skip unsetting (for debugging/testing) */
    const char *skip_unset_env = real_getenv("AWF_ONE_SHOT_SKIP_UNSET");
    if (skip_unset_env != NULL && strcmp(skip_unset_env, "1") == 0) {
        skip_unset = 1;
        fprintf(stderr, "[one-shot-token] WARNING: AWF_ONE_SHOT_SKIP_UNSET=1 - tokens will NOT be unset after access\n");
    }

    /* Get the configuration from environment */
    const char *config = real_getenv("AWF_ONE_SHOT_TOKENS");
    
    if (config != NULL && config[0] != '\0') {
        /* Parse comma-separated token list using strtok_r for thread safety */
        char *config_copy = strdup(config);
        if (config_copy == NULL) {
            fprintf(stderr, "[one-shot-token] ERROR: Failed to allocate memory for token list\n");
            abort();
        }

        char *saveptr = NULL;
        char *token = strtok_r(config_copy, ",", &saveptr);
        while (token != NULL && num_tokens < MAX_TOKENS) {
            /* Trim leading whitespace */
            while (*token && isspace((unsigned char)*token)) token++;
            
            /* Trim trailing whitespace (only if string is non-empty) */
            size_t token_len = strlen(token);
            if (token_len > 0) {
                char *end = token + token_len - 1;
                while (end > token && isspace((unsigned char)*end)) {
                    *end = '\0';
                    end--;
                }
            }

            if (*token != '\0') {
                sensitive_tokens[num_tokens] = strdup(token);
                if (sensitive_tokens[num_tokens] == NULL) {
                    fprintf(stderr, "[one-shot-token] ERROR: Failed to allocate memory for token name\n");
                    /* Clean up previously allocated tokens */
                    for (int i = 0; i < num_tokens; i++) {
                        free(sensitive_tokens[i]);
                    }
                    free(config_copy);
                    abort();
                }
                num_tokens++;
            }

            token = strtok_r(NULL, ",", &saveptr);
        }

        free(config_copy);

        /* If AWF_ONE_SHOT_TOKENS was set but resulted in zero tokens (e.g., ",,," or whitespace only),
         * fall back to defaults to avoid silently disabling all protection */
        if (num_tokens == 0) {
            fprintf(stderr, "[one-shot-token] WARNING: AWF_ONE_SHOT_TOKENS was set but parsed to zero tokens\n");
            fprintf(stderr, "[one-shot-token] WARNING: Falling back to default token list to maintain protection\n");
            /* num_tokens is already 0 here; assignment is defensive programming for future refactoring */
            num_tokens = 0;
        } else {
            fprintf(stderr, "[one-shot-token] Initialized with %d custom token(s) from AWF_ONE_SHOT_TOKENS\n", num_tokens);
            tokens_initialized = 1;
            return;
        }
    }
    
    /* Use default token list (when AWF_ONE_SHOT_TOKENS is unset, empty, or parsed to zero tokens) */
    /* Note: num_tokens should be 0 when we reach here */
    for (int i = 0; DEFAULT_SENSITIVE_TOKENS[i] != NULL && num_tokens < MAX_TOKENS; i++) {
        sensitive_tokens[num_tokens] = strdup(DEFAULT_SENSITIVE_TOKENS[i]);
        if (sensitive_tokens[num_tokens] == NULL) {
            fprintf(stderr, "[one-shot-token] ERROR: Failed to allocate memory for default token name\n");
            /* Clean up previously allocated tokens */
            for (int j = 0; j < num_tokens; j++) {
                free(sensitive_tokens[j]);
            }
            abort();
        }
        num_tokens++;
    }

    fprintf(stderr, "[one-shot-token] Initialized with %d default token(s)\n", num_tokens);

    tokens_initialized = 1;
}
/* Ensure real_getenv is initialized (thread-safe) */
static void init_real_getenv(void) {
    pthread_once(&getenv_init_once, init_real_getenv_once);
}

/* Ensure real_secure_getenv is initialized (thread-safe) */
static void init_real_secure_getenv(void) {
    pthread_once(&secure_getenv_init_once, init_real_secure_getenv_once);
}

/* Check if a variable name is a sensitive token */
static int get_token_index(const char *name) {
    if (name == NULL) return -1;

    for (int i = 0; i < num_tokens; i++) {
        if (strcmp(name, sensitive_tokens[i]) == 0) {
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

    /* Initialize token list on first call (thread-safe) */
    pthread_mutex_lock(&token_mutex);
    if (!tokens_initialized) {
        init_token_list();
    }

    /* Get token index while holding mutex to avoid race with initialization */
    int token_idx = get_token_index(name);

    /* Not a sensitive token - release mutex and pass through */
    if (token_idx < 0) {
        pthread_mutex_unlock(&token_mutex);
        return real_getenv(name);
    }

    /* Sensitive token - handle one-shot access (mutex already held) */
    char *result = NULL;

    if (!token_accessed[token_idx]) {
        /* First access - get the real value */
        result = real_getenv(name);

        if (result != NULL) {
            if (skip_unset) {
                /* Skip unset mode - just log the access, don't clear */
                fprintf(stderr, "[one-shot-token] Token %s accessed (skip_unset=1, not cleared)\n", name);
            } else {
                /* Make a copy since unsetenv will invalidate the pointer */
                /* Note: This memory is intentionally never freed - it must persist
                 * for the lifetime of the caller's use of the returned pointer */
                result = strdup(result);

                /* Unset the variable so it can't be accessed again */
                unsetenv(name);

                fprintf(stderr, "[one-shot-token] Token %s accessed and cleared\n", name);
            }
        }

        /* Mark as accessed even if NULL (prevents repeated log messages) */
        token_accessed[token_idx] = 1;
    } else {
        /* Already accessed */
        if (skip_unset) {
            /* Skip unset mode - return the value again (since we didn't clear it) */
            result = real_getenv(name);
        } else {
            /* Normal mode - return NULL (token was cleared) */
            result = NULL;
        }
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
            if (skip_unset) {
                /* Skip unset mode - just log the access, don't clear */
                fprintf(stderr, "[one-shot-token] Token %s accessed (skip_unset=1, not cleared) (via secure_getenv)\n", name);
            } else {
                /* Make a copy since unsetenv will invalidate the pointer */
                /* Note: This memory is intentionally never freed - it must persist
                 * for the lifetime of the caller's use of the returned pointer */
                result = strdup(result);

                /* Unset the variable so it can't be accessed again */
                unsetenv(name);

                fprintf(stderr, "[one-shot-token] Token %s accessed and cleared (via secure_getenv)\n", name);
            }
        }

        /* Mark as accessed even if NULL (prevents repeated log messages) */
        token_accessed[token_idx] = 1;
    } else {
        /* Already accessed */
        if (skip_unset) {
            /* Skip unset mode - return the value again (since we didn't clear it) */
            result = real_secure_getenv(name);
        } else {
            /* Normal mode - return NULL (token was cleared) */
            result = NULL;
        }
    }

    pthread_mutex_unlock(&token_mutex);

    return result;
}
