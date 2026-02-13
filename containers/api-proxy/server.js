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

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Read API keys from environment (set by docker-compose)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Squid proxy configuration (set via HTTP_PROXY/HTTPS_PROXY in docker-compose)
const HTTPS_PROXY = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

console.log('[API Proxy] Starting AWF API proxy sidecar...');
console.log(`[API Proxy] HTTPS_PROXY: ${HTTPS_PROXY}`);
if (OPENAI_API_KEY) {
  console.log('[API Proxy] OpenAI API key configured');
}
if (ANTHROPIC_API_KEY) {
  console.log('[API Proxy] Anthropic API key configured');
}

// Create proxy agent for routing through Squid
const proxyAgent = HTTPS_PROXY ? new HttpsProxyAgent(HTTPS_PROXY) : undefined;
if (!proxyAgent) {
  console.warn('[API Proxy] WARNING: No HTTPS_PROXY configured, requests will go direct');
}

/**
 * Forward a request to the target API, injecting auth headers and routing through Squid.
 */
function proxyRequest(req, res, targetHost, injectHeaders) {
  // Build target URL
  const targetUrl = new URL(req.url, `https://${targetHost}`);

  // Read the request body
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);

    // Copy incoming headers, inject auth headers
    const headers = { ...req.headers };
    delete headers.host; // Replace with target host
    Object.assign(headers, injectHeaders);

    const options = {
      hostname: targetHost,
      port: 443,
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers,
      agent: proxyAgent, // Route through Squid
    };

    const proxyReq = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`[API Proxy] Error proxying to ${targetHost}: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'Proxy error', message: err.message }));
    });

    if (body.length > 0) {
      proxyReq.write(body);
    }
    proxyReq.end();
  });
}

// Health port is always 10000 — this is what Docker healthcheck hits
const HEALTH_PORT = 10000;

// OpenAI API proxy (port 10000)
if (OPENAI_API_KEY) {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        service: 'awf-api-proxy',
        squid_proxy: HTTPS_PROXY || 'not configured',
        providers: { openai: true, anthropic: !!ANTHROPIC_API_KEY },
      }));
      return;
    }

    console.log(`[OpenAI Proxy] ${req.method} ${req.url}`);
    proxyRequest(req, res, 'api.openai.com', {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    });
  });

  server.listen(HEALTH_PORT, '0.0.0.0', () => {
    console.log(`[API Proxy] OpenAI proxy listening on port ${HEALTH_PORT}`);
  });
} else {
  // No OpenAI key — still need a health endpoint on port 10000 for Docker healthcheck
  const server = http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        service: 'awf-api-proxy',
        squid_proxy: HTTPS_PROXY || 'not configured',
        providers: { openai: false, anthropic: !!ANTHROPIC_API_KEY },
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'OpenAI proxy not configured (no OPENAI_API_KEY)' }));
  });

  server.listen(HEALTH_PORT, '0.0.0.0', () => {
    console.log(`[API Proxy] Health endpoint listening on port ${HEALTH_PORT} (OpenAI not configured)`);
  });
}

// Anthropic API proxy (port 10001)
if (ANTHROPIC_API_KEY) {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'healthy', service: 'anthropic-proxy' }));
      return;
    }

    console.log(`[Anthropic Proxy] ${req.method} ${req.url}`);
    proxyRequest(req, res, 'api.anthropic.com', {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    });
  });

  server.listen(10001, '0.0.0.0', () => {
    console.log('[API Proxy] Anthropic proxy listening on port 10001');
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[API Proxy] Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[API Proxy] Received SIGINT, shutting down gracefully...');
  process.exit(0);
});
