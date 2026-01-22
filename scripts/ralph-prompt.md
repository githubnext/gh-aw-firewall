# CI Status Check for PR #356

Check the CI status for PR #356 in the gh-aw-firewall repo.

## Instructions

1. Run: `gh pr checks 356 --json name,state,workflow`

2. Focus on the "Smoke Copilot" workflow - look for entries where workflow="Smoke Copilot"

## Response Rules

### If ALL Smoke Copilot jobs show state="SUCCESS":
Output exactly:
```
<promise>COMPLETE</promise>
```

### If ANY Smoke Copilot job shows state="FAILURE":
1. Get the workflow run: `gh run list --workflow="Smoke Copilot" --limit 1 --json databaseId`
2. Fetch failed logs with `gh run view <run-id> --log-failed`
3. Report what went wrong concisely

### If jobs are still "PENDING" or "IN_PROGRESS":
Report current status and which jobs are still running.
