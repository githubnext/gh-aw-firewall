# CI Status Check for PR #356

Check the CI status for PR #356 in the gh-aw-firewall repo.

## Instructions

1. Run: `gh pr checks 356 --json name,conclusion,status`

2. Focus on the "Smoke Copilot" workflow jobs:
   - agent
   - detection
   - safe_outputs
   - conclusion

## Response Rules

### If ALL Smoke Copilot jobs show "SUCCESS":
Output exactly:
```
<promise>COMPLETE</promise>
```

### If ANY Smoke Copilot job shows "FAILURE":
1. Get the run ID from the checks
2. Fetch logs with `gh run view <run-id> --log-failed`
3. Report what went wrong concisely

### If jobs are still "PENDING" or "IN_PROGRESS":
Report current status and which jobs are still running.
