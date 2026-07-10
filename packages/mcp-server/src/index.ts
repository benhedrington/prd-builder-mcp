/**
 * MCP Server entry point.
 *
 * This is the main server that registers tools, handles tool calls,
 * and serves UI resources. It uses stdio transport by default (for
 * Claude Desktop, VS Code, etc.) but can also run as an HTTP/SSE
 * server for remote deployments.
 *
 * Wiring:
 * 1. Import tools from tools/prd-tools.ts
 * 2. Import handlers from handlers/prd-handlers.ts
 * 3. Import UI resource handlers from resources/ui-resources.ts
 * 4. Register everything with the MCP SDK Server
 * 5. Start the transport (stdio or HTTP)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ServerCapabilities,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { allTools } from './tools/prd-tools';
import {
  handleOpenPRDBuilder,
  handleAnalyzePRD,
  handleUpdateSection,
  handleExportPRD,
  handleListTemplates,
} from './handlers/prd-handlers';
import { handleUIResource, listUIResources } from './resources/ui-resources';

// ──────────────────────────────────────────────
// Server Setup
// ──────────────────────────────────────────────

const server = new Server(
  {
    name: 'prd-builder-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {}, // UI resources are served via the resources capability
    } as ServerCapabilities,
  }
);

// ──────────────────────────────────────────────
// List Tools Handler
// ──────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: allTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      _meta: tool._meta, // This is where the UI resource URI lives
    })),
  };
});

// ──────────────────────────────────────────────
// Call Tool Handler
// ──────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'open_prd_builder':
        return handleOpenPRDBuilder(args as never);

      case 'analyze_prd':
        return handleAnalyzePRD(args as never);

      case 'update_prd_section':
        return handleUpdateSection(args as never);

      case 'export_prd':
        return handleExportPRD(args as never);

      case 'list_prd_templates':
        return handleListTemplates();

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Tool execution error: ${message}` }],
      isError: true,
    };
  }
});

// ──────────────────────────────────────────────
// List Resources Handler (UI resources)
// ──────────────────────────────────────────────

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: listUIResources().map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    })),
  };
});

// ──────────────────────────────────────────────
// Read Resource Handler (serve UI HTML)
// ──────────────────────────────────────────────

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  const result = handleUIResource(uri);
  if (!result) {
    return {
      contents: [],
    };
  }
  return result;
});

// ──────────────────────────────────────────────
// Start Server — dispatch on TRANSPORT env var
// ──────────────────────────────────────────────
//
// TRANSPORT=stdio  (default)  → StdioServerTransport, used by Claude Desktop / VS Code
// TRANSPORT=http              → StreamableHTTPServerTransport via ./http.ts (Railway, Render, …)
//
// We dynamically import ./http.js only when http is requested so the stdio path
// doesn't pull in `express` at runtime — keeps local installs lightweight.

async function startStdio(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr (stdout is reserved for MCP protocol).
  console.error('[stdio] PRD Builder MCP Server running on stdio');
}

async function startHttp(): Promise<void> {
  const { startHttp } = await import('./http.js');
  await startHttp();
}

async function main(): Promise<void> {
  const transport = (process.env.TRANSPORT || 'stdio').toLowerCase();
  if (transport === 'http') return startHttp();
  return startStdio();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
