/**
 * UI Resource handlers.
 *
 * In MCP Apps, the UI is served via the `ui://` scheme.
 * When the host (Claude, ChatGPT, etc.) encounters a tool with
 * _meta.ui.resourceUri, it fetches that resource from the server.
 *
 * The resource returns HTML (typically a bundled SPA) that the
 * host renders in a sandboxed iframe.
 *
 * In production, the HTML is a pre-built Vite bundle of the React UI.
 * For development, we can serve a dev-mode HTML that loads from Vite's dev server.
 */

import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

// ──────────────────────────────────────────────
// Production HTML (pre-built bundle)
// ──────────────────────────────────────────────

/**
 * Generates the HTML shell that loads the pre-built UI bundle.
 * In production, the dist/ folder from packages/ui is copied or
 * served alongside the MCP server.
 */
function getProductionHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PRD Builder</title>
  <link rel="stylesheet" href="/prd-builder-ui/assets/main.css" />
</head>
<body>
  <div id="prd-builder-root"></div>
  <script type="module" src="/prd-builder-ui/assets/main.js"></script>
</body>
</html>`;
}

/**
 * Development HTML — loads from Vite dev server (localhost:5173)
 * Useful for local development with hot reload.
 */
function getDevHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PRD Builder (Dev)</title>
</head>
<body>
  <div id="prd-builder-root"></div>
  <script type="module" src="http://localhost:5173/src/main.tsx"></script>
</body>
</html>`;
}

// ──────────────────────────────────────────────
// Resource Handler
// ──────────────────────────────────────────────

/**
 * Serve a UI resource by URI.
 * Called by the host when it needs to render a tool's UI.
 */
export function handleUIResource(
  uri: string,
  _mimeType?: string
): ReadResourceResult | null {
  switch (uri) {
    case 'ui://prd-builder/main':
      const html = process.env.NODE_ENV === 'production'
        ? getProductionHTML()
        : getDevHTML();

      return {
        contents: [
          {
            uri,
            mimeType: 'text/html',
            text: html,
          },
        ],
      };

    default:
      // Unknown UI resource
      return null;
  }
}

/**
 * List all available UI resources.
 * Called by the host during the initial capabilities handshake.
 */
export function listUIResources() {
  return [
    {
      uri: 'ui://prd-builder/main',
      name: 'PRD Builder Main UI',
      description: 'Interactive PRD builder with section management, completeness scoring, and inline editing.',
      mimeType: 'text/html',
    },
  ];
}
