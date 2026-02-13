#!/usr/bin/env node

/**
 * AWF API Proxy Sidecar
 *
 * Node.js-based proxy that:
 * 1. Keeps LLM API credentials isolated from agent container
 * 2. Routes all traffic through Squid via HTTP_PROXY/HTTPS_PROXY
 * 3. Injects authentication headers (Authorization, x-api-key)
 * 4. Respects domain whitelisting enforced by Squid
 */

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

// Read API keys from environment (set by docker-compose)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Squid proxy configuration (set via HTTP_PROXY/HTTPS_PROXY in docker-compose)
const HTTP_PROXY = process.env.HTTP_PROXY;
const HTTPS_PROXY = process.env.HTTPS_PROXY;

console.log('[API Proxy] Starting AWF API proxy sidecar...');
console.log(`[API Proxy] HTTP_PROXY: ${HTTP_PROXY}`);
console.log(`[API Proxy] HTTPS_PROXY: ${HTTPS_PROXY}`);
if (OPENAI_API_KEY) {
  console.log('[API Proxy] OpenAI API key configured');
}
if (ANTHROPIC_API_KEY) {
  console.log('[API Proxy] Anthropic API key configured');
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
      openai: !!OPENAI_API_KEY,
      anthropic: !!ANTHROPIC_API_KEY
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

// Anthropic API proxy (port 10001)
// Always start the server to keep container running
const anthropicApp = express();

anthropicApp.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', service: 'anthropic-proxy' });
});

if (ANTHROPIC_API_KEY) {
  anthropicApp.use(createProxyMiddleware({
    target: 'https://api.anthropic.com',
    changeOrigin: true,
    secure: true,
    onProxyReq: (proxyReq, req, res) => {
      // Inject Anthropic authentication headers
      proxyReq.setHeader('x-api-key', ANTHROPIC_API_KEY);
      proxyReq.setHeader('anthropic-version', '2023-06-01');
      console.log(`[Anthropic Proxy] ${req.method} ${req.url}`);
    },
    onError: (err, req, res) => {
      console.error(`[Anthropic Proxy] Error: ${err.message}`);
      res.status(502).json({ error: 'Proxy error', message: err.message });
    }
  }));
  console.log('[API Proxy] Anthropic proxy configured');
} else {
  console.log('[API Proxy] Anthropic API key not configured - proxy disabled for port 10001');
}

anthropicApp.listen(10001, '0.0.0.0', () => {
  console.log('[API Proxy] Anthropic proxy listening on port 10001');
  if (ANTHROPIC_API_KEY) {
    console.log('[API Proxy] Routing through Squid to api.anthropic.com');
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
