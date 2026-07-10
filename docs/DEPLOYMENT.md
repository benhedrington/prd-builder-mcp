# Deployment Guide: PRD Builder MCP App

> **How to take this prototype from code on the NAS to a real, working service that PMs can use inside Claude.**

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Phase 1: Local Development Setup](#phase-1-local-development-setup)
4. [Phase 2: Build & Package](#phase-2-build--package)
5. [Phase 3: Install in Claude Desktop / Claude.ai](#phase-3-install-in-claude-desktop--claudeai)
6. [Phase 4: Testing the MCP App](#phase-4-testing-the-mcp-app)
7. [Phase 5: Persistent Storage (Replacing In-Memory Store)](#phase-5-persistent-storage)
8. [Phase 6: Publishing as an npm Package](#phase-6-publishing-as-an-npm-package)
9. [Phase 7: Production Deployment Options](#phase-7-production-deployment-options)
10. [Phase 8: Distribution & Onboarding PM Teams](#phase-8-distribution--onboarding-pm-teams)
11. [Alternative: Using the Agent Skills (Fast Path)](#alternative-using-the-agent-skills-fast-path)
12. [Troubleshooting](#troubleshooting)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    Claude / ChatGPT                       │
│                                                          │
│  ┌──────────────────────┐  ┌───────────────────────────┐ │
│  │   Chat Conversation  │  │   PRD Builder UI (iframe) │ │
│  │                      │  │                           │ │
│  │  PM: "Help me write  │  │  ┌─────────┬───────────┐  │ │
│  │  a PRD for..."       │  │  │ Outline │  Editor   │  │ │
│  │                      │  │  │ (list)  │  (editing)│  │ │
│  │  Claude: *calls      │  │  │         ├───────────┤  │ │
│  │  open_prd_builder*   │  │  │         │  Score    │  │ │
│  │  → UI renders        │  │  │         │  Meter    │  │ │
│  │                      │  │  └─────────┴───────────┘  │ │
│  │  Claude: *drafts     │  │                           │ │
│  │  problem statement,  │  │  PM edits inline →        │ │
│  │  calls update_section*│  │  postMessage to server   │ │
│  │  → content appears   │  │                           │ │
│  │  in UI*              │  │                           │ │
│  └──────────────────────┘  └───────────────────────────┘ │
│           ↕ JSON-RPC (stdio)        ↕ postMessage        │
└───────────┼───────────────────────────┼──────────────────┘
            │                           │
┌───────────▼───────────────────────────▼──────────────────┐
│                  MCP Server (Node.js)                     │
│                                                           │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Tool Router  │  │ PRD Handlers │  │ UI Resources     │  │
│  │              │→ │              │  │ (ui:// scheme)   │  │
│  │ open_builder │  │ create/edit  │  │ → serves HTML    │  │
│  │ analyze      │  │ score/export │  │   (built React)  │  │
│  │ update       │  │              │  │                  │  │
│  │ export       │  └──────┬───────┘  └──────────────────┘  │
│  │ list_tpls    │         │                              │
│  └─────────────┘         │                              │
│                          ▼                              │
│  ┌──────────────────────────────────────────────────────┐ │
│  │                  PRD Engine                           │ │
│  │  Templates → Validation → Scoring → Export           │ │
│  └──────────────────────────────────────────────────────┘ │
│                          │                              │
│                          ▼                              │
│  ┌──────────────────────────────────────────────────────┐ │
│  │              PRD Store (in-memory → persistent)      │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### Package Responsibilities

| Package | Role | What it contains |
|---------|------|-----------------|
| `@prd-builder/shared` | Domain types | TypeScript interfaces — the contract between all packages |
| `@prd-builder/engine` | Business logic | Templates, validation rules, completeness scoring, markdown/JSON export |
| `@prd-builder/mcp-server` | MCP protocol layer | Tool definitions with UI metadata, tool call handlers, UI resource serving, stdio transport |
| `@prd-builder/ui` | Interactive frontend | React app rendered in Claude's iframe — section editor, outline, completeness meter, MCP Apps hooks |

---

## 2. Prerequisites

- **Node.js 20+** (check: `node --version`)
- **npm 10+** or **pnpm** (check: `npm --version`)
- **Claude Desktop app** (for local testing) OR access to **Claude.ai** (web)
- **Git** (for version control)

### Verify the ext-apps SDK is available:

```bash
npm view @modelcontextprotocol/ext-apps version
# Should return something like 1.7.x
```

---

## Phase 1: Local Development Setup

### Step 1: Clone & Install

```bash
# The project is on the NAS at:
# /mnt/nas/ben/Documents/full-sync/claude/projects/prd-builder-mcp

cd /mnt/nas/ben/Documents/full-sync/claude/projects/prd-builder-mcp

# Install all workspace dependencies
npm install

# Verify TypeScript compiles
npm run typecheck
```

### Step 2: Build the UI

The React UI needs to be built into static assets that the MCP server can serve.

```bash
# Build the UI to dist/
npm run build:ui

# Output: packages/ui/dist/assets/main.js + main.css
```

### Step 3: Build the Server

```bash
npm run build:server

# Output: packages/mcp-server/dist/index.js
```

### Step 4: Dev Mode (optional — for active development)

For hot-reload development, run the UI dev server and MCP server separately:

```bash
# Terminal 1: Vite dev server (hot reload for UI)
npm run dev:ui
# → UI available at http://localhost:5173

# Terminal 2: MCP server with tsx (hot reload for server)
npm run dev:server
# → Server running on stdio
```

In dev mode, the UI resource handler returns HTML that loads from `http://localhost:5173` instead of the built bundle. The `NODE_ENV` environment variable controls this — see `packages/mcp-server/src/resources/ui-resources.ts`.

---

## Phase 2: Build & Package

### Full build (for production use):

```bash
# Build everything
npm run build

# This produces:
# packages/ui/dist/assets/main.js    — bundled React UI
# packages/ui/dist/assets/main.css   — styles
# packages/mcp-server/dist/index.js  — compiled MCP server
```

### Verify the build works:

```bash
# Quick smoke test — start the server and check it doesn't crash
node packages/mcp-server/dist/index.js --help
# or just run it briefly and Ctrl+C:
timeout 3 node packages/mcp-server/dist/index.js
# Should print "PRD Builder MCP Server running on stdio" to stderr
```

---

## Phase 3: Install in Claude Desktop / Claude.ai

### Option A: Claude Desktop (local, easiest for testing)

Edit Claude Desktop's MCP config:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "prd-builder": {
      "command": "node",
      "args": [
        "/mnt/nas/ben/Documents/full-sync/claude/projects/prd-builder-mcp/packages/mcp-server/dist/index.js"
      ]
    }
  }
}
```

Restart Claude Desktop. You should see "prd-builder" in the MCP servers list.

### Option B: Via npx (once published to npm)

```json
{
  "mcpServers": {
    "prd-builder": {
      "command": "npx",
      "args": ["-y", "@prd-builder/mcp-server", "--stdio"]
    }
  }
}
```

### Option C: Claude.ai (web)

Claude.ai supports MCP servers via the Settings → Integrations page. You'll need to either:
1. Run the server as a remote HTTP/SSE endpoint (see Phase 7), OR
2. Use Claude's Connectors feature to point at your server URL

### Option D: VS Code (with Claude extension)

Add to `.vscode/settings.json` or VS Code's MCP settings:

```json
{
  "mcp.servers": {
    "prd-builder": {
      "command": "node",
      "args": ["/path/to/packages/mcp-server/dist/index.js"]
    }
  }
}
```

---

## Phase 4: Testing the MCP App

### Test 1: Basic tool discovery

In Claude chat, type:
> "What tools do you have available?"

You should see the five PRD builder tools listed:
- `open_prd_builder`
- `analyze_prd`
- `update_prd_section`
- `export_prd`
- `list_prd_templates`

### Test 2: Open the PRD builder UI

> "Open a PRD builder for a new user onboarding feature"

Claude should call `open_prd_builder`, and the interactive UI should render inline in the conversation. You should see:
- A toolbar with title and export buttons
- A sidebar with section list (all ⬜ empty)
- A section editor with guidance text
- A completeness meter showing 0%

### Test 3: Have Claude draft a section

> "Can you draft the problem statement section? The problem is that users are dropping off during the signup flow — our analytics show 67% abandonment at step 3."

Claude should call `update_prd_section` with content for the problem statement. The UI should update in real-time — the section should go from ⬜ to 🔄, and the completeness score should increase.

### Test 4: Edit inline in the UI

Click on the "Problem Statement" section in the outline. Edit the text directly in the textarea. Your changes should be saved (debounced 500ms) and sent back to the server.

### Test 5: Export

Click "Export MD" in the toolbar. Claude should receive the export request and present the markdown PRD in the chat.

---

## Phase 5: Persistent Storage

The prototype uses an in-memory store (`packages/mcp-server/src/handlers/store.ts`). PRDs are lost when the server restarts. For production, you need persistence.

### Option A: File System (simplest)

Replace the in-memory Map with file-based storage:

```typescript
// packages/mcp-server/src/handlers/file-store.ts
import { promises as fs } from 'fs';
import { join } from 'path';
import type { PRDDocument } from '@prd-builder/shared';

const STORE_DIR = process.env.PRD_STORE_DIR || './data/prds';

export class FilePRDStore {
  async save(prd: PRDDocument): Promise<void> {
    await fs.mkdir(STORE_DIR, { recursive: true });
    await fs.writeFile(join(STORE_DIR, `${prd.id}.json`), JSON.stringify(prd, null, 2));
  }

  async get(id: string): Promise<PRDDocument | undefined> {
    try {
      const data = await fs.readFile(join(STORE_DIR, `${id}.json`), 'utf-8');
      return JSON.parse(data);
    } catch {
      return undefined;
    }
  }

  async getAll(): Promise<PRDDocument[]> {
    const files = await fs.readdir(STORE_DIR).catch(() => []);
    const prds = await Promise.all(
      files
        .filter((f) => f.endsWith('.json'))
        .map((f) => this.get(f.replace('.json', '')))
    );
    return prds.filter((p): p is PRDDocument => p !== undefined);
  }
}
```

Update handlers to be `async` and use `await store.get(id)` instead of `store.get(id)`.

### Option B: SQLite

```bash
npm install better-sqlite3
```

```typescript
import Database from 'better-sqlite3';

const db = new Database('./data/prds.db');
db.exec(`CREATE TABLE IF NOT EXISTS prds (
  id TEXT PRIMARY KEY,
  title TEXT,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`);

// save: db.prepare('INSERT OR REPLACE INTO prds (id, title, data, updated_at) VALUES (?, ?, ?, ?)')
//   .run(prd.id, prd.title, JSON.stringify(prd), prd.updatedAt);

// get: const row = db.prepare('SELECT data FROM prds WHERE id = ?').get(id);
//   return row ? JSON.parse(row.data) : undefined;
```

### Option C: Postgres (for team/enterprise)

```bash
npm install pg
```

Same pattern as SQLite but with connection pooling. Use `pg.Pool` for concurrent connections. Suitable when multiple MCP server instances need to share state.

### Option D: Cloud storage (S3, Supabase, etc.)

For serverless deployments, store PRDs in S3 or a managed database. Each PRD is a JSON document keyed by ID.

---

## Phase 6: Publishing as an npm Package

### Step 1: Prepare the package

```bash
# Update packages/mcp-server/package.json:
{
  "name": "@prd-builder/mcp-server",
  "version": "0.1.0",
  "description": "MCP App for interactive PRD building in Claude and other AI clients",
  "bin": {
    "prd-builder-mcp": "dist/index.js"
  },
  "files": [
    "dist/**/*.js",
    "dist/**/*.js.map",
    "dist/**/*.d.ts",
    "README.md"
  ],
  "publishConfig": {
    "access": "public"
  }
}
```

### Step 2: Bundle the UI assets into the server package

The server needs to serve the built UI HTML. Copy the UI dist into the server package:

```bash
# Add a build script that copies UI assets
cp -r packages/ui/dist packages/mcp-server/ui-assets
```

Update `ui-resources.ts` to read from the bundled assets:

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';

function getProductionHTML(): string {
  const jsCode = readFileSync(join(__dirname, '../ui-assets/assets/main.js'), 'utf-8');
  const cssCode = readFileSync(join(__dirname, '../ui-assets/assets/main.css'), 'utf-8');

  return `<!DOCTYPE html>
<html>
<head><style>${cssCode}</style></head>
<body>
  <div id="prd-builder-root"></div>
  <script type="module">${jsCode}</script>
</body>
</html>`;
}
```

### Step 3: Publish

```bash
# Login to npm
npm login

# Publish the server package
cd packages/mcp-server
npm publish --access public

# Users can now install via:
# npx -y @prd-builder/mcp-server --stdio
```

### Step 4: Create a scoped org (optional)

If you want all packages under `@prd-builder`:

```bash
npm org create prd-builder
# Then publish all packages under that scope
```

---

## Phase 7: Production Deployment Options

### Option A: Local stdio (current — simplest)

- Runs as a subprocess of Claude Desktop
- No network configuration needed
- PRDs stored locally
- **Best for:** individual PMs, testing, development

### Option B: HTTP/SSE Server (remote)

For Claude.ai web or shared team use, run the MCP server as an HTTP service:

```typescript
// Add to packages/mcp-server/src/index.ts
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';

const app = express();

app.get('/sse', (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  server.connect(transport);
});

app.post('/messages', (req, res) => {
  // Handle incoming messages from the transport
});

app.listen(3000, () => {
  console.log('PRD Builder MCP Server (HTTP/SSE) on port 3000');
});
```

Point Claude.ai or any remote MCP client at `https://your-server.com/sse`.

### Option C: Docker Container

```dockerfile
FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PRD_STORE_DIR=/data/prds

VOLUME /data
EXPOSE 3000

CMD ["node", "packages/mcp-server/dist/index.js"]
```

```bash
docker build -t prd-builder-mcp .
docker run -p 3000:3000 -v prd-data:/data prd-builder-mcp
```

### Option D: Cloud Deploy (Fly.io, Railway, Render)

For a always-on remote MCP server:

```bash
# Fly.io example
fly launch --image prd-builder-mcp
fly deploy
# Point Claude at https://prd-builder-mcp.fly.dev/sse
```

Add a persistent volume for PRD storage:
```bash
fly volumes create prd_data
fly scale memory 512
```

---

## Phase 8: Distribution & Onboarding PM Teams

### For individual PMs (Claude Desktop)

1. **Share the install config** — send the JSON snippet for `claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "prd-builder": {
         "command": "npx",
         "args": ["-y", "@prd-builder/mcp-server", "--stdio"]
       }
     }
   }
   ```

2. **Quick-start prompt** — tell PMs to start a Claude chat with:
   > "I need to write a PRD for [feature]. Open the PRD builder and help me work through it."

### For teams (shared remote server)

1. Deploy the MCP server to a shared endpoint (Phase 7, Option B/C/D)
2. Each PM adds the remote server URL to their Claude settings
3. PRDs are stored on the shared server — all team members can access them

### Integration with existing PM workflows

- **Linear/Jira:** Add a tool that creates a ticket from a completed PRD section
- **Notion/Confluence:** Add export destinations (push markdown PRD to a wiki page)
- **GitHub:** Auto-create issues from user stories in the PRD
- **Slack:** Post PRD completion notifications to a channel

### Template customization

Teams can create custom templates by adding to `packages/prd-engine/src/templates/`:

```typescript
export const customTemplate: PRDTemplate = {
  id: 'my-company-feature',
  name: 'My Company Feature PRD',
  // ... custom sections
};
```

Register in `allTemplates` array and rebuild.

---

## Alternative: Using the Agent Skills (Fast Path)

The ext-apps repo ships Agent Skills that can scaffold this for you. If you want to start fresh or migrate:

```bash
# In Claude Code:
/plugin marketplace add modelcontextprotocol/ext-apps
/plugin install mcp-apps@modelcontextprotocol-ext-apps

# Then ask Claude Code:
# "Create an MCP App for building PRDs with an interactive section editor and completeness scoring"
```

This will scaffold a working MCP App with the ext-apps SDK's conventions. You can then port the domain logic (templates, scoring, validation) from this project.

---

## Troubleshooting

### "Tool not found" in Claude
- Ensure the MCP config path is correct
- Restart Claude Desktop after config changes
- Check the server starts without errors: `node packages/mcp-server/dist/index.js`

### UI doesn't render
- Verify the UI was built: `ls packages/ui/dist/assets/`
- Check that `NODE_ENV=production` when running the built version (controls which HTML template is served)
- Look at Claude's developer console for iframe errors

### UI renders but no data appears
- The `ui:ready` message may not be reaching the server. Check postMessage origin restrictions.
- Verify the MCP Apps extension is supported by your Claude version (check the [clients page](https://modelcontextprotocol.io/docs/develop/clients))

### Completeness score doesn't update
- The scoring runs on the server side. Ensure `scoreDocument()` is called in the handler after each update.
- For client-side scoring (faster feedback), import `scoreDocument` from `@prd-builder/engine` directly in the UI

### In-memory store loses PRDs on restart
- This is expected behavior in the prototype. See Phase 5 for persistent storage options.

### TypeScript path resolution errors
- Ensure `tsconfig.json` paths are correct
- For Vite (UI), the `vite.config.ts` alias handles resolution
- For the server, ensure `@prd-builder/*` packages are in `node_modules` (run `npm install` at root)

---

## Roadmap: Beyond the Prototype

| Feature | Priority | Complexity |
|---------|----------|------------|
| Persistent storage (file/SQLite) | High | Low |
| PDF export (server-side rendering) | High | Medium |
| Custom template upload | Medium | Low |
| PRD version history & diffing | Medium | Medium |
| Multi-user collaboration (same PRD) | Medium | High |
| Linear/Jira issue creation from user stories | Medium | Medium |
| Notion/Confluence wiki export | Medium | Low |
| AI-powered section drafting (Claude auto-fills) | High | Medium |
| Quality scoring with LLM evaluation | Low | High |
| PRD approval workflow (status: draft → review → approved) | Medium | Low |
| Template marketplace (share templates across teams) | Low | Medium |
| Embedding PRD builder in existing web apps | Low | High |

---

*Last updated: July 2026*
