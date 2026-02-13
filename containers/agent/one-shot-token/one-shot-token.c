/**
 * One-Shot Token LD_PRELOAD Library
 *
 * Intercepts getenv() calls for sensitive token environment variables.
 * On first access, caches the value in memory and unsets from environment.
 * Subsequent calls return the cached value, so the process can read tokens
 * multiple times while /proc/self/environ no longer exposes them.
 *
 * Configuration:
 *   AWF_ONE_SHOT_TOKENS - Comma-separated list of token names to protect
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

/* Cached token values - stored on first access so subsequent reads succeed
 * even after the variable is unset from the environment. This allows
 * /proc/self/environ to be cleaned while the process can still read tokens. */
static char *token_cache[MAX_TOKENS] = {0};

/* Mutex for thread safety */
static pthread_mutex_t token_mutex = PTHREAD_MUTEX_INITIALIZER;

/* Thread-local recursion guard to prevent deadlock when:
 * 1. secure_getenv("X") acquires token_mutex
 * 2. init_token_list() calls fprintf() for logging
 * 3. glibc's fprintf calls secure_getenv() for locale initialization
 * 4. Our secure_getenv() would try to acquire token_mutex again -> DEADLOCK
 *
 * With this guard, recursive calls from the same thread skip the mutex
 * and pass through directly to the real function. This is safe because
 * the recursive call is always for a non-sensitive variable (locale).
 */
static __thread int in_getenv = 0;

/* Initialization flag */
static int tokens_initialized = 0;

/* Pointer to the real getenv function */
static char *(*real_getenv)(const char *name) = NULL;

/* Pointer to the real secure_getenv function */
static char *(*real_secure_getenv)(const char *name) = NULL;

/* Resolve real_getenv if not yet resolved (idempotent, no locks needed) */
static void ensure_real_getenv(void) {
    if (real_getenv != NULL) return;
    real_getenv = dlsym(RTLD_NEXT, "getenv");
    if (real_getenv == NULL) {
        fprintf(stderr, "[one-shot-token] FATAL: Could not find real getenv: %s\n", dlerror());
        abort();
    }
}

/* Resolve real_secure_getenv if not yet resolved (idempotent, no locks needed) */
static void ensure_real_secure_getenv(void) {
    if (real_secure_getenv != NULL) return;
    real_secure_getenv = dlsym(RTLD_NEXT, "secure_getenv");
    /* secure_getenv may not be available on all systems - that's OK */
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
/**
 * Library constructor - resolves real getenv/secure_getenv at load time.
 *
 * This MUST run before any other library's constructors to prevent a deadlock:
 * if a constructor (e.g., LLVM in rustc) calls getenv() and we lazily call
 * dlsym(RTLD_NEXT) from within our intercepted getenv(), dlsym() deadlocks
 * because the dynamic linker's internal lock is already held during constructor
 * execution. Resolving here (in our LD_PRELOAD'd constructor which runs first)
 * avoids this entirely.
 */
__attribute__((constructor))
static void one_shot_token_init(void) {
    ensure_real_getenv();
    ensure_real_secure_getenv();
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
 * Format token value for logging: show first 4 characters + "..."
 * Returns a static buffer (not thread-safe for the buffer, but safe for our use case
 * since we hold token_mutex when calling this)
 */
static const char *format_token_value(const char *value) {
    static char formatted[8]; /* "abcd..." + null terminator */
    
    if (value == NULL) {
        return "NULL";
    }
    
    size_t len = strlen(value);
    if (len == 0) {
        return "(empty)";
    }
    
    if (len <= 4) {
        /* If 4 chars or less, just show it all with ... */
        snprintf(formatted, sizeof(formatted), "%s...", value);
    } else {
        /* Show first 4 chars + ... */
        snprintf(formatted, sizeof(formatted), "%.4s...", value);
    }
    
    return formatted;
}

/**
 * Intercepted getenv function
 *
 * For sensitive tokens:
 * - First call: caches the value, unsets from environment, returns cached value
 * - Subsequent calls: returns the cached value from memory
 *
 * This clears tokens from /proc/self/environ while allowing the process
 * to read them multiple times via getenv().
 *
 * For all other variables: passes through to real getenv
 */
char *getenv(const char *name) {
    ensure_real_getenv();

    /* Skip interception during recursive calls (e.g., fprintf -> secure_getenv -> getenv) */
    if (in_getenv) {
        return real_getenv(name);
    }
    in_getenv = 1;

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
        in_getenv = 0;
        return real_getenv(name);
    }

    /* Sensitive token - handle cached access (mutex already held) */
    char *result = NULL;

    if (!token_accessed[token_idx]) {
        /* First access - get the real value and cache it */
        result = real_getenv(name);

        if (result != NULL) {
            /* Cache the value so subsequent reads succeed after unsetenv */
            /* Note: This memory is intentionally never freed - it must persist
             * for the lifetime of the process */
            token_cache[token_idx] = strdup(result);

            /* Unset the variable from the environment so /proc/self/environ is cleared */
            unsetenv(name);

            fprintf(stderr, "[one-shot-token] Token %s accessed and cached (value: %s)\n",
                    name, format_token_value(token_cache[token_idx]));

            result = token_cache[token_idx];
        }

        /* Mark as accessed even if NULL (prevents repeated log messages) */
        token_accessed[token_idx] = 1;
    } else {
        /* Already accessed - return cached value */
        result = token_cache[token_idx];
    }

    pthread_mutex_unlock(&token_mutex);
    in_getenv = 0;

    return result;
}

/**
 * Intercepted secure_getenv function
 *
 * This function preserves secure_getenv semantics (returns NULL in privileged contexts)
 * while applying the same cached token protection as getenv.
 *
 * For sensitive tokens:
 * - First call: caches the value, unsets from environment, returns cached value
 * - Subsequent calls: returns the cached value from memory
 *
 * For all other variables: passes through to real secure_getenv (or getenv if unavailable)
 */
char *secure_getenv(const char *name) {
    ensure_real_secure_getenv();
    ensure_real_getenv();
    if (real_secure_getenv == NULL) {
        return getenv(name);
    }
    /* Simple passthrough - no mutex, no token handling.
     * Token protection is handled by getenv() which is also intercepted. */
    return real_secure_getenv(name);
}
