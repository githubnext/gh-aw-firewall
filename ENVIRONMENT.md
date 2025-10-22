# Environment Variables

## Usage

```bash
# Pass specific variables
awf -e MY_API_KEY=secret 'command'

# Pass multiple variables
awf -e FOO=1 -e BAR=2 'command'

# Pass all host variables (development only)
awf --env-all 'command'
```

## Default Behavior

When using `sudo -E`, these host variables are automatically passed: `GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_PERSONAL_ACCESS_TOKEN`, `USER`, `TERM`, `HOME`, `XDG_CONFIG_HOME`.

The following are always set/overridden: `HTTP_PROXY`, `HTTPS_PROXY` (Squid proxy), `PATH`, `DOCKER_HOST`, `DOCKER_CONTEXT` (container values).

Variables from `--env` flags override everything else.

## Security Warning: `--env-all`

Using `--env-all` passes all host environment variables to the container, which creates security risks:

1. **Credential Exposure**: All variables (API keys, tokens, passwords) are written to `/tmp/awf-<timestamp>/docker-compose.yml` in plaintext
2. **Log Leakage**: Sharing logs or debug output exposes sensitive credentials
3. **Unnecessary Access**: Extra variables increase attack surface (violates least privilege)
4. **Accidental Sharing**: Easy to forget what's in your environment when sharing commands

**Excluded variables** (even with `--env-all`): `PATH`, `DOCKER_HOST`, `DOCKER_CONTEXT`, `DOCKER_CONFIG`, `PWD`, `OLDPWD`, `SHLVL`, `_`, `SUDO_*`

## Best Practices

✅ **Use `--env` for specific variables:**
```bash
sudo awf --allow-domains github.com -e MY_API_KEY="$MY_API_KEY" 'command'
```

✅ **Use `sudo -E` for auth tokens:**
```bash
sudo -E awf --allow-domains github.com 'copilot --prompt "..."'
```

⚠️ **Use `--env-all` only in trusted local development** (never in production/CI/CD)

❌ **Avoid `--env-all` when:**
- Sharing logs or configs
- Working with untrusted code
- In production/CI environments

## Troubleshooting

**Variable not accessible:** Use `sudo -E` or pass explicitly with `--env VAR="$VAR"`

**Variable empty:** Check if it's in the excluded list or wasn't exported on host (`export VAR=value`)
