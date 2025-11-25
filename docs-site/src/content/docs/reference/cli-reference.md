---
title: CLI Reference
description: Complete reference for all command-line options and arguments for the awf firewall tool.
---

Complete reference for the `awf` command-line interface.

## Synopsis

```bash
awf [options] -- <command>
```

The `awf` command creates an isolated Docker environment with network firewall rules that restrict outbound HTTP/HTTPS traffic to whitelisted domains only.

:::caution[Requires sudo]
The firewall manipulates iptables rules and requires root privileges. Always run with `sudo` or `sudo -E` (to preserve environment variables).
:::

## Basic Examples

```bash
# Simple HTTP request
sudo awf --allow-domains github.com -- curl https://api.github.com

# With environment variables preserved
sudo -E awf --allow-domains github.com -- 'echo $HOME'

# Running GitHub Copilot CLI
sudo -E awf \
  --allow-domains github.com,api.github.com \
  -- npx @github/copilot@latest --prompt "your prompt"
```

## Command Argument

The command and its arguments must be specified after the `--` separator.

### Single vs Multiple Arguments

**Single argument (quoted command):**
```bash
# Shell variables expand in container, not on host
sudo awf --allow-domains github.com -- 'echo $HOME && pwd'
```

**Multiple arguments:**
```bash
# Each argument is shell-escaped automatically
sudo awf --allow-domains github.com -- curl -H "Auth: token" https://api.github.com
```

:::tip[When to quote]
Use quotes when your command contains shell operators (`&&`, `||`, `|`, `>`, `<`) or variables (`$VAR`) that should expand in the container, not on the host.
:::

## Options

### Domain Whitelisting

#### `--allow-domains <domains>`

Comma-separated list of allowed domains.

- **Type**: String (comma-separated)
- **Required**: Yes (unless `--allow-domains-file` is provided)
- **Example**: `--allow-domains github.com,api.github.com`

Domains automatically match all subdomains:
- `github.com` matches `api.github.com`, `raw.githubusercontent.com`, etc.
- Domains are normalized: case-insensitive, protocols and trailing slashes removed

**Examples:**
```bash
# Single domain
sudo awf --allow-domains github.com -- curl https://api.github.com

# Multiple domains
sudo awf --allow-domains github.com,npmjs.org,googleapis.com -- curl https://api.github.com
```

:::note
Domain matching is case-insensitive and automatically includes all subdomains. You don't need to specify `api.github.com` if you've already whitelisted `github.com`.
:::

#### `--allow-domains-file <path>`

Path to file containing allowed domains.

- **Type**: String (file path)
- **Required**: Yes (unless `--allow-domains` is provided)
- **Example**: `--allow-domains-file /path/to/domains.txt`

**File format:**
- One domain per line or comma-separated
- Comments start with `#` (full line or inline)
- Empty lines are ignored
- Whitespace is automatically trimmed

**Example file:**
```text
# GitHub domains
github.com
api.github.com

# NPM registry
npmjs.org, registry.npmjs.org

# Example with inline comment
example.com # Example domain
```

**Usage:**
```bash
sudo awf --allow-domains-file allowed-domains.txt -- curl https://api.github.com
```

**Combining both:**
```bash
# Domains from both sources are merged
sudo awf \
  --allow-domains github.com \
  --allow-domains-file additional-domains.txt \
  -- curl https://api.github.com
```

### Logging

#### `--log-level <level>`

Set logging verbosity.

- **Type**: String
- **Options**: `debug`, `info`, `warn`, `error`
- **Default**: `info`
- **Example**: `--log-level debug`

**Log levels:**
- `debug`: Detailed information including config, container startup, iptables rules
- `info`: Normal operational messages (default)
- `warn`: Warning messages
- `error`: Error messages only

**Usage:**
```bash
# Debug mode for troubleshooting
sudo awf --allow-domains github.com --log-level debug -- curl https://api.github.com

# Quiet mode (errors only)
sudo awf --allow-domains github.com --log-level error -- curl https://api.github.com
```

:::tip[Debugging Blocked Domains]
Use `--log-level debug` to see the normalized domain list and detailed traffic logs when debugging connection issues.
:::

### Container Management

#### `--keep-containers`

Keep containers and configuration files after command exits.

- **Type**: Boolean flag
- **Default**: `false`
- **Example**: `--keep-containers`

When enabled:
- Containers remain running after command completes
- Configuration files preserved in work directory
- Log files remain in work directory
- Host iptables rules remain active

