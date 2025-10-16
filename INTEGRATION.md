# Integration Guide for scout.yml

This guide shows how to integrate the firewall wrapper into your existing scout.yml workflow.

## Current Setup (Lines 820-1067)

Your scout.yml currently has manual Squid proxy configuration for arxiv and context7 MCP servers. This can be simplified using the firewall wrapper.

## Migration Steps

### Step 1: Add Wrapper Installation

Add this step before executing the Copilot CLI:

```yaml
- name: Install Firewall Wrapper
  run: |
    # Clone firewall wrapper repo
    git clone https://github.com/github/firewall-wrapper.git /tmp/firewall-wrapper
    cd /tmp/firewall-wrapper
    npm install
    npm run build
    npm link
    echo "Firewall wrapper installed"
```

### Step 2: Collect All Required Domains

From your scout.yml MCP configuration, these domains are needed:

```yaml
# MCP Servers and their domains:
# - arxiv: arxiv.org
# - context7: mcp.context7.com
# - deepwiki: mcp.deepwiki.com
# - github: api.github.com, github.com, githubusercontent.com
# - microsoftdocs: learn.microsoft.com
# - tavily: mcp.tavily.com

ALLOWED_DOMAINS: >-
  github.com,
  api.github.com,
  githubusercontent.com,
  githubassets.com,
  arxiv.org,
  mcp.context7.com,
  mcp.deepwiki.com,
  learn.microsoft.com,
  mcp.tavily.com
```

### Step 3: Replace Copilot Execution Step

**Before:**
```yaml
- name: Setup Proxy Configuration for MCP Network Restrictions
  run: |
    # 200+ lines of manual proxy setup...

- name: Start Squid proxy
  run: |
    # Manual docker-compose and iptables...

- name: Execute GitHub Copilot CLI
  run: |
    copilot --add-dir /tmp/gh-aw/ --log-level all ...
```

**After:**
```yaml
- name: Execute GitHub Copilot CLI with Firewall
  run: |
    firewall-wrapper \
      --allow-domains github.com,api.github.com,githubusercontent.com,githubassets.com,arxiv.org,mcp.context7.com,mcp.deepwiki.com,learn.microsoft.com,mcp.tavily.com \
      --log-level info \
      'copilot --add-dir /tmp/gh-aw/ --log-level all --log-dir /tmp/gh-aw/.copilot/logs/ --allow-tool "github(*)" --allow-tool safe_outputs --prompt "$COPILOT_CLI_INSTRUCTION"'
  env:
    COPILOT_AGENT_RUNNER_TYPE: STANDALONE
    GITHUB_AW_MCP_CONFIG: /home/runner/.copilot/mcp-config.json
    GITHUB_AW_PROMPT: /tmp/gh-aw/aw-prompts/prompt.txt
    GITHUB_AW_SAFE_OUTPUTS: ${{ env.GITHUB_AW_SAFE_OUTPUTS }}
    GITHUB_AW_SAFE_OUTPUTS_CONFIG: "{\"create_discussion\":{\"max\":1},\"missing_tool\":{}}"
    GITHUB_PERSONAL_ACCESS_TOKEN: ${{ secrets.GH_AW_GITHUB_TOKEN || secrets.GITHUB_TOKEN }}
    GITHUB_STEP_SUMMARY: ${{ env.GITHUB_STEP_SUMMARY }}
    GITHUB_TOKEN: ${{ secrets.COPILOT_CLI_TOKEN }}
    XDG_CONFIG_HOME: /home/runner
    COPILOT_CLI_INSTRUCTION: $(cat /tmp/gh-aw/aw-prompts/prompt.txt)
```

### Step 4: Remove Old Proxy Configuration

You can now remove:
- Lines 820-1047: Setup Proxy Configuration step
- Lines 1048-1067: Start Squid proxy step
- docker-compose files generation for arxiv and context7

## Benefits

1. **Simplified Configuration**: 250+ lines reduced to ~10 lines
2. **Consistent Security**: All MCP servers use same firewall rules
3. **Easier Maintenance**: Update wrapper instead of workflow
4. **Better Logging**: Centralized logging from firewall wrapper
5. **Automatic Cleanup**: Containers cleaned up automatically

## Testing the Integration

### Test 1: Basic Functionality
```bash
# Test with minimal domains
firewall-wrapper \
  --allow-domains github.com \
  'echo "Hello from firewall wrapper"'
```

### Test 2: With GitHub API
```bash
firewall-wrapper \
  --allow-domains github.com,api.github.com \
  'curl -f https://api.github.com'
```

### Test 3: With MCP Servers (arxiv)
```bash
firewall-wrapper \
  --allow-domains github.com,arxiv.org \
  'docker run --rm -i mcp/arxiv-mcp-server <<< "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\"}"'
```

## Troubleshooting

