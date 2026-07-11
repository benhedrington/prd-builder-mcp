/**
 * UI Resource handlers.
 *
 * In MCP Apps, the UI is served via the `ui://` scheme. When the host
 * (Claude, ChatGPT, etc.) encounters a tool with _meta.ui.resourceUri,
 * it fetches that resource from the server.
 *
 * The resource returns HTML (text/html;profile=mcp-app) that the host
 * renders in a sandboxed iframe. The HTML MUST be self-contained —
 * all JS and CSS inlined — because the iframe has no base URL to
 * resolve relative paths against.
 */

import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

// ──────────────────────────────────────────────
// Resolve UI bundle directory
// ──────────────────────────────────────────────
const here = __dirname;
const candidates = [
  resolve(process.cwd(), 'ui-dist'),
  resolve(process.cwd(), 'packages/ui/dist'),
  resolve(here, '../../../ui-dist'),
  resolve(here, '../../ui-dist'),
];
const uiDir = candidates.find((p) => existsSync(join(p, 'assets', 'main.js')));

// ──────────────────────────────────────────────
// Inline the JS and CSS into the HTML
// ──────────────────────────────────────────────
// The host loads the HTML text directly into an iframe — there's no
// base URL, so relative paths like /prd-builder-ui/assets/main.js
// won't resolve. Everything must be inlined.

function getInlinedHTML(): string {
  if (!uiDir) {
    // Dev fallback: load from Vite dev server
    return getDevHTML();
  }

  const jsPath = join(uiDir, 'assets', 'main.js');
  const cssPath = join(uiDir, 'assets', 'main.css');

  let jsCode = '';
  let cssCode = '';

  try {
    jsCode = readFileSync(jsPath, 'utf-8');
  } catch {
    console.error('[ui-resources] Could not read main.js from', jsPath);
  }

  try {
    cssCode = readFileSync(cssPath, 'utf-8');
  } catch {
    console.error('[ui-resources] Could not read main.css from', cssPath);
  }

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

/** Development HTML — loads from Vite dev server (localhost:5173) */
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

export function handleUIResource(
  uri: string,
  _mimeType?: string
): ReadResourceResult | null {
  switch (uri) {
    case 'ui://prd-builder/main':
      const html = process.env.NODE_ENV === 'production'
        ? getInlinedHTML()
        : getDevHTML();

      return {
        contents: [
          {
            uri,
            mimeType: 'text/html;profile=mcp-app',
            text: html,
            _meta: {
              ui: {
                prefersBorder: true,
              },
            },
          },
        ],
      };

    default:
      return null;
  }
}

/** List all available UI resources. */
export function listUIResources() {
  return [
    {
      uri: 'ui://prd-builder/main',
      name: 'PRD Builder Main UI',
      description: 'Interactive PRD builder with section management, completeness scoring, and inline editing.',
      mimeType: 'text/html;profile=mcp-app',
    },
  ];
}