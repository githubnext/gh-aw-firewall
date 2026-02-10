#include <stdio.h>
#include <stdlib.h>

int main(void) {
    fprintf(stderr, "=== Testing normal mode ===\n");
    const char *token1 = getenv("GITHUB_TOKEN");
    printf("First read: [%s]\n", token1 ? token1 : "NULL");

    const char *token2 = getenv("GITHUB_TOKEN");
    printf("Second read: [%s]\n", token2 ? token2 : "NULL");

    const char *token3 = getenv("GITHUB_TOKEN");
    printf("Third read: [%s]\n", token3 ? token3 : "NULL");

    return 0;
}