### Issue: MCP Server Can't Connect

**Symptom**: MCP server returns connection timeout or refused

**Solution**:
1. Add the MCP server's domain to `--allow-domains`
2. Check if API subdomain is needed (e.g., `api.example.com` vs `example.com`)
3. Enable debug logging: `--log-level debug`

### Issue: Container Build Fails

**Symptom**: Docker build fails for copilot or squid container

**Solution**:
1. Ensure Docker is running: `docker ps`
2. Check disk space: `df -h`
3. Try building manually:
   ```bash
   cd containers/copilot
   docker build -t test-copilot .
   ```

### Issue: iptables Rules Not Applied

**Symptom**: Traffic not being routed through proxy

**Solution**:
1. Verify `NET_ADMIN` capability in docker-compose
2. Check kernel modules: `lsmod | grep iptable`
3. Run with debug logging to see iptables output

## Gradual Migration Strategy

If you want to migrate gradually:

### Phase 1: Parallel Running
Run both old and new proxy setups to compare:

```yaml
- name: Setup Old Proxy (Keep for comparison)
  run: |
    # ... existing proxy setup

- name: Test New Firewall Wrapper
  continue-on-error: true  # Don't fail workflow yet
  run: |
    firewall-wrapper --allow-domains ... 'copilot ...'

- name: Execute with Old Proxy (Fallback)
  run: |
    # ... existing copilot execution
```

### Phase 2: Switch Default
Make wrapper the default, keep old as fallback:

```yaml
- name: Execute with Firewall Wrapper
  id: firewall_execution
  continue-on-error: true
  run: |
    firewall-wrapper --allow-domains ... 'copilot ...'

- name: Fallback to Old Proxy
  if: steps.firewall_execution.outcome == 'failure'
  run: |
    # ... old proxy setup and execution
```

### Phase 3: Full Migration
Remove old proxy configuration entirely.

## Domain List Reference

Complete domain list for scout.yml MCP servers:

```yaml
# Core GitHub domains
- github.com              # GitHub API and web
- api.github.com          # GitHub REST API
- githubusercontent.com    # Raw content
- githubassets.com        # Static assets

# MCP Server domains
- arxiv.org               # arXiv MCP server
- mcp.context7.com        # Context7 MCP server
- mcp.deepwiki.com        # DeepWiki MCP server
- learn.microsoft.com     # Microsoft Docs MCP server
- mcp.tavily.com          # Tavily search MCP server
```

## Advanced Configuration

### Per-MCP Server Domains

If you want to document which domains each MCP server needs:

```bash
# GitHub MCP server
GITHUB_DOMAINS="github.com,api.github.com,githubusercontent.com,githubassets.com"

# arXiv MCP server
ARXIV_DOMAINS="arxiv.org"

# Context7 MCP server
CONTEXT7_DOMAINS="mcp.context7.com"

# DeepWiki MCP server
DEEPWIKI_DOMAINS="mcp.deepwiki.com"

# Tavily MCP server
TAVILY_DOMAINS="mcp.tavily.com"

# Microsoft Docs MCP server
MSDOCS_DOMAINS="learn.microsoft.com"

# Combined
ALL_DOMAINS="$GITHUB_DOMAINS,$ARXIV_DOMAINS,$CONTEXT7_DOMAINS,$DEEPWIKI_DOMAINS,$TAVILY_DOMAINS,$MSDOCS_DOMAINS"

firewall-wrapper --allow-domains "$ALL_DOMAINS" 'copilot ...'
```

### Environment-Specific Configuration

Development vs Production:

```yaml
- name: Set Domain Allowlist
  run: |
    if [ "${{ github.event_name }}" == "pull_request" ]; then
      # Stricter for PRs
      echo "ALLOWED_DOMAINS=github.com,api.github.com" >> $GITHUB_ENV
    else
      # Full access for main branch
      echo "ALLOWED_DOMAINS=github.com,api.github.com,arxiv.org,..." >> $GITHUB_ENV
    fi

- name: Execute with Firewall
  run: |
    firewall-wrapper --allow-domains "$ALLOWED_DOMAINS" 'copilot ...'
```

## Monitoring and Auditing

### View Blocked Requests

```yaml
- name: Audit Blocked Requests
  if: always()
  run: |
    docker logs firewall-wrapper-squid 2>&1 | grep "TCP_DENIED" || echo "No blocked requests"
```

### Save Squid Logs as Artifact

```yaml
- name: Save Proxy Logs
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: proxy-logs
    path: |
      /tmp/firewall-wrapper-*/squid.conf
      /tmp/firewall-wrapper-*/docker-compose.yml
```

## Questions?

- Check the main [README.md](README.md) for general usage
- Review the [test workflow](.github/workflows/test-firewall-wrapper.yml) for examples
- Open an issue if you encounter problems
