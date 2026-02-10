/**
 * One-Shot Token LD_PRELOAD Library
 *
 * Intercepts getenv() calls for sensitive token environment variables.
 * On first access, returns the real value and immediately unsets the variable.
 * Subsequent calls return NULL, preventing token reuse by malicious code.
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

/* Maximum number of tokens we can track (for static allocation) */
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

/* Pointer to the real getenv function */
static char *(*real_getenv)(const char *name) = NULL;

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
        /* Parse comma-separated token list */
        char *config_copy = strdup(config);
        if (config_copy == NULL) {
            fprintf(stderr, "[one-shot-token] ERROR: Failed to allocate memory for token list\n");
            abort();
        }

        char *token = strtok(config_copy, ",");
        while (token != NULL && num_tokens < MAX_TOKENS) {
            /* Trim leading whitespace */
            while (*token && isspace((unsigned char)*token)) token++;
            
            /* Trim trailing whitespace */
            char *end = token + strlen(token) - 1;
            while (end > token && isspace((unsigned char)*end)) {
                *end = '\0';
                end--;
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

            token = strtok(NULL, ",");
        }

        free(config_copy);

        fprintf(stderr, "[one-shot-token] Initialized with %d custom token(s) from AWF_ONE_SHOT_TOKENS\n", num_tokens);
    } else {
        /* Use default token list */
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
    }

    tokens_initialized = 1;
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
    pthread_mutex_unlock(&token_mutex);

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
