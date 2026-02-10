#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main() {
    /* Test that secure_getenv interception works */
    setenv("GITHUB_TOKEN", "test-token-123", 1);
    
    /* First call to secure_getenv should return the value */
    char *first = secure_getenv("GITHUB_TOKEN");
    printf("First secure_getenv: %s\n", first ? first : "NULL");
    
    /* Second call should return NULL (token was cleared) */
    char *second = secure_getenv("GITHUB_TOKEN");
    printf("Second secure_getenv: %s\n", second ? second : "NULL");
    
    /* Verify behavior */
    if (first != NULL && strcmp(first, "test-token-123") == 0 && second == NULL) {
        printf("SUCCESS: secure_getenv one-shot token protection works\n");
        return 0;
    } else {
        printf("FAIL: secure_getenv behavior incorrect\n");
        return 1;
    }
}
