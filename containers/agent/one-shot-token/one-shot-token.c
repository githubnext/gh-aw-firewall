/**
 * One-Shot Token LD_PRELOAD Library
 *
 * Protects sensitive token environment variables from exposure via
 * /proc/self/environ and limits access via getenv().
 *
 * When loaded, the library constructor reads cached token values from
 * AWF_TOKEN_CACHE_FILE (written by entrypoint.sh), populates an in-memory
 * cache, and immediately deletes the file. The sensitive variables are
 * never present in the process environment, so /proc/self/environ is clean.
 * Subsequent getenv() calls return the cached values from memory.
 *
 * Fallback: If no cache file is found, tokens are read from the environment
 * on first getenv() call, cached, and unset (original behavior).
 *
 * Configuration:
 *   AWF_ONE_SHOT_TOKENS - Comma-separated list of token names to protect
 *   AWF_TOKEN_CACHE_FILE - Path to the token cache file (set by entrypoint.sh)
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
#include <unistd.h>
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

/* Initialization flag */
static int tokens_initialized = 0;

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
 * Load cached token values from AWF_TOKEN_CACHE_FILE.
 *
 * The file format is one NAME=VALUE per line. After reading, the file
 * is deleted immediately to minimize the exposure window.
 *
 * Must be called with token_mutex held and after init_token_list().
 */
static void load_token_cache_file(void) {
    const char *cache_path = real_getenv("AWF_TOKEN_CACHE_FILE");
    if (cache_path == NULL || cache_path[0] == '\0') {
        return;
    }

    FILE *f = fopen(cache_path, "r");
    if (f == NULL) {
        fprintf(stderr, "[one-shot-token] WARNING: Could not open token cache file: %s\n", cache_path);
        return;
    }

    char line[8192];
    int loaded = 0;
    while (fgets(line, sizeof(line), f) != NULL) {
        /* Strip trailing newline */
        size_t len = strlen(line);
        if (len > 0 && line[len - 1] == '\n') {
            line[len - 1] = '\0';
            len--;
        }

        /* Find the '=' separator */
        char *eq = strchr(line, '=');
        if (eq == NULL || eq == line) continue;

        *eq = '\0';
        const char *name = line;
        const char *value = eq + 1;

        /* Find if this name matches a sensitive token */
        int idx = get_token_index(name);
        if (idx >= 0 && !token_accessed[idx]) {
            token_cache[idx] = strdup(value);
            if (token_cache[idx] != NULL) {
                token_accessed[idx] = 1;
                loaded++;
                fprintf(stderr, "[one-shot-token] Loaded cached token %s from file\n", name);
            }
        }
    }

    fclose(f);

    /* Delete the cache file immediately to minimize exposure */
    if (unlink(cache_path) == 0) {
        fprintf(stderr, "[one-shot-token] Token cache file deleted: %s\n", cache_path);
    } else {
        fprintf(stderr, "[one-shot-token] WARNING: Could not delete token cache file: %s\n", cache_path);
    }

    /* Also remove AWF_TOKEN_CACHE_FILE from environ */
    unsetenv("AWF_TOKEN_CACHE_FILE");

    if (loaded > 0) {
        fprintf(stderr, "[one-shot-token] Loaded %d token(s) from cache file\n", loaded);
    }
}

/**
 * Library constructor - runs when the library is loaded (before main()).
 *
 * If AWF_TOKEN_CACHE_FILE is set (by entrypoint.sh), loads cached token
 * values from the file and deletes it. The sensitive variables are never
 * present in /proc/self/environ because entrypoint.sh unsets them before
 * exec.
 *
 * If no cache file exists, tokens remain in the environment and will be
 * cached + unset on first getenv() call (original fallback behavior).
 */
__attribute__((constructor))
static void one_shot_token_init(void) {
    /* Initialize the real getenv pointer first */
    init_real_getenv_once();

    pthread_mutex_lock(&token_mutex);
    if (!tokens_initialized) {
        init_token_list();
    }

    /* Load tokens from cache file if available (set by entrypoint.sh) */
    load_token_cache_file();

    /* Eagerly cache any remaining sensitive tokens still in the environment
     * (fallback for when no cache file was used) */
    for (int i = 0; i < num_tokens; i++) {
        if (!token_accessed[i]) {
            char *value = real_getenv(sensitive_tokens[i]);
            if (value != NULL) {
                token_cache[i] = strdup(value);
                if (token_cache[i] != NULL) {
                    unsetenv(sensitive_tokens[i]);
                    fprintf(stderr, "[one-shot-token] Token %s eagerly cached and scrubbed from environ\n",
                            sensitive_tokens[i]);
                }
                token_accessed[i] = 1;
            }
        }
    }
    pthread_mutex_unlock(&token_mutex);

    fprintf(stderr, "[one-shot-token] Library initialized: %d token(s) protected, /proc/self/environ scrubbed\n",
            num_tokens);
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

    /* Sensitive token - handle cached access with secure_getenv semantics */
    pthread_mutex_lock(&token_mutex);

    char *result = NULL;

    if (!token_accessed[token_idx]) {
        /* First access - get the real value using secure_getenv */
        result = real_secure_getenv(name);

        if (result != NULL) {
            /* Cache the value so subsequent reads succeed after unsetenv */
            /* Note: This memory is intentionally never freed - it must persist
             * for the lifetime of the process */
            token_cache[token_idx] = strdup(result);

            /* Unset the variable from the environment so /proc/self/environ is cleared */
            unsetenv(name);

            fprintf(stderr, "[one-shot-token] Token %s accessed and cached (value: %s) (via secure_getenv)\n", 
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

    return result;
}
