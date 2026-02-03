#!/bin/bash
cat >&2 <<'EOF'
ERROR: Docker-in-Docker support was removed in AWF v0.9.1

Docker commands are no longer available inside the firewall container.

If you need to:
- Use MCP servers: Migrate to stdio-based MCP servers (see docs)
- Run Docker: Execute Docker commands outside AWF wrapper
- Build images: Run Docker build before invoking AWF

See PR #205: https://github.com/github/gh-aw-firewall/pull/205
EOF
exit 127
