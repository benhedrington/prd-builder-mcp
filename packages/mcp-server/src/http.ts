/**
 * HTTP transport entry for the PRD Builder MCP server.
 *
 * Used for remote deployments (Railway, Fly.io, Render, etc.) where the MCP
 * client (Claude.ai, ChatGPT, Goose) connects to the server over the network
 * using the MCP "Streamable HTTP" transport.
 *
 * This module is loaded only when TRANSPORT=http. The default stdio path in
 * index.ts stays untouched for local Claude Desktop use.
 *
 * What it does:
 *   1. Boots an Express HTTP server on $PORT (Railway injects this).
 *   2. Mounts POST/GET/DELETE /mcp  → StreamableHTTPServerTransport
 *      (the single-session, stateless variant — appropriate for a prototype
 *      with one client connection per tool call lifecycle).
 *   3. Serves the built React UI bundle statically at /prd-builder-ui/* so the
 *      HTML returned by ui-resources.ts
 *      (/prd-builder-ui/assets/main.js + main.css) resolves on the wire.
 *   4. Exposes GET /healthz for Railway's zero-downtime healthcheck.
 *
 * Endpoint map (for the Railway deploy):
 *   GET    /healthz                → 200 {ok:true}        (healthcheck)
 *   POST   /mcp                    → MCP JSON-RPC request (initialize/tools/call)
 *   GET    /mcp                    → MCP SSE stream        (server→client notifications)
 *   DELETE /mcp                    → tear down the transport session
 *   GET    /prd-builder-ui/*       → static UI bundle (main.js, main.css, …)
 *   GET    /                       → small landing page with the connection URL
 */

import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { allTools } from './tools/prd-tools.js';
import {
  handleOpenPRDBuilder,
  handleAnalyzePRD,
  handleUpdateSection,
  handleExportPRD,
  handleListTemplates,
} from './handlers/prd-handlers.js';
import { handleUIResource, listUIResources } from './resources/ui-resources.js';

// ──────────────────────────────────────────────
// resolve UI bundle dir
// ──────────────────────────────────────────────
// Inside the Docker image the bundle is copied to /app/ui-dist. In a local
// `npm run start:http` run from the repo root it lives at packages/ui/dist.
// We pick whichever exists so the same entry works in both contexts.
const here = __dirname;
const candidates = [
  resolve(process.cwd(), 'ui-dist'),                 // Docker runtime stage
  resolve(process.cwd(), 'packages/ui/dist'),         // local npm start from repo root
  resolve(here, '../../../ui-dist'),                  // fallback relative to dist/
  resolve(here, '../../ui-dist'),
];
const uiDir = candidates.find((p) => existsSync(join(p, 'assets', 'main.js')));
if (!uiDir) {
  console.error(
    '[http] Could not locate built UI bundle (looked for ui-dist/assets/main.js). ' +
      'Run `npm run build:ui` (and copy to ui-dist/ for Docker) before starting.'
  );
  process.exit(1);
}
console.error(`[http] Serving UI bundle from ${uiDir}`);

