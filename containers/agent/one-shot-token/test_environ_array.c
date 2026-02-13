/**
 * Test: Verify environ array clearing for both C and Rust libraries
 *
 * This test uses the extern environ pointer to verify that sensitive tokens
 * are removed from the environment array after being accessed via getenv().
 *
 * Build:
 *   gcc -o test_environ_array test_environ_array.c
 *
 * Run with C library:
 *   LD_PRELOAD=/path/to/one-shot-token-c.so ./test_environ_array
 *
 * Run with Rust library:
 *   LD_PRELOAD=/path/to/libone_shot_token.so ./test_environ_array
 */

#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

extern char **environ;

/**
 * Check if a variable exists in the environ array
 * Returns 1 if found, 0 if not found
 */
int check_in_environ_array(const char *var_name) {
    if (environ == NULL) {
        return 0;
    }

    size_t name_len = strlen(var_name);
    char **env = environ;

    while (*env != NULL) {
        if (strncmp(*env, var_name, name_len) == 0 && (*env)[name_len] == '=') {
            return 1;
        }
        env++;
    }
    return 0;
}

void print_test_header(const char *test_name) {
    printf("\n");
    printf("========================================\n");
    printf("TEST: %s\n", test_name);
    printf("========================================\n");
}

void print_step(const char *step, int in_environ, const char *getenv_result) {
    printf("  %-40s | environ: %-3s | getenv: %s\n",
           step,
           in_environ == 1 ? "YES" : "NO ",
           getenv_result ? getenv_result : "NULL");
}

int test_sensitive_token(const char *token_name, const char *token_value) {
    print_test_header(token_name);

    // 1. Set the token
    setenv(token_name, token_value, 1);
    int in_env_1 = check_in_environ_array(token_name);
    char *val_1 = getenv(token_name);
    print_step("1. After setenv", in_env_1, val_1 ? "present" : "NULL");

    // 2. First getenv access (should trigger caching and clearing)
    char *token = getenv(token_name);
    int in_env_2 = check_in_environ_array(token_name);
    print_step("2. After first getenv", in_env_2, token ? token : "NULL");

    // 3. Second getenv access (should return cached value)
    token = getenv(token_name);
    int in_env_3 = check_in_environ_array(token_name);
    print_step("3. After second getenv", in_env_3, token ? token : "NULL");

    // Verify expectations
    int passed = 1;

    if (in_env_2 != 0) {
        printf("  ❌ FAIL: Token still in environ array after first access\n");
        passed = 0;
    }
    if (in_env_3 != 0) {
        printf("  ❌ FAIL: Token still in environ array after second access\n");
        passed = 0;
    }
    if (token == NULL) {
        printf("  ❌ FAIL: getenv() returned NULL instead of cached value\n");
        passed = 0;
    } else if (strcmp(token, token_value) != 0) {
        printf("  ❌ FAIL: getenv() returned wrong value (expected '%s', got '%s')\n",
               token_value, token);
        passed = 0;
    }

    if (passed) {
        printf("  ✅ PASS: Token cleared from environ array, getenv() returns cached value\n");
    }

    return passed;
}

int test_non_sensitive() {
    print_test_header("NON_SENSITIVE_VAR (should remain visible)");

    setenv("NON_SENSITIVE_VAR", "public_value", 1);
    int in_env_1 = check_in_environ_array("NON_SENSITIVE_VAR");
    print_step("1. After setenv", in_env_1, "present");

    char *val = getenv("NON_SENSITIVE_VAR");
    int in_env_2 = check_in_environ_array("NON_SENSITIVE_VAR");
    print_step("2. After getenv", in_env_2, val ? val : "NULL");

    int passed = 1;

    if (in_env_2 != 1) {
        printf("  ❌ FAIL: Non-sensitive variable incorrectly cleared from environ\n");
        passed = 0;
    }
    if (val == NULL || strcmp(val, "public_value") != 0) {
        printf("  ❌ FAIL: getenv() did not return correct value\n");
        passed = 0;
    }

    if (passed) {
        printf("  ✅ PASS: Non-sensitive variable remains in environ array\n");
    }

    return passed;
}

int main() {
    printf("================================================================================\n");
    printf("Test Suite: Environ Array Clearing Verification\n");
    printf("================================================================================\n");
    printf("\n");
    printf("This test verifies that sensitive tokens are removed from the environ array\n");
    printf("after being accessed via getenv(), while still being available through the\n");
    printf("cached value returned by subsequent getenv() calls.\n");
    printf("\n");
    printf("The test checks the extern char **environ pointer directly, which is the\n");
    printf("source of truth for the process's environment variables.\n");

    int total_tests = 0;
    int passed_tests = 0;

    // Test sensitive tokens (should be cleared from environ)
    total_tests++; passed_tests += test_sensitive_token("GITHUB_TOKEN", "ghp_test_12345");
    total_tests++; passed_tests += test_sensitive_token("OPENAI_API_KEY", "sk-test-67890");
    total_tests++; passed_tests += test_sensitive_token("ANTHROPIC_API_KEY", "sk-ant-test-abcde");
    total_tests++; passed_tests += test_sensitive_token("COPILOT_GITHUB_TOKEN", "ghp_copilot_xyz");
    total_tests++; passed_tests += test_sensitive_token("GH_TOKEN", "ghp_gh_token");
    total_tests++; passed_tests += test_sensitive_token("CODEX_API_KEY", "codex_key_123");

    // Test non-sensitive variable (should remain in environ)
    total_tests++; passed_tests += test_non_sensitive();

    // Summary
    printf("\n");
    printf("================================================================================\n");
    if (passed_tests == total_tests) {
        printf("✅ ALL TESTS PASSED: %d/%d\n", passed_tests, total_tests);
        printf("================================================================================\n");
        printf("\nSUCCESS: All sensitive tokens were cleared from the environ array while\n");
        printf("         remaining accessible via getenv(). Non-sensitive variables were\n");
        printf("         correctly preserved in the environment.\n");
        return 0;
    } else {
        printf("❌ SOME TESTS FAILED: %d/%d passed\n", passed_tests, total_tests);
        printf("================================================================================\n");
        return 1;
    }
}
