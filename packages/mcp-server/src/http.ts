/**
 * HTTP transport entry for the PRD Builder MCP server.
 *
 * Rewritten to use McpServer (high-level) + registerAppTool/registerAppResource
 * from the official ext-apps SDK, matching the pattern from the official examples.
 *
 * This eliminates any subtle protocol differences caused by using the low-level
 * Server class with manual setRequestHandler calls.
 */

import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

import {
  createPRDFromTemplate,
  updateSectionContent,
  scoreDocument,
  getQualityLabel,
  exportToMarkdown,
  exportToJSON,
  exportToPlainText,
  allTemplates,
} from '@prd-builder/engine';
import { prdStore } from './handlers/store.js';

// ──────────────────────────────────────────────
// resolve UI bundle directory
// ──────────────────────────────────────────────
const here = import.meta.dirname;
const candidates = [
  resolve(process.cwd(), 'ui-dist'),
  resolve(process.cwd(), 'packages/ui/dist'),
  resolve(here, '../../../ui-dist'),
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
// Read the inlined HTML (JS + CSS inlined into the HTML text)
// ──────────────────────────────────────────────
function getInlinedHTML(): string {
  const jsPath = join(uiDir!, 'assets', 'main.js');
  const cssPath = join(uiDir!, 'assets', 'main.css');

  let jsCode = '';
  let cssCode = '';

  try { jsCode = readFileSync(jsPath, 'utf-8'); } catch { console.error('[http] Could not read main.js'); }
  try { cssCode = readFileSync(cssPath, 'utf-8'); } catch { console.error('[http] Could not read main.css'); }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PRD Builder</title>
  <style>${cssCode}</style>
</head>
<body>
  <div id="prd-builder-root"></div>
  <script type="module">${jsCode}</script>
</body>
</html>`;
}

// ──────────────────────────────────────────────
// Factory: wire a fresh McpServer using official SDK helpers
// ──────────────────────────────────────────────
const RESOURCE_URI = 'ui://prd-builder/main';

function createServer(): McpServer {
  const server = new McpServer(
    {
      name: 'prd-builder-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        extensions: {
          'io.modelcontextprotocol/ui': {
            mimeTypes: ['text/html;profile=mcp-app'],
          },
        },
      },
    }
  );

  // ── open_prd_builder (UI tool) ──
  registerAppTool(server, 'open_prd_builder', {
    title: 'Open PRD Builder',
    description: `Open an interactive PRD (Product Requirements Document) builder.
Use this when a product manager wants to create, edit, or review a PRD.
The tool opens a visual interface inline in the conversation where the PM can:
- See all PRD sections with completion status
- Edit sections inline with real-time quality feedback
- Get a completeness score with actionable suggestions
- Export the PRD to markdown when done

This tool returns:
- prdId: the ID of the created/loaded PRD (needed for all other tools)
- sections: array of { id, title, status, required } for every section
- Use the section IDs from this response when calling update_prd_section.`,
    inputSchema: {},
    _meta: { ui: { resourceUri: RESOURCE_URI } },
  }, async (args: any): Promise<CallToolResult> => {
    let prd;
    if (args?.existingPRDId) {
      prd = prdStore.get(args.existingPRDId);
      if (!prd) {
        return { content: [{ type: 'text', text: `Error: PRD "${args.existingPRDId}" not found.` }], isError: true };
      }
    } else {
      prd = createPRDFromTemplate(args?.templateId, { title: args?.title, context: args?.context });
      prdStore.save(prd);
    }

    const score = scoreDocument(prd);
    const sections = prd.sections.map((s: any) => ({ id: s.id, title: s.title, type: s.type, required: s.required, priority: s.priority, status: s.status, weight: s.weight }));

    return {
      content: [{
        type: 'text',
        text: `PRD Builder opened for "${prd.title}".
PRD ID: ${prd.id}
Completeness: ${score.overall}% — ${getQualityLabel(score.overall)}

Section IDs (use these with update_prd_section):
${prd.sections.map((s: any) => `  - ${s.id}: ${s.title} [${s.status}]${s.required ? ' (required)' : ''}`).join('\n')}

Use get_prd with prdId "${prd.id}" to fetch full section content.
Use update_prd_section with prdId "${prd.id}" and a sectionId above to push content.`,
      }],
      structuredContent: {
        prdId: prd.id,
        title: prd.title,
        templateId: args?.templateId || 'standard-feature',
        completeness: score.overall,
        qualityLabel: getQualityLabel(score.overall),
        sections,
        missingRequired: score.missingRequired,
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    };
  });

  // ── get_prd ──
  server.registerTool('get_prd', {
    description: `Fetch the full state of a PRD including all section IDs, titles, statuses, and content.
Use this after open_prd_builder to check what sections exist and their current state.
This is the primary read tool — use it to see what the PM has edited in the UI.
Returns: prdId, title, overall completeness score, and for each section:
  { id, title, status, required, content, updatedAt }`,
    inputSchema: {},
  }, async (args: any): Promise<CallToolResult> => {
    const prd = prdStore.get(args?.prdId);
    if (!prd) return { content: [{ type: 'text', text: `Error: PRD "${args?.prdId}" not found.` }], isError: true };

    const score = scoreDocument(prd);
    return {
      content: [{ type: 'text', text: `PRD: "${prd.title}" (ID: ${prd.id})\nCompleteness: ${score.overall}%` }],
      structuredContent: {
        prdId: prd.id,
        title: prd.title,
        completeness: score.overall,
        qualityLabel: getQualityLabel(score.overall),
        sections: prd.sections.map((s: any) => ({ id: s.id, title: s.title, type: s.type, required: s.required, status: s.status, content: s.content, updatedAt: s.updatedAt })),
        missingRequired: score.missingRequired,
        topSuggestions: score.topSuggestions,
      },
    };
  });

  // ── analyze_prd ──
  server.registerTool('analyze_prd', {
    description: `Analyze a PRD's completeness and return a score with actionable suggestions.`,
    inputSchema: {},
  }, async (args: any): Promise<CallToolResult> => {
    const prd = prdStore.get(args?.prdId);
    if (!prd) return { content: [{ type: 'text', text: `Error: PRD "${args?.prdId}" not found.` }], isError: true };

    const score = scoreDocument(prd);
    let text = `PRD Analysis: "${prd.title}"\nOverall Score: ${score.overall}% — ${getQualityLabel(score.overall)}\n\nSection Breakdown:\n`;
    for (const ss of score.sections) {
      text += `  ${ss.sectionTitle}: ${ss.score}% [${ss.status}] ${ss.issues.length > 0 ? `${ss.issues.length} issue(s)` : ''}\n`;
    }
    if (score.missingRequired.length > 0) text += `\nMissing required: ${score.missingRequired.join(', ')}\n`;
    if (score.topSuggestions.length > 0) {
      text += '\nTop suggestions:\n';
      for (const s of score.topSuggestions) text += `  - ${s}\n`;
    }
    return { content: [{ type: 'text', text }] };
  });

  // ── update_prd_section ──
  server.registerTool('update_prd_section', {
    description: `Update the content of a specific PRD section.
IMPORTANT: You must call open_prd_builder or get_prd first to obtain the valid sectionId values.
If you provide an invalid sectionId, the error response will list all valid IDs for that PRD.
On success, returns the updated section object with its new status.`,
    inputSchema: {},
  }, async (args: any): Promise<CallToolResult> => {
    const prd = prdStore.get(args?.prdId);
    if (!prd) return { content: [{ type: 'text', text: `Error: PRD "${args?.prdId}" not found.` }], isError: true };

    const section = prd.sections.find((s: any) => s.id === args?.sectionId);
    if (!section) {
      const validIds = prd.sections.map((s: any) => `"${s.id}" (${s.title})`).join(', ');
      return { content: [{ type: 'text', text: `Error: unknown sectionId "${args?.sectionId}" for PRD ${args.prdId}.\nValid section IDs: ${validIds}` }], isError: true };
    }

    let updated = prd;
    if (args?.content !== undefined) updated = updateSectionContent(updated, args.sectionId, args.content);
    if (args?.status) {
      updated = { ...updated, sections: updated.sections.map((s: any) => s.id === args.sectionId ? { ...s, status: args.status, updatedAt: new Date().toISOString() } : s) };
    }
    prdStore.save(updated);
    const score = scoreDocument(updated);
    const updatedSection = updated.sections.find((s: any) => s.id === args.sectionId)!;

    return {
      content: [{ type: 'text', text: `Updated section "${updatedSection.title}" — status is now "${updatedSection.status}".\nPRD completeness: ${score.overall}% (${getQualityLabel(score.overall)})` }],
      structuredContent: {
        prdId: updated.id,
        sectionId: updatedSection.id,
        title: updatedSection.title,
        status: updatedSection.status,
        content: updatedSection.content,
        updatedAt: updatedSection.updatedAt,
        completeness: score.overall,
        qualityLabel: getQualityLabel(score.overall),
      },
    };
  });

  // ── export_prd ──
  server.registerTool('export_prd', {
    description: `Export a PRD to markdown, JSON, or plain text.`,
    inputSchema: {},
  }, async (args: any): Promise<CallToolResult> => {
    const prd = prdStore.get(args?.prdId);
    if (!prd) return { content: [{ type: 'text', text: `Error: PRD "${args?.prdId}" not found.` }], isError: true };

    let content: string;
    switch (args?.format) {
      case 'json': content = exportToJSON(prd); break;
      case 'plain': content = exportToPlainText(prd); break;
      default: content = exportToMarkdown(prd);
    }
    return { content: [{ type: 'text', text: content }] };
  });

  // ── list_prd_templates ──
  server.registerTool('list_prd_templates', {
    description: `List all available PRD templates with their full section schemas.
Each template returns: id, name, category, description, recommended
sections: array of { id, title, type, required, priority, weight, guidance }
The section IDs are stable and used by open_prd_builder, get_prd, and update_prd_section.`,
    inputSchema: {},
  }, async (): Promise<CallToolResult> => {
    const templates = allTemplates.map((tpl: any) => ({
      id: tpl.id, name: tpl.name, description: tpl.description, category: tpl.category, recommended: tpl.recommended || false,
      sections: tpl.sections.map((s: any) => ({ id: s.id, title: s.title, type: s.type, required: s.required, priority: s.priority, weight: s.weight, guidance: s.guidance || undefined })),
    }));

    const lines: string[] = ['Available PRD Templates:\n'];
    for (const tpl of allTemplates) {
      const rec = tpl.recommended ? ' (recommended)' : '';
      lines.push(`${tpl.name}${rec}`);
      lines.push(`  ID: ${tpl.id}`);
      lines.push(`  Sections (${tpl.sections.length}):`);
      for (const s of tpl.sections) lines.push(`    - ${s.id}: ${s.title}${s.required ? ' *' : ''}`);
      lines.push('');
    }
    lines.push('Section IDs marked with * are required.');

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: { templates },
    };
  });

  // ── Register the UI resource ──
  registerAppResource(server, RESOURCE_URI, RESOURCE_URI, { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = getInlinedHTML();
      return {
        contents: [{
          uri: RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          _meta: { ui: { prefersBorder: true } },
        }],
      };
    }
  );

  return server;
}

