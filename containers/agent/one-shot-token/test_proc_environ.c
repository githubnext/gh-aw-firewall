/**
 * Test: Verify that sensitive tokens are removed from /proc/self/environ
 *
 * This test verifies that after accessing a sensitive token via getenv(),
 * the token is no longer visible in /proc/self/environ (which is read by
 * external processes or tools inspecting this process's environment).
 *
 * Build:
 *   gcc -o test_proc_environ test_proc_environ.c
 *
 * Run with one-shot-token library:
 *   LD_PRELOAD=./one-shot-token-c.so ./test_proc_environ
 *   or
 *   LD_PRELOAD=./target/debug/libone_shot_token.so ./test_proc_environ
 */

#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/types.h>

/**
 * Read /proc/self/environ and check if a variable exists
 * Returns 1 if found, 0 if not found, -1 on error
 */
int check_in_proc_environ(const char *var_name) {
    int fd = open("/proc/self/environ", O_RDONLY);
    if (fd < 0) {
        perror("Failed to open /proc/self/environ");
        return -1;
    }

    // Read the entire environ file
    char buffer[65536];
    ssize_t bytes_read = read(fd, buffer, sizeof(buffer) - 1);
    close(fd);

    if (bytes_read < 0) {
        perror("Failed to read /proc/self/environ");
        return -1;
    }

    buffer[bytes_read] = '\0';

    // /proc/self/environ contains null-separated strings
    // Search for "VAR_NAME=" in the buffer
    size_t var_name_len = strlen(var_name);
    char *search_pattern = malloc(var_name_len + 2);
    if (search_pattern == NULL) {
        fprintf(stderr, "Memory allocation failed\n");
        return -1;
    }
    snprintf(search_pattern, var_name_len + 2, "%s=", var_name);

    int found = 0;
    size_t pos = 0;
    while (pos < (size_t)bytes_read) {
        if (strncmp(buffer + pos, search_pattern, var_name_len + 1) == 0) {
            found = 1;
            break;
        }
        // Move to next null-terminated string
        while (pos < (size_t)bytes_read && buffer[pos] != '\0') {
            pos++;
        }
        pos++; // Skip the null byte
    }

    free(search_pattern);
    return found;
}

void print_test_header(const char *test_name) {
    printf("\n");
    printf("========================================\n");
    printf("TEST: %s\n", test_name);
    printf("========================================\n");
}

void print_result(const char *step, int in_proc, const char *getenv_result) {
    printf("  %-30s | in /proc/self/environ: %s | getenv: %s\n",
           step,
           in_proc == 1 ? "YES" : (in_proc == 0 ? "NO " : "ERR"),
           getenv_result ? getenv_result : "NULL");
}

int test_github_token() {
    print_test_header("GITHUB_TOKEN");

    // Set the token
    setenv("GITHUB_TOKEN", "ghp_test_secret_123", 1);
    int in_proc_1 = check_in_proc_environ("GITHUB_TOKEN");
    char *val_1 = getenv("GITHUB_TOKEN");
    print_result("1. After setenv", in_proc_1, val_1 ? "not NULL" : "NULL");

    // First access (should trigger caching and clearing)
    char *token = getenv("GITHUB_TOKEN");
    int in_proc_2 = check_in_proc_environ("GITHUB_TOKEN");
    print_result("2. After first getenv", in_proc_2, token ? token : "NULL");

    // Second access (should return cached value)
    token = getenv("GITHUB_TOKEN");
    int in_proc_3 = check_in_proc_environ("GITHUB_TOKEN");
    print_result("3. After second getenv", in_proc_3, token ? token : "NULL");

    // Verify expectations
    int passed = 1;
    if (in_proc_2 != 0) {
        printf("  ❌ FAIL: Token still visible in /proc/self/environ after first access\n");
        passed = 0;
    }
    if (in_proc_3 != 0) {
        printf("  ❌ FAIL: Token still visible in /proc/self/environ after second access\n");
        passed = 0;
    }
    if (token == NULL || strcmp(token, "ghp_test_secret_123") != 0) {
        printf("  ❌ FAIL: getenv() did not return correct cached value\n");
        passed = 0;
    }

    if (passed) {
        printf("  ✅ PASS: Token cleared from /proc/self/environ but getenv() still works\n");
    }

    return passed;
}

