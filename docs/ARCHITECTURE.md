# Architecture: PRD Builder MCP App

## How MCP Apps Work (Background)

MCP Apps are an official extension to the Model Context Protocol (launched January 2026). They allow MCP tools to return **interactive UI components** that render directly in the AI client's chat interface.

The flow:

1. **Tool declaration** — An MCP server's tool includes `_meta.ui.resourceUri` pointing to a `ui://` resource
2. **Tool call** — The LLM (Claude) calls the tool during conversation
3. **Host fetches UI** — The host (Claude, ChatGPT, etc.) fetches the resource at the `ui://` URI from the server
4. **Sandboxed rendering** — The host renders the returned HTML in a sandboxed iframe inline in the conversation
5. **Bidirectional communication** — JSON-RPC messages flow between the iframe (UI) and the server via `postMessage`, proxied by the host

This means the PM sees a rich, interactive PRD builder **inside their Claude chat** — not a separate app or tab.

## Package Architecture

```
                    ┌──────────────────┐
                    │   shared/types   │  ← Domain model (no deps)
                    │  PRDSection      │
                    │  PRDDocument     │
                    │  CompletenessScore│
                    │  ToolArgs        │
                    │  Messages        │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
    │  prd-engine │  │ mcp-server  │  │     ui      │
    │             │  │             │  │             │
    │ Templates   │  │ Tools       │  │ App.tsx     │
    │ Validation  │  │ Handlers    │  │ Components  │
    │ Scoring     │  │ Resources   │  │ Hooks       │
    │ Export      │  │ Store       │  │ Styles      │
    │ Factory     │  │ Transport   │  │             │
    └─────────────┘  └─────────────┘  └─────────────┘
         │                │                │
         │                │                │
    Pure logic      MCP protocol      React rendering
    No I/O          stdio/SSE         iframe context
    Testable        External facing   User-facing
```

### Dependency Rules

- **shared** → no dependencies (pure types)
- **prd-engine** → depends on shared (pure logic, no I/O, fully testable)
- **mcp-server** → depends on shared + prd-engine + MCP SDK
- **ui** → depends on shared + prd-engine + React + ext-apps SDK

The engine has zero I/O dependencies. This means you can unit test templates, scoring, and validation without any MCP or React setup.

## Data Flow

### Opening the PRD Builder

```
PM: "Open a PRD builder for onboarding redesign"
                    │
                    ▼
Claude calls: open_prd_builder({ templateId: "standard-feature", context: "..." })
                    │
                    ▼
MCP Server:
  1. Handler creates PRD from template (prd-engine)
  2. Saves to store
  3. Scores the PRD (prd-engine)
  4. Returns CallToolResult with:
     - content[] → text summary for Claude to read
     - _meta.prd → structured data (PRD + score)
                    │
                    ▼
Host (Claude):
  1. Sees _meta.ui.resourceUri = "ui://prd-builder/main"
  2. Fetches UI resource from server → gets HTML
  3. Renders HTML in sandboxed iframe
  4. Pushes _meta.prd data to iframe via postMessage
                    │
                    ▼
UI (iframe):
  1. useMCPApp hook receives "prd:loaded" message
  2. usePRDState syncs PRD into local state
  3. React renders: Toolbar, Outline, Editor, CompletenessMeter
```

### Claude Drafts a Section

```
Claude: "I'll draft the problem statement based on what you told me..."
                    │
                    ▼
Claude calls: update_prd_section({ prdId, sectionId: "problem-statement", content: "..." })
                    │
                    ▼
MCP Server:
  1. Handler updates section content via prd-engine
  2. Re-scores the PRD
  3. Saves to store
  4. Returns result with _meta.prd (updated PRD + score)
                    │
                    ▼
Host pushes to UI:
  - "section:content_pushed" notification
  - UI updates the section content in real-time
  - Completeness meter updates
  - Section status changes (⬜ → 🔄)
```

### PM Edits Inline

```
PM clicks "Problem Statement" in outline → section editor opens
PM types in textarea → debounced 500ms
                    │
                    ▼
UI sends: postMessage({ type: "section:edit", sectionId, content })
                    │
                    ▼
Host proxies to MCP Server:
  - Server updates section content
  - Re-scores
  - Returns updated score
                    │
                    ▼
Host pushes "score:updated" to UI
  - Completeness meter reflects new score
  - Outline shows updated section status
```

## Scoring Engine

The completeness score is a **weighted average** of per-section scores:

```
overall = Σ(sectionScore × sectionWeight) / Σ(allWeights)
```

Each section's score (0-100) is derived from validation:

