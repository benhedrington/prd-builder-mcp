# PRD Builder — MCP App

> An interactive PRD (Product Requirements Document) builder that renders inside Claude's chat. Built on the [MCP Apps](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/) extension.

## What This Is

An MCP server + interactive React UI that gives product managers a structured, visual PRD builder embedded directly in their Claude conversation. The PM chats with Claude to draft content, while a real-time visual interface shows section completion status, quality scores, and actionable suggestions.

**This is not a text-only tool.** Unlike existing PRD skills and MCP integrations, this renders an interactive UI inline in the chat — the PM can edit sections, reorder them, see completeness feedback, and export, all without leaving the conversation.

## The Experience

```
PM: "Help me write a PRD for the onboarding redesign"

Claude: *calls open_prd_builder → interactive UI renders inline*

┌─────────────────────────────────────────────┐
│  Untitled PRD          [Template ▼] [Export] │
├─────────────┬───────────────────────────────┤
│ Sections    │  Problem Statement             │
│             │  ┌─────────────────────────┐   │
│ ⬜ Title*    │  │ [editable textarea]      │   │
│ ⬜ Problem*  │  │                          │   │
│ ⬜ Users*    │  └─────────────────────────┘   │
│ ⬜ Solution* │  ⚠️ Only 12 chars — aim for 50+│
│ ⬜ Stories*  ├───────────────────────────────┤
│ ⬜ Reqs*     │  Completeness: 0%             │
│ ⬜ Metrics*  │  ⬜ 8 empty  🔄 0  👀 0  ✅ 0 │
│ ⬜ Timeline  │  💡 Start with: "What problem  │
│ ⬜ Risks     │     are users experiencing?"   │
└─────────────┴───────────────────────────────┘

PM: "The problem is that 67% of users abandon signup at step 3"

Claude: *drafts problem statement, calls update_prd_section*
→ Content appears in the UI, status changes ⬜→🔄, score updates
```

## Project Structure

```
prd-builder-mcp/
├── packages/
│   ├── shared/              # Core domain types (the contract)
│   │   └── src/types.ts
│   │
│   ├── prd-engine/          # Business logic (no MCP/UI dependencies)
│   │   ├── src/
│   │   │   ├── templates/       # PRD template definitions
│   │   │   │   └── default-prd.ts   # 3 templates: feature, platform, bugfix
│   │   │   ├── validation/      # Section validation rules
│   │   │   │   └── section-rules.ts # Text, list, user-story, metrics rules
│   │   │   ├── scoring/         # Completeness scoring engine
│   │   │   │   └── completeness.ts  # Weighted scoring + suggestions
│   │   │   ├── factory.ts       # Create PRD from template, update/reorder
│   │   │   ├── export.ts        # Markdown, JSON, plain text export
│   │   │   └── index.ts         # Public API
│   │   └── package.json
│   │
│   ├── mcp-server/          # MCP protocol layer
│   │   ├── src/
│   │   │   ├── tools/           # Tool definitions with UI metadata
│   │   │   │   └── prd-tools.ts     # 5 tools: open, analyze, update, export, list
│   │   │   ├── handlers/        # Tool call handlers
│   │   │   │   ├── prd-handlers.ts  # Business logic per tool
│   │   │   │   └── store.ts         # In-memory PRD store (swap for persistent)
│   │   │   ├── resources/       # UI resource serving (ui:// scheme)
│   │   │   │   └── ui-resources.ts  # Returns HTML for iframe rendering
│   │   │   └── index.ts         # Server entry — stdio transport
│   │   └── package.json
│   │
│   └── ui/                  # Interactive React frontend
│       ├── src/
│       │   ├── hooks/           # MCP communication + state management
│       │   │   ├── useMCPApp.ts     # postMessage bridge to host/server
│       │   │   └── usePRDState.ts   # Optimistic local state
│       │   ├── components/      # Visual components
│       │   │   ├── Toolbar.tsx      # Title, template selector, export
│       │   │   ├── PRDOutline.tsx   # Sidebar: section list + drag reorder
│       │   │   ├── SectionEditor.tsx# Inline editing + validation feedback
│       │   │   └── CompletenessMeter.tsx # Score gauge + breakdown
│       │   ├── App.tsx          # Main layout wiring everything together
│       │   ├── main.tsx         # React entry point
│       │   └── styles/main.css  # Self-contained styling
│       └── package.json
│
├── docs/
│   ├── DEPLOYMENT.md        # Comprehensive guide: local dev → production
│   └── ARCHITECTURE.md      # Technical architecture deep-dive
│
├── package.json             # Root workspace config
├── tsconfig.json            # TypeScript config with path aliases
└── vite.config.ts           # Vite build config for UI
```

## MCP Tools

| Tool | UI? | Description |
|------|-----|-------------|
| `open_prd_builder` | ✅ | Opens the interactive PRD builder UI inline |
| `analyze_prd` | — | Returns completeness score + suggestions (text only) |
| `update_prd_section` | — | Pushes content into a section (used by Claude) |
| `export_prd` | — | Exports PRD to markdown/JSON |
| `list_prd_templates` | — | Lists available templates |

## PRD Templates

| Template | Sections | Use Case |
|----------|----------|----------|
| Standard Feature | 11 | New product features (default) |
| Platform Initiative | 9 | Infrastructure / cross-cutting changes |
| Bugfix / Small Change | 5 | Lightweight documentation for fixes |

## Getting Started

```bash
# Install
npm install

# Build
npm run build

# Configure in Claude Desktop
# See docs/DEPLOYMENT.md → Phase 3
```

**Local deployment guide:** [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

**External hosting (Railway):** [`docs/DEPLOY-RAILWAY.md`](docs/DEPLOY-RAILWAY.md)

**Architecture deep-dive:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Tech Stack

- **MCP SDK:** `@modelcontextprotocol/sdk` + `@modelcontextprotocol/ext-apps`
- **Server:** Node.js + TypeScript
- **UI:** React 18 + Vite
- **Transport:** stdio (local) / SSE (remote)
- **No runtime database** — in-memory store (persistent storage is a drop-in replacement, see DEPLOYMENT.md)

## Status

**Prototype** — core code is complete and functional. Not yet built or tested against a live Claude instance. The DEPLOYMENT.md guide walks through everything needed to take it live.

## License

MIT
