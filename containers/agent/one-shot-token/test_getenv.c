#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main() {
    /* Test that getenv interception works */
    setenv("GITHUB_TOKEN", "test-token-123", 1);
    
    /* First call to getenv should return the value */
    char *first = getenv("GITHUB_TOKEN");
    printf("First getenv: %s\n", first ? first : "NULL");
    
    /* Second call should return NULL (token was cleared) */
    char *second = getenv("GITHUB_TOKEN");
    printf("Second getenv: %s\n", second ? second : "NULL");
    
    /* Verify behavior */
    if (first != NULL && strcmp(first, "test-token-123") == 0 && second == NULL) {
        printf("SUCCESS: getenv one-shot token protection works\n");
        return 0;
    } else {
        printf("FAIL: getenv behavior incorrect\n");
        return 1;
    }
}