| Condition | Penalty |
|-----------|---------|
| Required section is empty | Score = 0 (hard floor) |
| Validation error (format violation) | -40 per error |
| Validation warning (too short, missing ACs) | -15 per warning |
| Info issue (long unstructured text) | -5 per info |

Section status is determined by the issues:

```
empty → no content at all
draft → has errors (needs real work)
review → has warnings but no errors (PM should review)
complete → no issues (ready)
```

Each section has a **weight** (1-10) set in the template. The problem statement is weighted 10, success metrics 8, open questions 3. This means an empty problem statement hurts the score much more than an empty open questions section.

## UI State Management

The UI uses a **two-layer state** approach:

1. **`useMCPApp`** — communication layer (postMessage to/from host)
   - Receives server pushes (PRD loaded, section updated, score changed)
   - Sends user actions (edits, reorders, exports, template changes)

2. **`usePRDState`** — local state with optimistic updates
   - Keeps a local copy of the PRD for instant rendering
   - User edits apply locally immediately (no round-trip wait)
   - Server pushes merge into local state
   - Tracks "dirty" state (unsynced changes)

This means:
- Typing in the editor feels instant (local state update)
- Claude's content pushes appear smoothly (server → local sync)
- There's no flicker or loading states during normal editing

## Message Protocol

### Server → UI (via MCP notifications, proxied by host)

| Message | When | Data |
|---------|------|------|
| `prd:loaded` | Initial PRD load or full refresh | PRD + CompletenessScore |
| `section:updated` | Section content/status changed by server | PRDSection + CompletenessScore |
| `section:content_pushed` | Claude wrote content into a section | sectionId + content |
| `score:updated` | Score recalculated | CompletenessScore |
| `template:loaded` | Template changed | PRDTemplate |
| `export:ready` | Export completed | format + content |

### UI → Server (via postMessage, proxied by host)

| Message | When | Data |
|---------|------|------|
| `ui:ready` | UI finished loading | — |
| `section:edit` | PM edited section content | sectionId + content |
| `section:field_change` | PM edited a structured field | sectionId + fieldId + value |
| `section:reorder` | PM dragged to reorder | sectionIds[] (new order) |
| `section:status_change` | PM manually changed status | sectionId + status |
| `prd:title_change` | PM edited the PRD title | title |
| `prd:request_analysis` | PM clicked "Analyze" | — |
| `prd:request_export` | PM clicked "Export" | format |
| `template:select` | PM changed template | templateId |

## Key Design Decisions

### 1. Engine is pure (no MCP dependency)
The prd-engine package contains all business logic and has no imports from MCP SDK or React. This makes it:
- Unit testable without mocking MCP or DOM
- Reusable in other contexts (CLI tool, web app, API server)
- A clear separation of concerns

### 2. In-memory store with swappable interface
The `PRDStore` class is a simple interface (save/get/getAll/delete/exists). The in-memory implementation is ~30 lines. Swapping for file/SQLite/Postgres is a drop-in replacement that only touches one file.

### 3. Debounced edits with optimistic updates
The UI applies edits locally immediately (optimistic) and debounces server communication by 500ms. This prevents sending a message on every keystroke while still keeping the server in sync.

### 4. Weighted scoring with actionable suggestions
The scoring engine doesn't just give a number — it generates specific, actionable suggestions per section ("Expand this — add more detail about the why and what"). The top 5 suggestions are surfaced to Claude so the LLM can proactively help.

### 5. Multiple templates, same UI
The UI is template-agnostic. It renders whatever sections the template defines. Adding a new template is purely a data change in `prd-engine/src/templates/` — no UI code changes needed.

## Security Considerations

- The UI renders in a **sandboxed iframe** — it cannot access the host page's DOM or cookies
- `postMessage` communication should verify origin in production (currently uses `'*'` for development)
- The MCP server runs locally (stdio) — no network exposure by default
- For remote (SSE) deployments, add authentication (API key, OAuth) to the HTTP endpoint
- PRD content may contain sensitive product information — ensure the persistent store is encrypted at rest for enterprise deployments

## Testing Strategy

### Unit tests (prd-engine)
- Template creation produces correct section structure
- Validation rules catch expected issues
- Scoring produces correct weighted averages
- Export generates valid markdown/JSON

### Integration tests (mcp-server)
- Tool handlers return correct results for various inputs
- Store save/get round-trips correctly
- UI resource handler returns valid HTML

### E2E tests (ui + server + host)
- Open PRD builder → UI renders
- Claude updates section → UI reflects change
- PM edits inline → server receives update
- Export → markdown content is correct

---

*See `docs/DEPLOYMENT.md` for the complete guide to running, packaging, and deploying this project.*