**Usage:**
```bash
# Keep containers for inspection
sudo awf --allow-domains github.com --keep-containers -- curl https://api.github.com

# Inspect logs after execution
cat /tmp/awf-*/squid-logs/access.log
docker logs awf-squid
docker logs awf-copilot

# Manual cleanup when done
docker stop awf-squid awf-copilot
docker network rm awf-net
```

:::caution[Manual Cleanup Required]
With `--keep-containers`, you must manually stop containers and remove the network:
```bash
docker stop awf-squid awf-copilot
docker network rm awf-net
```
:::

#### `--tty`

Allocate a pseudo-TTY for the container.

- **Type**: Boolean flag
- **Default**: `false`
- **Example**: `--tty`

Required for interactive tools that expect terminal input/output (e.g., Claude Code, interactive shells).

**Usage:**
```bash
# For interactive tools
sudo awf --allow-domains anthropic.com --tty -- claude-code

# Not needed for non-interactive commands
sudo awf --allow-domains github.com -- curl https://api.github.com
```

:::note
Most commands don't need `--tty`. Only use it for interactive tools that display prompts or expect user input.
:::

#### `--work-dir <dir>`

Working directory for temporary files.

- **Type**: String (directory path)
- **Default**: `/tmp/awf-<timestamp>`
- **Example**: `--work-dir /tmp/my-awf-workspace`

The work directory contains:
- `squid.conf` - Generated Squid proxy configuration
- `docker-compose.yml` - Generated Docker Compose configuration
- `copilot-logs/` - Copilot CLI logs (if created)
- `squid-logs/` - Squid proxy logs (if created)

**Usage:**
```bash
# Use specific work directory
sudo awf --allow-domains github.com --work-dir /tmp/my-workspace -- curl https://api.github.com

# Inspect generated configs
cat /tmp/my-workspace/squid.conf
cat /tmp/my-workspace/docker-compose.yml
```

### Container Images

#### `--build-local`

Build containers locally instead of using pre-built GHCR images.

- **Type**: Boolean flag
- **Default**: `false`
- **Example**: `--build-local`

**Usage:**
```bash
# Build containers from local Dockerfiles
sudo awf --allow-domains github.com --build-local -- curl https://api.github.com
```

:::tip[Development Mode]
Use `--build-local` when developing the firewall itself to test local changes to container images.
:::

#### `--image-registry <registry>`

Container image registry to pull images from.

- **Type**: String (registry URL)
- **Default**: `ghcr.io/githubnext/gh-aw-firewall`
- **Example**: `--image-registry my-registry.example.com/awf`

**Usage:**
```bash
# Use custom registry
sudo awf \
  --allow-domains github.com \
  --image-registry my-registry.example.com/awf \
  -- curl https://api.github.com
```

#### `--image-tag <tag>`

Container image tag to use.

- **Type**: String (tag name)
- **Default**: `latest`
- **Example**: `--image-tag v0.4.0`

**Usage:**
```bash
# Use specific version
sudo awf \
  --allow-domains github.com \
  --image-tag v0.4.0 \
  -- curl https://api.github.com
```

### Environment Variables

#### `-e, --env <KEY=VALUE>`

Pass additional environment variables to the container.

- **Type**: String in `KEY=VALUE` format
- **Repeatable**: Yes (specify multiple times)
- **Default**: `[]` (empty array)
- **Example**: `-e MY_VAR=value -e ANOTHER=123`

**Usage:**
```bash
# Single environment variable
sudo awf --allow-domains github.com -e DEBUG=true -- curl https://api.github.com

# Multiple environment variables
sudo awf \
  --allow-domains github.com \
  -e API_KEY=secret \
  -e REGION=us-west \
  -- 'echo $API_KEY'
```

:::tip[Preserving Host Variables]
To pass host environment variables, use `sudo -E` and then reference them in `-e`:
```bash
export MY_TOKEN="secret123"
sudo -E awf --allow-domains github.com -e MY_TOKEN=$MY_TOKEN -- 'echo $MY_TOKEN'
```
:::

#### `--env-all`

Pass all host environment variables to the container.

- **Type**: Boolean flag
- **Default**: `false`
- **Example**: `--env-all`

Excludes system variables like `PATH`, `DOCKER_HOST` that could cause conflicts.

**Usage:**
```bash
# Pass all environment variables
sudo -E awf --allow-domains github.com --env-all -- env
```

:::danger[Security Risk]
Using `--env-all` may expose sensitive credentials in logs or configurations. Use `-e` to pass specific variables instead when possible.
:::

### Volume Mounts

#### `-v, --mount <host_path:container_path[:mode]>`

Mount host directories or files into the container.

- **Type**: String in `host_path:container_path[:mode]` format
- **Repeatable**: Yes (specify multiple times)
- **Default**: `[]` (empty array)
- **Example**: `-v /data:/data:ro -v /tmp/output:/output:rw`