// ──────────────────────────────────────────────
// Boot Express + transport
// ──────────────────────────────────────────────
function publicUrl(): string {
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
  const port = process.env.PORT || '3000';
  if (domain) return domain.startsWith('http') ? domain : `https://${domain}`;
  return `http://localhost:${port}`;
}

// ── Auth middleware ──
function authMiddleware(req: Request, res: Response): boolean {
  const expected = process.env.MCP_AUTH_TOKEN;
  if (!expected) return true;
  const header = req.headers.authorization;
  const bearerMatch = header?.match(/^Bearer\s+(.+)$/i);
  const provided = bearerMatch?.[1] || (req.query.token as string) || '';
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// ── OAuth 2.1 pass-through ──
const authCodes = new Map<string, { client_id: string; code_challenge?: string; redirect_uri: string }>();
const accessTokens = new Set<string>();
const registeredClients = new Map<string, { client_id: string; client_secret?: string; redirect_uris: string[] }>();
const BASE_URL = publicUrl();

function registerOAuthRoutes(app: express.Application): void {
  app.get('/.well-known/oauth-authorization-server', (_req: Request, res: Response) => {
    res.json({
      issuer: BASE_URL, authorization_endpoint: `${BASE_URL}/authorize`, token_endpoint: `${BASE_URL}/token`,
      registration_endpoint: `${BASE_URL}/register`, jwks_uri: `${BASE_URL}/.well-known/jwks.json`,
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
      code_challenge_methods_supported: ['S256', 'plain'],
    });
  });

  const resourceMetadata = (_req: Request, res: Response) => {
    res.json({ resource: `${BASE_URL}/mcp`, authorization_servers: [BASE_URL], bearer_methods_supported: ['header'], scopes_supported: ['mcp'] });
  };
  app.get('/.well-known/oauth-protected-resource', resourceMetadata);
  app.get('/.well-known/oauth-protected-resource/mcp', resourceMetadata);

  app.post('/register', (req: Request, res: Response) => {
    const clientId = randomUUID();
    const clientSecret = randomUUID();
    const redirectUris: string[] = req.body.redirect_uris || [];
    registeredClients.set(clientId, { client_id: clientId, client_secret: clientSecret, redirect_uris: redirectUris });
    res.status(201).json({ client_id: clientId, client_secret: clientSecret, client_id_issued_at: Math.floor(Date.now() / 1000), redirect_uris: redirectUris, token_endpoint_auth_method: 'client_secret_post' });
  });

  app.get('/authorize', (req: Request, res: Response) => {
    const clientId = req.query.client_id as string;
    const redirectUri = req.query.redirect_uri as string;
    const codeChallenge = req.query.code_challenge as string | undefined;
    const state = req.query.state as string | undefined;
    const responseType = req.query.response_type as string;
    if (!clientId || !redirectUri || responseType !== 'code') { res.status(400).json({ error: 'invalid_request' }); return; }
    const code = randomUUID();
    authCodes.set(code, { client_id: clientId, code_challenge: codeChallenge, redirect_uri: redirectUri });
    const callback = new URL(redirectUri);
    callback.searchParams.set('code', code);
    if (state) callback.searchParams.set('state', state);
    res.redirect(302, callback.toString());
  });

  app.post('/token', (req: Request, res: Response) => {
    const grantType = req.body.grant_type as string;
    if (grantType === 'authorization_code') {
      const code = req.body.code as string;
      const codeData = authCodes.get(code);
      if (!codeData) { res.status(400).json({ error: 'invalid_grant' }); return; }
      authCodes.delete(code);
      if (codeData.code_challenge && req.body.code_verifier) {
        const crypto = require('node:crypto');
        const hash = crypto.createHash('sha256').update(req.body.code_verifier).digest();
        if (hash.toString('base64url') !== codeData.code_challenge) { res.status(400).json({ error: 'invalid_grant' }); return; }
      }
      const token = randomUUID() + randomUUID();
      accessTokens.add(token);
      res.json({ access_token: token, token_type: 'Bearer', expires_in: 3600, scope: 'mcp' });
      return;
    }
    if (grantType === 'refresh_token') {
      const token = randomUUID() + randomUUID();
      accessTokens.add(token);
      res.json({ access_token: token, token_type: 'Bearer', expires_in: 3600, scope: 'mcp' });
      return;
    }
    res.status(400).json({ error: 'unsupported_grant_type' });
  });

  app.get('/.well-known/jwks.json', (_req: Request, res: Response) => { res.json({ keys: [] }); });
  console.error('[oauth] OAuth 2.1 pass-through routes registered');
}

// ── Start server ──
export async function startHttp(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Healthcheck
  app.get('/healthz', (_req: Request, res: Response) => { res.json({ ok: true, ts: Date.now() }); });

  // OAuth
  registerOAuthRoutes(app);

  // Landing page
  app.get('/', (_req: Request, res: Response) => {
    res.type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>PRD Builder MCP</title></head><body style="font-family:system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem"><h1>PRD Builder MCP</h1><p>Streamable HTTP endpoint:</p><p><code>${publicUrl()}/mcp</code></p></body></html>`);
  });

  // MCP Streamable HTTP transport (stateless mode)
  if (process.env.MCP_AUTH_TOKEN) {
    console.error('[http] Auth enabled — MCP_AUTH_TOKEN is set');
  } else {
    console.error('[http] WARNING: no MCP_AUTH_TOKEN set — /mcp endpoint is open');
  }

  async function handleMcpRequest(req: Request, res: Response, body?: unknown) {
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const mcpServer = createServer();
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
      res.on('close', () => { transport.close(); mcpServer.close(); });
    } catch (err) {
      console.error('[http] /mcp error:', err instanceof Error ? err.stack : err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' } });
      }
    }
  }

  app.post('/mcp', async (req: Request, res: Response) => {
    if (!authMiddleware(req, res)) { res.status(401).json({ error: 'unauthorized' }); return; }
    await handleMcpRequest(req, res, req.body);
  });

  app.get('/mcp', async (req: Request, res: Response) => {
    if (!authMiddleware(req, res)) { res.status(401).json({ error: 'unauthorized' }); return; }
    await handleMcpRequest(req, res);
  });

  app.delete('/mcp', async (req: Request, res: Response) => {
    if (!authMiddleware(req, res)) { res.status(401).json({ error: 'unauthorized' }); return; }
    await handleMcpRequest(req, res, req.body);
  });

  app.use((req: Request, res: Response) => { res.status(404).json({ error: 'not_found', path: req.path }); });

  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.error(`[http] PRD Builder MCP server (Streamable HTTP) on ${publicUrl()}/mcp`);
    console.error('[http] Healthcheck at /healthz');
  });
}