int test_openai_api_key() {
    print_test_header("OPENAI_API_KEY");

    setenv("OPENAI_API_KEY", "sk-test-key-456", 1);
    int in_proc_1 = check_in_proc_environ("OPENAI_API_KEY");
    print_result("1. After setenv", in_proc_1, "not NULL");

    char *token = getenv("OPENAI_API_KEY");
    int in_proc_2 = check_in_proc_environ("OPENAI_API_KEY");
    print_result("2. After getenv", in_proc_2, token ? token : "NULL");

    int passed = 1;
    if (in_proc_2 != 0) {
        printf("  ❌ FAIL: Token still visible in /proc/self/environ\n");
        passed = 0;
    }
    if (token == NULL || strcmp(token, "sk-test-key-456") != 0) {
        printf("  ❌ FAIL: getenv() did not return correct cached value\n");
        passed = 0;
    }

    if (passed) {
        printf("  ✅ PASS: Token cleared from /proc/self/environ\n");
    }

    return passed;
}

int test_anthropic_api_key() {
    print_test_header("ANTHROPIC_API_KEY");

    setenv("ANTHROPIC_API_KEY", "sk-ant-test-789", 1);
    int in_proc_1 = check_in_proc_environ("ANTHROPIC_API_KEY");
    print_result("1. After setenv", in_proc_1, "not NULL");

    char *token = getenv("ANTHROPIC_API_KEY");
    int in_proc_2 = check_in_proc_environ("ANTHROPIC_API_KEY");
    print_result("2. After getenv", in_proc_2, token ? token : "NULL");

    int passed = 1;
    if (in_proc_2 != 0) {
        printf("  ❌ FAIL: Token still visible in /proc/self/environ\n");
        passed = 0;
    }
    if (token == NULL || strcmp(token, "sk-ant-test-789") != 0) {
        printf("  ❌ FAIL: getenv() did not return correct cached value\n");
        passed = 0;
    }

    if (passed) {
        printf("  ✅ PASS: Token cleared from /proc/self/environ\n");
    }

    return passed;
}

int test_non_sensitive_var() {
    print_test_header("NON_SENSITIVE_VAR (should remain visible)");

    setenv("NON_SENSITIVE_VAR", "public_value", 1);
    int in_proc_1 = check_in_proc_environ("NON_SENSITIVE_VAR");
    print_result("1. After setenv", in_proc_1, "not NULL");

    char *val = getenv("NON_SENSITIVE_VAR");
    int in_proc_2 = check_in_proc_environ("NON_SENSITIVE_VAR");
    print_result("2. After getenv", in_proc_2, val ? val : "NULL");

    int passed = 1;
    if (in_proc_2 != 1) {
        printf("  ❌ FAIL: Non-sensitive variable was incorrectly cleared\n");
        passed = 0;
    }
    if (val == NULL || strcmp(val, "public_value") != 0) {
        printf("  ❌ FAIL: getenv() did not return correct value\n");
        passed = 0;
    }

    if (passed) {
        printf("  ✅ PASS: Non-sensitive variable remains visible\n");
    }

    return passed;
}

int main() {
    printf("================================================================================\n");
    printf("Test Suite: Verify tokens are removed from /proc/self/environ\n");
    printf("================================================================================\n");
    printf("\n");
    printf("This test verifies that sensitive tokens are removed from /proc/self/environ\n");
    printf("after being accessed via getenv(), while still being available through the\n");
    printf("cached value returned by subsequent getenv() calls.\n");

    int total_tests = 0;
    int passed_tests = 0;

    // Run tests
    total_tests++; passed_tests += test_github_token();
    total_tests++; passed_tests += test_openai_api_key();
    total_tests++; passed_tests += test_anthropic_api_key();
    total_tests++; passed_tests += test_non_sensitive_var();

    // Summary
    printf("\n");
    printf("================================================================================\n");
    printf("SUMMARY: %d/%d tests passed\n", passed_tests, total_tests);
    printf("================================================================================\n");

    return (passed_tests == total_tests) ? 0 : 1;
}