**Format:**
- `host_path`: Absolute path on host (must exist)
- `container_path`: Absolute path in container
- `mode`: Optional - `ro` (read-only) or `rw` (read-write)

**Validation:**
- Both paths must be absolute (start with `/`)
- Host path must exist
- Mode must be `ro` or `rw` if specified

**Usage:**
```bash
# Mount directory read-only
sudo awf --allow-domains github.com -v /data:/data:ro -- ls /data

# Mount directory read-write
sudo awf --allow-domains github.com -v /tmp/output:/output:rw -- touch /output/test.txt

# Multiple mounts
sudo awf \
  --allow-domains github.com \
  -v /data:/data:ro \
  -v /tmp/output:/output:rw \
  -- ls /data /output
```

:::note[Default Mounts]
The firewall automatically mounts:
- Host filesystem at `/host` (read-only)
- User home directory at the same path (read-write)
- Docker socket at `/var/run/docker.sock` (for Docker-in-Docker)

Additional mounts via `-v` are added to these default mounts.
:::

#### `--container-workdir <dir>`

Set the working directory inside the container.

- **Type**: String (directory path)
- **Default**: Home directory of the user running the command
- **Example**: `--container-workdir /workspace`

**Usage:**
```bash
# Set container working directory
sudo awf \
  --allow-domains github.com \
  --container-workdir /workspace \
  -- pwd
```

:::tip[GitHub Actions Path Consistency]
In GitHub Actions, set to `$GITHUB_WORKSPACE` to maintain path consistency:
```yaml
- run: |
    sudo -E awf \
      --allow-domains github.com \
      --container-workdir $GITHUB_WORKSPACE \
      -- npm test
```
:::

## Exit Codes

The firewall propagates the exit code from the wrapped command:

- `0`: Command succeeded
- `1-255`: Command exit code (or firewall error)
- `130`: Interrupted by SIGINT (Ctrl+C)
- `143`: Terminated by SIGTERM

**Example:**
```bash
# Command succeeds (exit 0)
sudo awf --allow-domains github.com -- curl https://api.github.com
echo $?  # Outputs: 0

# Command fails (exit non-zero)
sudo awf --allow-domains github.com -- curl https://nonexistent.invalid
echo $?  # Outputs: non-zero (curl's exit code)
```

## Common Usage Patterns

### Basic HTTP Request

```bash
sudo awf --allow-domains github.com -- curl https://api.github.com/zen
```

### GitHub Copilot CLI

```bash
export GITHUB_TOKEN="your_token"
sudo -E awf \
  --allow-domains github.com,api.github.com,githubusercontent.com,googleapis.com,api.enterprise.githubcopilot.com \
  -- npx @github/copilot@latest --prompt "List my repositories"
```

:::tip[Preserving Environment Variables]
Use `sudo -E` instead of just `sudo` to preserve environment variables like `GITHUB_TOKEN`.
:::

### Docker-in-Docker

```bash
# Spawned containers inherit firewall restrictions
sudo awf \
  --allow-domains api.github.com,registry-1.docker.io,auth.docker.io \
  -- docker run --rm curlimages/curl -fsS https://api.github.com/zen
```

### Using Domains File

```bash
# Create domains file
cat > domains.txt << 'EOF'
# GitHub
github.com
githubusercontent.com

# NPM
npmjs.org
EOF

# Use the file
sudo awf --allow-domains-file domains.txt -- npm install
```

### Custom Environment and Mounts

```bash
sudo awf \
  --allow-domains github.com \
  -e API_KEY=secret123 \
  -e DEBUG=true \
  -v /data:/data:ro \
  -v /tmp/output:/output:rw \
  -- 'curl -H "X-API-Key: $API_KEY" https://api.github.com > /output/result.json'
```

### Debugging with Keep Containers

```bash
# Run with containers preserved
sudo awf \
  --allow-domains github.com \
  --keep-containers \
  --log-level debug \
  -- curl https://api.github.com

# Inspect logs after execution
docker logs awf-squid
docker logs awf-copilot
cat /tmp/awf-*/squid-logs/access.log

# Clean up manually when done
docker stop awf-squid awf-copilot
docker network rm awf-net
```

## Troubleshooting

### Common Errors

#### "No command specified"

**Error:**
```
Error: No command specified. Use -- to separate command from options.
Example: awf --allow-domains github.com -- curl https://api.github.com
```

**Cause**: Missing `--` separator before the command.

