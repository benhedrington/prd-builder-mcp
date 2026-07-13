/**
 * Minimal MCP App server — UI rendering test.
 *
 * One tool (show_widget) linked to one UI resource (ui://hello/world).
 * Uses @mcp-ui/server with the mcpApps adapter to inject the lifecycle
 * handshake scripts automatically.
 *
 * Streamable HTTP transport on /mcp, healthcheck on /healthz.
 *
 * Deploy: Railway auto-deploys from main branch.
 */

import express from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerAppTool, registerAppResource } from '@modelcontextprotocol/ext-apps/server';
import { createUIResource, RESOURCE_MIME_TYPE } from '@mcp-ui/server';
import { z } from 'zod';
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

// ── The widget HTML ──────────────────────────────────────────
// The mcpApps adapter script will be injected into <head> automatically
// by createUIResource({ adapters: { mcpApps: { enabled: true } } }).
const WIDGET_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hello Widget</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      padding: 1.5rem;
      margin: 0;
    }
    h1 { font-size: 1.4rem; margin: 0 0 .5rem; }
    p  { color: #555; margin: 0 0 1rem; }
    button {
      padding: .6rem 1.2rem;
      font-size: 1rem;
      border: 1px solid #d0d0d0;
      border-radius: 8px;
      background: #f5f5f5;
      cursor: pointer;
    }
    button:hover { background: #e8e8e8; }
    #count { font-weight: bold; color: #0066cc; }
  </style>
</head>
<body>
  <h1>Hello from MCP UI!</h1>
  <p>If you can see this, the widget is rendering.</p>
  <p>Clicks: <span id="count">0</span></p>
  <button id="btn">Click me</button>
  <script>
    let clicks = 0;
    document.getElementById('btn').addEventListener('click', () => {
      clicks++;
      document.getElementById('count').textContent = String(clicks);
      window.parent.postMessage({
        type: 'ui-size-change',
        payload: { height: document.body.scrollHeight }
      }, '*');
    });
    window.parent.postMessage({ type: 'ui-request-render-data' }, '*');
  </script>
</body>
</html>`;

// ── Create the UI resource with mcpApps adapter ──────────────
const RESOURCE_URI = 'ui://hello/world';

const widgetUI = createUIResource({
  uri: RESOURCE_URI,
  content: { type: 'rawHtml', htmlString: WIDGET_HTML },
  encoding: 'text',
  adapters: { mcpApps: { enabled: true } },
});

// ── Factory: wire a fresh McpServer per request (stateless) ──
function createServer(): McpServer {
  const server = new McpServer(
    { name: 'hello-mcp', version: '0.2.0' },
    {
      capabilities: {
        extensions: {
          'io.modelcontextprotocol/ui': {
            mimeTypes: [RESOURCE_MIME_TYPE],
          },
        },
      },
    },
  );

  registerAppTool(
    server,
    'show_widget',
    {
      title: 'Show Widget',
      description: 'Show an interactive widget UI inline in the conversation.',
      inputSchema: {
        name: z.string().optional().describe('Optional name to display in the widget.'),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (args: Record<string, unknown>): Promise<CallToolResult> => {
      const name = (args?.name as string) || 'World';
      return {
        content: [
          {
            type: 'text',
            text: `Hello, ${name}! The widget should be rendering above.`,
          },
        ],
        _meta: { ui: { resourceUri: RESOURCE_URI } },
      };
    },
  );

  registerAppResource(
    server,
    'widget_ui',
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      return { contents: [widgetUI.resource] };
    },
  );

  return server;
}

// ── Express app with CORS ───────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));

// CORS — Claude.ai makes cross-origin requests to OAuth + MCP endpoints
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, MCP-Session-Id');
  res.header('Access-Control-Expose-Headers', 'MCP-Session-Id');
  if (_req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// Healthcheck
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Landing page
app.get('/', (_req, res) => {
  const url = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/mcp`
    : `http://localhost:${process.env.PORT || 3000}/mcp`;
  res.type('html').send(
    `<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem">` +
      `<h1>Hello MCP</h1><p>Endpoint: <code>${url}</code></p></body></html>`,
  );
});

