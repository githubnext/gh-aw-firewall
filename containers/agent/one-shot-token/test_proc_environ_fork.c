/**
 * Test: Verify that sensitive tokens are removed from /proc/PID/environ
 *
 * This test verifies that after accessing a sensitive token via getenv(),
 * the token is no longer visible in /proc/PID/environ when read by another
 * process (simulating an attacker inspecting this process's environment).
 *
 * Build:
 *   gcc -o test_proc_environ_fork test_proc_environ_fork.c
 *
 * Run with one-shot-token library:
 *   LD_PRELOAD=./one-shot-token-c.so ./test_proc_environ_fork
 *   or
 *   LD_PRELOAD=./target/debug/libone_shot_token.so ./test_proc_environ_fork
 */

#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/types.h>
#include <sys/wait.h>

/**
 * Read /proc/PID/environ and check if a variable exists
 * This simulates another process reading this process's environment
 */
int check_in_proc_pid_environ(pid_t pid, const char *var_name) {
    char path[256];
    snprintf(path, sizeof(path), "/proc/%d/environ", pid);

    int fd = open(path, O_RDONLY);
    if (fd < 0) {
        perror("Failed to open /proc/PID/environ");
        return -1;
    }

    // Read the entire environ file
    char buffer[65536];
    ssize_t bytes_read = read(fd, buffer, sizeof(buffer) - 1);
    close(fd);

    if (bytes_read < 0) {
        perror("Failed to read /proc/PID/environ");
        return -1;
    }

    buffer[bytes_read] = '\0';

    // /proc/PID/environ contains null-separated strings
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
            // Print the value for debugging
            char *value = buffer + pos + var_name_len + 1;
            size_t value_len = strlen(value);
            if (value_len > 10) {
                printf("      [Found in /proc: %s=%.8s...]\n", var_name, value);
            } else {
                printf("      [Found in /proc: %s=%s]\n", var_name, value);
            }
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

/**
 * Fork a child process that checks /proc/parent_pid/environ
 * This simulates an external process inspecting our environment
 */
int check_from_child(pid_t parent_pid, const char *var_name) {
    pid_t child = fork();
    if (child < 0) {
        perror("Fork failed");
        return -1;
    }

    if (child == 0) {
        // Child process - check parent's environ
        int result = check_in_proc_pid_environ(parent_pid, var_name);
        exit(result);
    } else {
        // Parent process - wait for child
        int status;
        waitpid(child, &status, 0);
        if (WIFEXITED(status)) {
            return WEXITSTATUS(status);
        }
        return -1;
    }
}

void print_test_header(const char *test_name) {
    printf("\n");
    printf("========================================\n");
    printf("TEST: %s\n", test_name);
    printf("========================================\n");
}

void print_check(const char *step, int in_proc, const char *getenv_result) {
    printf("  %-40s | /proc: %-3s | getenv: %s\n",
           step,
           in_proc == 1 ? "YES" : (in_proc == 0 ? "NO" : "ERR"),
           getenv_result ? getenv_result : "NULL");
}

int test_token(const char *token_name, const char *token_value) {
    print_test_header(token_name);

    pid_t my_pid = getpid();

    // 1. Set the token
    setenv(token_name, token_value, 1);
    usleep(10000); // Small delay for filesystem sync
    int in_proc_1 = check_from_child(my_pid, token_name);
    char *val_1 = getenv(token_name);
    print_check("1. After setenv", in_proc_1, val_1 ? "set" : "NULL");

    // 2. First access (should trigger caching and clearing)
    printf("  [Calling getenv(\"%s\")...]\n", token_name);
    char *token = getenv(token_name);
    usleep(10000); // Small delay for filesystem sync
    int in_proc_2 = check_from_child(my_pid, token_name);
    print_check("2. After first getenv", in_proc_2, token ? token : "NULL");

    // 3. Second access (should return cached value)
    token = getenv(token_name);
    usleep(10000); // Small delay for filesystem sync
    int in_proc_3 = check_from_child(my_pid, token_name);
    print_check("3. After second getenv", in_proc_3, token ? token : "NULL");

    // Verify expectations
    int passed = 1;
    if (in_proc_2 != 0) {
        printf("  ❌ FAIL: Token still in /proc/%d/environ after first access\n", my_pid);
        passed = 0;
    }
    if (in_proc_3 != 0) {
        printf("  ❌ FAIL: Token still in /proc/%d/environ after second access\n", my_pid);
        passed = 0;
    }
    if (token == NULL || strcmp(token, token_value) != 0) {
        printf("  ❌ FAIL: getenv() did not return correct cached value\n");
        passed = 0;
    }

    if (passed) {
        printf("  ✅ PASS: Token cleared from /proc/%d/environ but getenv() still works\n", my_pid);
    }

    return passed;
}

int test_non_sensitive() {
    print_test_header("NON_SENSITIVE_VAR (should remain visible)");

    pid_t my_pid = getpid();

    setenv("NON_SENSITIVE_VAR", "public_value_123", 1);
    usleep(10000);
    int in_proc_1 = check_from_child(my_pid, "NON_SENSITIVE_VAR");
    print_check("1. After setenv", in_proc_1, "set");

    char *val = getenv("NON_SENSITIVE_VAR");
    usleep(10000);
    int in_proc_2 = check_from_child(my_pid, "NON_SENSITIVE_VAR");
    print_check("2. After getenv", in_proc_2, val ? val : "NULL");

    int passed = 1;
    if (in_proc_2 != 1) {
        printf("  ❌ FAIL: Non-sensitive variable was incorrectly cleared\n");
        passed = 0;
    }
    if (val == NULL || strcmp(val, "public_value_123") != 0) {
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
    printf("Test Suite: /proc/PID/environ clearing verification\n");
    printf("================================================================================\n");
    printf("\n");
    printf("This test verifies that sensitive tokens are removed from /proc/PID/environ\n");
    printf("(as viewed by other processes) after being accessed via getenv(), while\n");
    printf("still being available through cached getenv() calls.\n");
    printf("\n");
    printf("Current PID: %d\n", getpid());

    int total_tests = 0;
    int passed_tests = 0;

    // Run tests
    total_tests++; passed_tests += test_token("GITHUB_TOKEN", "ghp_test_secret_12345");
    total_tests++; passed_tests += test_token("OPENAI_API_KEY", "sk-test-key-67890");
    total_tests++; passed_tests += test_token("ANTHROPIC_API_KEY", "sk-ant-test-abcde");
    total_tests++; passed_tests += test_token("CODEX_API_KEY", "codex-test-fghij");
    total_tests++; passed_tests += test_non_sensitive();

    // Summary
    printf("\n");
    printf("================================================================================\n");
    if (passed_tests == total_tests) {
        printf("✅ ALL TESTS PASSED: %d/%d\n", passed_tests, total_tests);
    } else {
        printf("❌ SOME TESTS FAILED: %d/%d passed\n", passed_tests, total_tests);
    }
    printf("================================================================================\n");

    return (passed_tests == total_tests) ? 0 : 1;
}