**Solution**: Always use `--` to separate options from the command:
```bash
# Wrong
sudo awf --allow-domains github.com curl https://api.github.com

# Correct
sudo awf --allow-domains github.com -- curl https://api.github.com
```

#### "At least one domain must be specified"

**Error:**
```
At least one domain must be specified with --allow-domains or --allow-domains-file
```

**Cause**: Neither `--allow-domains` nor `--allow-domains-file` was provided.

**Solution**: Specify at least one domain:
```bash
sudo awf --allow-domains github.com -- curl https://api.github.com
```

#### "Invalid environment variable format"

**Error:**
```
Invalid environment variable format: MYVAR (expected KEY=VALUE)
```

**Cause**: Environment variable not in `KEY=VALUE` format.

**Solution**: Use proper format:
```bash
# Wrong
sudo awf -e MYVAR -- command

# Correct
sudo awf -e MYVAR=value -- command
```

#### "Invalid volume mount"

**Error:**
```
Invalid volume mount: /data
Reason: Mount must be in format host_path:container_path[:mode]
```

**Cause**: Volume mount not in correct format.

**Solution**: Use `host_path:container_path[:mode]` format:
```bash
# Wrong
sudo awf -v /data -- command

# Correct
sudo awf -v /data:/data:ro -- command
```

#### "Host path must be absolute"

**Error:**
```
Invalid volume mount: data:/data
Reason: Host path must be absolute (start with /)
```

**Cause**: Relative path used for host path.

**Solution**: Use absolute paths:
```bash
# Wrong
sudo awf -v data:/data -- command

# Correct
sudo awf -v /home/user/data:/data -- command
```

#### "Host path does not exist"

**Error:**
```
Invalid volume mount: /nonexistent:/data
Reason: Host path does not exist: /nonexistent
```

**Cause**: Host path doesn't exist.

**Solution**: Create the directory first or verify the path:
```bash
mkdir -p /home/user/data
sudo awf -v /home/user/data:/data -- command
```

### Connection Issues

#### Domain Blocked But Should Be Allowed

**Symptoms**: Connection fails even though domain is in `--allow-domains`.

**Diagnosis:**
```bash
# Check Squid logs for blocked domains
sudo cat /tmp/squid-logs-*/access.log | grep TCP_DENIED
```

**Common causes:**

1. **Subdomain mismatch**: Verify the base domain is whitelisted
   ```bash
   # ✗ Whitelisted api.github.com but accessing raw.githubusercontent.com
   sudo awf --allow-domains api.github.com -- curl https://raw.githubusercontent.com/...

   # ✓ Whitelist the base domain
   sudo awf --allow-domains githubusercontent.com -- curl https://raw.githubusercontent.com/...
   ```

2. **IP-based access**: Firewall blocks direct IP connections
   ```bash
   # ✗ Using IP address
   sudo awf --allow-domains github.com -- curl https://140.82.121.3

   # ✓ Use domain name
   sudo awf --allow-domains github.com -- curl https://api.github.com
   ```

3. **Typo in domain**: Check for spelling errors
   ```bash
   # Use debug mode to see normalized domains
   sudo awf --allow-domains github.com --log-level debug -- curl https://api.github.com
   ```

## Environment Variables

The firewall recognizes these environment variables when passed via `-e` or `--env-all`:

### GitHub Tokens

- `GITHUB_TOKEN`: GitHub Copilot CLI authentication token
- `GITHUB_PERSONAL_ACCESS_TOKEN`: GitHub MCP server authentication token

**Usage:**
```bash
export GITHUB_TOKEN="your_copilot_token"
export GITHUB_PERSONAL_ACCESS_TOKEN="your_github_pat"

sudo -E awf \
  --allow-domains github.com \
  -e GITHUB_TOKEN=$GITHUB_TOKEN \
  -e GITHUB_PERSONAL_ACCESS_TOKEN=$GITHUB_PERSONAL_ACCESS_TOKEN \
  -- npx @github/copilot@latest --prompt "your prompt"
```

### GitHub Actions Variables

When running in GitHub Actions, use `--container-workdir` for path consistency:

```yaml
- name: Run with firewall
  env:
    GITHUB_TOKEN: ${{ secrets.COPILOT_CLI_TOKEN }}
  run: |
    sudo -E awf \
      --allow-domains github.com \
      --container-workdir $GITHUB_WORKSPACE \
      -e GITHUB_TOKEN=$GITHUB_TOKEN \
      -- npm test
```

## Version Information

```bash
# Display version
awf --version

# Display help
awf --help
```

## See Also

- [Architecture](/gh-aw-firewall/reference/architecture) - How the firewall works internally
- [Troubleshooting](/gh-aw-firewall/troubleshooting) - Common issues and solutions