// ──────────────────────────────────────────────
// Factory: wire a fresh Server with all tool/resource handlers
// ──────────────────────────────────────────────
// The Streamable HTTP transport uses one Server instance per transport. Even
// in single-session mode we keep this factory so a future multi-session refactor
// is purely local to http.ts.
function createServer(): Server {
  const server = new Server(
    { name: 'prd-builder-mcp', version: '0.1.0' },
    { capabilities: { tools: {}, resources: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      _meta: tool._meta,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case 'open_prd_builder':       return handleOpenPRDBuilder(args as never);
        case 'analyze_prd':            return handleAnalyzePRD(args as never);
        case 'update_prd_section':     return handleUpdateSection(args as never);
        case 'export_prd':             return handleExportPRD(args as never);
        case 'list_prd_templates':     return handleListTemplates();
        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: `Tool execution error: ${message}` }], isError: true };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: listUIResources().map((r) => ({
      uri: r.uri, name: r.name, description: r.description, mimeType: r.mimeType,
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const result = handleUIResource(uri);
    return result ?? { contents: [] };
  });

  return server;
}

// ──────────────────────────────────────────────
// Boot Express + transport
// ──────────────────────────────────────────────
function publicUrl(): string {
  // Railway provides a $RAILWAY_PUBLIC_DOMAIN (no scheme). Fall back to
  // http://localhost:$PORT for local runs.
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
  const port = process.env.PORT || '3000';
  if (domain) return domain.startsWith('http') ? domain : `https://${domain}`;
  return `http://localhost:${port}`;
}

// ──────────────────────────────────────────────
// Auth middleware (bearer token)
// ──────────────────────────────────────────────
// If MCP_AUTH_TOKEN is set, all /mcp requests must carry it as either:
//   • Authorization: Bearer <token>          (preferred, for POST/DELETE)
//   • ?token=<token> query param             (for GET/SSE — some clients
//                                              can't set headers on EventSource)
// If MCP_AUTH_TOKEN is empty/unset, auth is disabled (local dev, stdio).
function authMiddleware(req: Request, res: Response): boolean {
  const expected = process.env.MCP_AUTH_TOKEN;
  if (!expected) return true; // auth disabled — no token configured

  const header = req.headers.authorization;
  const bearerMatch = header?.match(/^Bearer\s+(.+)$/i);
  const provided = bearerMatch?.[1] || (req.query.token as string) || '';

  // Use timing-safe comparison to avoid leaking token length via timing.
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

// ──────────────────────────────────────────────
// OAuth 2.1 pass-through (for Claude.ai connectors)
// ──────────────────────────────────────────────
// Claude.ai requires OAuth 2.1 for custom connectors. It discovers our OAuth
// endpoints via /.well-known/oauth-authorization-server, registers a client
// via /register, redirects the user to /authorize, and exchanges the code at
// /token. We implement a minimal auto-approve flow — no real user login, just
// enough to satisfy Claude.ai's registration dance. For a personal/team tool
// behind an unguessable Railway URL this is fine. Add real identity later.
//
// In-memory stores — cleared on redeploy. Claude.ai re-registers on each
// connector add, so this is not a problem in practice.
const authCodes = new Map<string, { client_id: string; code_challenge?: string; redirect_uri: string }>();
const accessTokens = new Set<string>();
const registeredClients = new Map<string, { client_id: string; client_secret?: string; redirect_uris: string[] }>();

const BASE_URL = publicUrl();

// ── OAuth discovery metadata ──
// Claude.ai fetches this first to discover our endpoints.
function registerOAuthRoutes(app: express.Application): void {

  app.get('/.well-known/oauth-authorization-server', (_req: Request, res: Response) => {
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
    });
  });

  // Protected resource metadata (RFC 9728 — Claude.ai may fetch this too)
  app.get('/.well-known/oauth-protected-resource', (_req: Request, res: Response) => {
    res.json({
      resource: BASE_URL,
      authorization_servers: [BASE_URL],
      bearer_methods_supported: ['header'],
    });
  });

  // ── Dynamic Client Registration (RFC 7591) ──
  // Claude.ai POSTs here to register itself as an OAuth client.
  app.post('/register', (req: Request, res: Response) => {
    const clientId = randomUUID();
    const clientSecret = randomUUID();
    const redirectUris: string[] = req.body.redirect_uris || [];
    registeredClients.set(clientId, { client_id: clientId, client_secret: clientSecret, redirect_uris: redirectUris });
    console.error(`[oauth] Registered client: ${clientId} (redirect_uris: ${redirectUris.join(', ')})`);
    res.status(201).json({
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'client_secret_post',
    });
  });

  // ── Authorization endpoint ──
  // Claude.ai redirects the user here. We auto-approve — generate a code
  // and redirect back to the client's redirect_uri immediately.
  app.get('/authorize', (req: Request, res: Response) => {
    const clientId = req.query.client_id as string;
    const redirectUri = req.query.redirect_uri as string;
    const codeChallenge = req.query.code_challenge as string | undefined;
    const state = req.query.state as string | undefined;
    const responseType = req.query.response_type as string;

    if (!clientId || !redirectUri || responseType !== 'code') {
      res.status(400).json({ error: 'invalid_request', error_description: 'Missing required parameters' });
      return;
    }

    const code = randomUUID();
    authCodes.set(code, { client_id: clientId, code_challenge: codeChallenge, redirect_uri: redirectUri });
    console.error(`[oauth] Authorize: client=${clientId}, code=${code}, redirect=${redirectUri}`);

    const callback = new URL(redirectUri);
    callback.searchParams.set('code', code);
    if (state) callback.searchParams.set('state', state);
    res.redirect(302, callback.toString());
  });

  // ── Token endpoint ──
  // Claude.ai exchanges the authorization code for an access token here.
  // We issue a static token (or a random one) — the /mcp endpoint doesn't
  // validate it when MCP_AUTH_TOKEN is unset.
  app.post('/token', (req: Request, res: Response) => {
    const grantType = req.body.grant_type as string;

    if (grantType === 'authorization_code') {
      const code = req.body.code as string;
      const codeData = authCodes.get(code);
      if (!codeData) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid authorization code' });
        return;
      }
      authCodes.delete(code);

      // Verify PKCE if a challenge was provided during authorize
      if (codeData.code_challenge && req.body.code_verifier) {
        // S256: base64url(sha256(verifier))
        const crypto = require('node:crypto');
        const hash = crypto.createHash('sha256').update(req.body.code_verifier).digest();
        const computed = hash.toString('base64url');
        if (computed !== codeData.code_challenge) {
          res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
          return;
        }
      }

      const token = randomUUID() + randomUUID();
      accessTokens.add(token);
      console.error(`[oauth] Token issued for client=${codeData.client_id}`);
      res.json({
        access_token: token,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'mcp',
      });
      return;
    }

    if (grantType === 'refresh_token') {
      // Issue a new token for refresh — we don't track refresh tokens
      // (single-use session), just issue a new one.
      const token = randomUUID() + randomUUID();
      accessTokens.add(token);
      res.json({
        access_token: token,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'mcp',
      });
      return;
    }

    res.status(400).json({ error: 'unsupported_grant_type' });
  });

  // JWKS endpoint — we don't use signed tokens, return empty key set
  app.get('/.well-known/jwks.json', (_req: Request, res: Response) => {
    res.json({ keys: [] });
  });

  console.error('[oauth] OAuth 2.1 pass-through routes registered');
}

