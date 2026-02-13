#!/usr/bin/env node

/**
 * AWF API Proxy Sidecar
 *
 * Node.js-based proxy that:
 * 1. Keeps OpenAI/Codex API credentials isolated from agent container
 * 2. Routes all traffic through Squid via HTTP_PROXY/HTTPS_PROXY
 * 3. Injects authentication headers (Authorization for OpenAI)
 * 4. Respects domain whitelisting enforced by Squid
 *
 * Note: Anthropic/Claude API keys are passed directly to the agent container,
 * not through this proxy.
 */

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Read OpenAI API key from environment (set by docker-compose)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Squid proxy configuration (set via HTTP_PROXY/HTTPS_PROXY in docker-compose)
const HTTP_PROXY = process.env.HTTP_PROXY;
const HTTPS_PROXY = process.env.HTTPS_PROXY;

// Create proxy agent to route outbound HTTPS through Squid
// http-proxy-middleware doesn't use HTTP_PROXY env vars natively,
// so we create an explicit agent that tunnels through Squid
const proxyAgent = HTTPS_PROXY ? new HttpsProxyAgent(HTTPS_PROXY) : undefined;
if (proxyAgent) {
  console.log('[API Proxy] Using Squid proxy agent for outbound HTTPS connections');
} else {
  console.log('[API Proxy] WARNING: No HTTPS_PROXY configured, connections will be direct');
}

console.log('[API Proxy] Starting AWF API proxy sidecar...');
console.log(`[API Proxy] HTTP_PROXY: ${HTTP_PROXY}`);
console.log(`[API Proxy] HTTPS_PROXY: ${HTTPS_PROXY}`);
if (OPENAI_API_KEY) {
  console.log('[API Proxy] OpenAI API key configured');
}

// Create Express app
const app = express();

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'awf-api-proxy',
    squid_proxy: HTTP_PROXY || 'not configured',
    providers: {
      openai: !!OPENAI_API_KEY
    }
  });
});

// OpenAI API proxy (port 10000)
// Always start the server to keep container running for healthchecks
if (OPENAI_API_KEY) {
  app.use(createProxyMiddleware({
    target: 'https://api.openai.com',
    changeOrigin: true,
    secure: true,
    agent: proxyAgent,
    onProxyReq: (proxyReq, req, res) => {
      // Inject Authorization header
      proxyReq.setHeader('Authorization', `Bearer ${OPENAI_API_KEY}`);
      console.log(`[OpenAI Proxy] ${req.method} ${req.url}`);
    },
    onError: (err, req, res) => {
      console.error(`[OpenAI Proxy] Error: ${err.message}`);
      res.status(502).json({ error: 'Proxy error', message: err.message });
    }
  }));
  console.log('[API Proxy] OpenAI proxy configured');
} else {
  console.log('[API Proxy] OpenAI API key not configured - proxy disabled for port 10000');
}

app.listen(10000, '0.0.0.0', () => {
  console.log('[API Proxy] OpenAI proxy listening on port 10000');
  if (OPENAI_API_KEY) {
    console.log('[API Proxy] Routing through Squid to api.openai.com');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[API Proxy] Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[API Proxy] Received SIGINT, shutting down gracefully...');
  process.exit(0);
});