// MCP endpoint — stateless Streamable HTTP
async function handleMcp(req: express.Request, res: express.Response) {
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcpServer = createServer();
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      transport.close();
      mcpServer.close();
    });
  } catch (err) {
    console.error('[mcp] error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
      });
    }
  }
}

app.post('/mcp', (req, res) => handleMcp(req, res));
app.get('/mcp', (req, res) => handleMcp(req, res));
app.delete('/mcp', (req, res) => handleMcp(req, res));

// ── OAuth 2.1 pass-through (required by Claude.ai connector) ──
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : `http://localhost:${process.env.PORT || 3000}`;

app.get('/.well-known/oauth-authorization-server', (_req, res) => {
  res.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/authorize`,
    token_endpoint: `${BASE_URL}/token`,
    registration_endpoint: `${BASE_URL}/register`,
    jwks_uri: `${BASE_URL}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
    code_challenge_methods_supported: ['S256', 'plain'],
    scopes_supported: ['mcp'],
  });
});

app.get('/.well-known/oauth-protected-resource', (_req, res) => {
  res.json({
    resource: `${BASE_URL}/mcp`,
    authorization_servers: [BASE_URL],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp'],
  });
});

// Also serve at /mcp/.well-known path (some clients look relative to resource)
app.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => {
  res.json({
    resource: `${BASE_URL}/mcp`,
    authorization_servers: [BASE_URL],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp'],
  });
});

app.get('/.well-known/jwks.json', (_req, res) => {
  res.json({ keys: [] });
});

const clients = new Map<string, { client_id: string; client_secret?: string; redirect_uris: string[] }>();
const authCodes = new Map<string, { client_id: string; code_challenge?: string; redirect_uri: string }>();
const tokens = new Set<string>();

// Dynamic Client Registration (RFC 7591)
app.post('/register', (req, res) => {
  const client_id = randomUUID();
  const client_secret = randomUUID();
  const redirect_uris: string[] = req.body?.redirect_uris || [];
  clients.set(client_id, { client_id, client_secret, redirect_uris });
  res.status(201).json({
    client_id,
    client_secret,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris,
    token_endpoint_auth_method: 'client_secret_post',
  });
});

// Authorization endpoint — auto-approve, redirect back with code
app.get('/authorize', (req, res) => {
  const client_id = req.query.client_id as string;
  const redirect_uri = req.query.redirect_uri as string;
  const code_challenge = req.query.code_challenge as string | undefined;
  const state = req.query.state as string | undefined;
  const response_type = req.query.response_type as string;

  if (!client_id || !redirect_uri || response_type !== 'code') {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const code = randomUUID();
  authCodes.set(code, { client_id, code_challenge, redirect_uri });

  const callback = new URL(redirect_uri);
  callback.searchParams.set('code', code);
  if (state) callback.searchParams.set('state', state);
  res.redirect(302, callback.toString());
});

// Token endpoint
app.post('/token', (req, res) => {
  const grant_type = req.body?.grant_type as string;

  if (grant_type === 'authorization_code') {
    const code = req.body?.code as string;
    const codeData = authCodes.get(code);
    if (!codeData) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
    authCodes.delete(code);

    // Verify PKCE if challenge was set
    if (codeData.code_challenge && req.body?.code_verifier) {
      const crypto = require('node:crypto');
      const hash = crypto.createHash('sha256').update(req.body.code_verifier).digest();
      if (hash.toString('base64url') !== codeData.code_challenge) {
        return res.status(400).json({ error: 'invalid_grant' });
      }
    }

    const token = randomUUID() + randomUUID();
    tokens.add(token);
    return res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'mcp',
    });
  }

  if (grant_type === 'refresh_token') {
    const token = randomUUID() + randomUUID();
    tokens.add(token);
    return res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'mcp',
    });
  }

  res.status(400).json({ error: 'unsupported_grant_type' });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.error(`[server] Hello MCP on port ${port}`);
  console.error(`[server] Healthcheck: /healthz`);
  console.error(`[server] MCP endpoint: /mcp`);
});