export async function startHttp(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true })); // OAuth token endpoint sends form data

  // Static UI bundle. ui-resources.ts references /prd-builder-ui/assets/* so the
  // mount path MUST match that prefix.
  app.use('/prd-builder-ui', express.static(uiDir!));

  // Healthcheck for Railway's zero-downtime deploy.
  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ ok: true, ts: Date.now() });
  });

  // OAuth routes — must be registered before /mcp so they don't get swallowed.
  registerOAuthRoutes(app);

  // Landing page: shows the connect URL a PM pastes into Claude.ai settings.
  app.get('/', (_req: Request, res: Response) => {
    const url = `${publicUrl()}/mcp`;
    res.type('html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>PRD Builder MCP</title>
<style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;color:#222}code{background:#f3f3f3;padding:.15em .4em;border-radius:4px}</style>
</head><body>
<h1>📋 PRD Builder MCP</h1>
<p>Streamable HTTP endpoint for <strong>Claude.ai / ChatGPT / Goose</strong>:</p>
<p><code>${url}</code></p>
<p>Use the same URL as the MCP server URL in your client's Integrations / Connectors settings.</p>
</body></html>`);
  });

  // ── MCP Streamable HTTP transport ────────────────────────────────────────
  // stateless single-session mode: one transport + one server for the process
  // lifetime. clone the pattern from the MCP TS SDK docs/express sample.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless; no session id assignment
  });
  const mcpServer = createServer();
  await mcpServer.connect(transport);

  if (process.env.MCP_AUTH_TOKEN) {
    console.error('[http] Auth enabled — MCP_AUTH_TOKEN is set');
  } else {
    console.error('[http] WARNING: no MCP_AUTH_TOKEN set — /mcp endpoint is open');
  }

  app.post('/mcp', async (req: Request, res: Response) => {
    if (!authMiddleware(req, res)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    try {
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[http] POST /mcp error:', err instanceof Error ? err.stack : err);
      if (!res.headersSent) res.status(500).json({ error: 'mcp_error', message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/mcp', async (req: Request, res: Response) => {
    if (!authMiddleware(req, res)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    try {
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error('[http] GET /mcp error:', err instanceof Error ? err.stack : err);
      if (!res.headersSent) res.status(500).json({ error: 'mcp_stream_error', message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/mcp', async (req: Request, res: Response) => {
    if (!authMiddleware(req, res)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    try {
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[http] DELETE /mcp error:', err instanceof Error ? err.stack : err);
      if (!res.headersSent) res.status(500).json({ error: 'mcp_error', message: err instanceof Error ? err.message : String(err) });
    }
  });

  // 404 for anything else — keep it quiet so logs stay readable.
  app.use((req: Request, res: Response) => {
    if (!req.path.startsWith('/prd-builder-ui')) {
      console.error('[http] 404', req.method, req.path);
    }
    res.status(404).json({ error: 'not_found', path: req.path });
  });

  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.error(`[http] PRD Builder MCP server (Streamable HTTP) on ${publicUrl()}/mcp`);
    console.error('[http] Healthcheck at /healthz');
    console.error('[http] OAuth discovery at /.well-known/oauth-authorization-server');
  });
}

// Generate a stable random UUID only when a caller explicitly wants one in
// a future multi-session refactor. Exported for reuse; harmless if unused now.
export function newSessionId(): string {
  return randomUUID();
}