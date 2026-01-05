## GitHub CLI Usage

This shared module provides guidance for using the GitHub CLI (`gh`) tool within agentic workflows.

### Basic Commands

```bash
# List issues
gh issue list --limit 10

# Get issue details
gh issue view <number>

# List pull requests
gh pr list --limit 10

# Get PR details
gh pr view <number>
```

### Authentication

The workflow environment automatically provides GitHub authentication via `GITHUB_TOKEN`. No additional configuration is required.

### Best Practices

1. **Use `--limit`**: Always limit results to avoid excessive output
2. **Use JSON output**: For programmatic parsing, use `--json` flag
3. **Check status**: Verify command success before proceeding

### Example Patterns

```bash
# Get recent PRs in JSON format
gh pr list --limit 5 --json number,title,state

# Search issues by label
gh issue list --label "bug" --limit 10

# Get repository info
gh repo view --json name,description,stargazerCount
```
