---
title: Environment Variables
description: Managing environment variables with the firewall
---

## Usage

```bash
# Pass specific variables
sudo -E awf --allow-domains github.com -- bash -c 'echo $MY_VAR'

# With Copilot CLI
export GITHUB_TOKEN="your_token"
sudo -E awf --allow-domains github.com -- copilot --help
```

## Default Behavior

When using `sudo -E`, these host variables are automatically passed:
- `GITHUB_TOKEN`
- `GH_TOKEN`
- `GITHUB_PERSONAL_ACCESS_TOKEN`
- `USER`
- `TERM`
- `HOME`
- `XDG_CONFIG_HOME`

The following are always set/overridden in the container:
- `HTTP_PROXY`, `HTTPS_PROXY` - Point to Squid proxy
- `PATH` - Container's PATH
- `DOCKER_HOST`, `DOCKER_CONTEXT` - Container values

## Preserving Environment Variables

Use `sudo -E` to preserve environment variables:

```bash
export MY_API_KEY="secret"
export GITHUB_TOKEN="token"

sudo -E awf --allow-domains github.com -- your-command
```

## GitHub Actions

In GitHub Actions, environment variables are automatically available:

```yaml
- name: Run with env vars
  env:
    GITHUB_TOKEN: ${{ secrets.COPILOT_TOKEN }}
    MY_VAR: "value"
  run: |
    awf --allow-domains github.com -- your-command
```

## Security Considerations

:::caution[Sensitive Data]
Be careful when passing sensitive environment variables. The firewall containers inherit these variables.
:::

- Only pass necessary variables
- Use `sudo -E` selectively
- Review logs for leaked credentials before sharing
