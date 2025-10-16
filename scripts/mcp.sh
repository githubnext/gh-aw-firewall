cat > ~/.copilot/mcp-config.json << EOF
{
    "mcpServers": {
        "github": {
            "type": "local",
            "command": "docker",
            "args": [
                "run",
                "-i",
                "--rm",
                "-e",
                "GITHUB_PERSONAL_ACCESS_TOKEN",
                "-e",
                "GITHUB_TOOLSETS=default",
                "ghcr.io/github/github-mcp-server:v0.19.0"
            ],
            "tools": ["*"],
            "env": {
                "GITHUB_PERSONAL_ACCESS_TOKEN": "\${GITHUB_PERSONAL_ACCESS_TOKEN}"
            }
        }
    }
}
EOF