---
title: Playwright Testing with Localhost
description: Test local web applications with Playwright through the firewall
---

The firewall makes it easy to test local web applications with Playwright using the `localhost` keyword.

## Quick Start

Test a local development server with Playwright:

```bash
# Start your dev server (e.g., npm run dev on port 3000)

# Run Playwright tests through the firewall
sudo awf --allow-domains localhost,playwright.dev -- npx playwright test
```

The `localhost` keyword automatically configures everything needed for local testing - no manual setup required.

## What the localhost Keyword Does

When you include `localhost` in `--allow-domains`, awf automatically:

1. **Enables host access** - Activates `--enable-host-access` flag
2. **Maps to host.docker.internal** - Replaces `localhost` with Docker's host gateway
3. **Allows development ports** - Opens common dev ports: 3000, 3001, 4000, 4200, 5000, 5173, 8000, 8080, 8081, 8888, 9000, 9090

This means your Playwright tests inside the container can reach services running on your host machine's localhost.

## Protocol Prefixes

The `localhost` keyword preserves HTTP/HTTPS protocol prefixes:

```bash
# HTTP only
sudo awf --allow-domains http://localhost -- npx playwright test

# HTTPS only
sudo awf --allow-domains https://localhost -- npx playwright test

# Both HTTP and HTTPS (default)
sudo awf --allow-domains localhost -- npx playwright test
```

## Custom Port Configuration

Override the default port list with `--allow-host-ports`:

```bash
# Allow only specific ports
sudo awf \
  --allow-domains localhost \
  --allow-host-ports 3000,8080 \
  -- npx playwright test

# Allow a port range
sudo awf \
  --allow-domains localhost \
  --allow-host-ports 3000,8080-8090 \
  -- npx playwright test
```

:::note
Port ranges must avoid dangerous ports (SSH, databases, etc.). See the [security model](/gh-aw-firewall/concepts/security-model) for details.
:::

## Example: Testing a Next.js App

```bash
# Terminal 1: Start Next.js dev server
npm run dev
# Server runs on http://localhost:3000

# Terminal 2: Run Playwright tests through firewall
sudo awf \
  --allow-domains localhost,vercel.app,next.js.org \
  -- npx playwright test
```

Your Playwright tests can now access `http://localhost:3000` and also fetch from `vercel.app` and `next.js.org`.

## Example: Testing a React App with External APIs

```bash
# Start React dev server on port 3000
npm start

# Run tests with access to localhost and external APIs
sudo awf \
  --allow-domains localhost,api.github.com,cdn.example.com \
  -- npx playwright test
```

## Without the localhost Keyword

Before the `localhost` keyword, you had to manually configure host access:

```bash
# Old way (still works)
sudo awf \
  --enable-host-access \
  --allow-domains host.docker.internal \
  --allow-host-ports 3000,8080 \
  -- npx playwright test
```

The `localhost` keyword eliminates this boilerplate.

## Security Considerations

:::caution
The `localhost` keyword enables access to services running on your host machine. Only use it for trusted workloads like local testing and development.
:::

When `localhost` is specified:
- Containers can access ANY service on the specified ports on your host machine
- This includes local databases, development servers, and other services
- This is safe for local development but should not be used in production

## Troubleshooting

### "Connection refused" errors

If Playwright can't connect to your local server:

1. **Verify server is running:** Check that your dev server is actually running on the host
2. **Check the port:** Ensure the port is in the allowed list (default: 3000, 3001, 4000, 4200, 5000, 5173, 8000, 8080, 8081, 8888, 9000, 9090)
3. **Use custom ports:** If using a different port, specify it with `--allow-host-ports`

### "Host not found" errors

If you see DNS resolution errors:

- Use `localhost` (not `127.0.0.1` or your machine's hostname)
- The `localhost` keyword maps to `host.docker.internal` which resolves to the host

### Server binds to 127.0.0.1 only

Some dev servers bind only to 127.0.0.1. To make them accessible from Docker containers:

```bash
# Bind to 0.0.0.0 instead of 127.0.0.1
npm run dev -- --host 0.0.0.0

# Or for Vite/Vue
npm run dev -- --host

# Or for Next.js
npm run dev -- -H 0.0.0.0
```

## See Also

- [Server Connectivity](/gh-aw-firewall/guides/server-connectivity) - Connecting to HTTP, HTTPS, and gRPC servers
- [Security Model](/gh-aw-firewall/concepts/security-model) - Understanding the firewall's security guarantees
- [CLI Reference](/gh-aw-firewall/reference/cli-reference) - All command-line options
