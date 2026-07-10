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
import { fileURLToPath } from 'node:url';
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
const here = dirname(fileURLToPath(import.meta.url));
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

export async function startHttp(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Static UI bundle. ui-resources.ts references /prd-builder-ui/assets/* so the
  // mount path MUST match that prefix.
  app.use('/prd-builder-ui', express.static(uiDir!));

  // Healthcheck for Railway's zero-downtime deploy.
  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ ok: true, ts: Date.now() });
  });

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
      console.error('[http] POST /mcp error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'mcp_error' });
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
      console.error('[http] GET /mcp error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'mcp_stream_error' });
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
      console.error('[http] DELETE /mcp error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'mcp_error' });
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
  });
}

// Generate a stable random UUID only when a caller explicitly wants one in
// a future multi-session refactor. Exported for reuse; harmless if unused now.
export function newSessionId(): string {
  return randomUUID();
}