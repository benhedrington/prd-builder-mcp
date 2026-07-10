/**
 * MCP Tool definitions for the PRD Builder.
 *
 * Each tool declares:
 * - name, description, inputSchema (standard MCP)
 * - _meta.ui.resourceUri (MCP Apps extension — tells the host to render a UI)
 *
 * When Claude calls one of these tools, the host:
 * 1. Fetches the UI resource from ui://...
 * 2. Renders it in a sandboxed iframe inline in the conversation
 * 3. Passes the tool result data to the UI via JSON-RPC notifications
 * 4. The UI can send messages back (user edits) via postMessage
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type {
  OpenPRDBuilderArgs,
  AnalyzePRDArgs,
  UpdateSectionArgs,
  ExportPRDArgs,
} from '@prd-builder/shared';

// ──────────────────────────────────────────────
// Tool: open_prd_builder
// The primary tool — launches the interactive PRD builder UI.
// ──────────────────────────────────────────────

export const openPRDBuilderTool: Tool = {
  name: 'open_prd_builder',
  description: `Open an interactive PRD (Product Requirements Document) builder.
Use this when a product manager wants to create, edit, or review a PRD.
The tool opens a visual interface inline in the conversation where the PM can:
- See all PRD sections with completion status
- Edit sections inline with real-time quality feedback
- Drag to reorder sections
- Get a completeness score with actionable suggestions
- Export the PRD to markdown when done

You (the assistant) can help draft sections in the chat, and the PM will see
them appear in the visual builder. The PM can also edit directly in the UI
and you'll see their changes.`,
  inputSchema: {
    type: 'object',
    properties: {
      templateId: {
        type: 'string',
        description: 'ID of the PRD template to use. Options: "standard-feature" (default), "platform-initiative", "bugfix-small-change".',
        default: 'standard-feature',
      },
      existingPRDId: {
        type: 'string',
        description: 'ID of an existing PRD to load for editing. If not provided, a new PRD is created.',
      },
      title: {
        type: 'string',
        description: 'Title for the new PRD. If not provided, the PM can set it in the UI.',
      },
      context: {
        type: 'string',
        description: 'Any context the PM has shared in chat about the feature/problem. This gets pre-filled into the problem statement section.',
      },
    },
  },
  _meta: {
    ui: {
      resourceUri: 'ui://prd-builder/main',
    },
  },
};

// ──────────────────────────────────────────────
// Tool: analyze_prd
// Returns a completeness assessment without opening the UI.
// Used when the PM just wants a quick check in chat.
// ──────────────────────────────────────────────

export const analyzePRDTool: Tool = {
  name: 'analyze_prd',
  description: `Analyze a PRD's completeness and return a score with actionable suggestions.
Use this to give the PM a quick assessment of their PRD quality without opening the full UI.
Returns: overall completeness score, per-section scores, missing required sections, and top suggestions.`,
  inputSchema: {
    type: 'object',
    properties: {
      prdId: {
        type: 'string',
        description: 'ID of the PRD to analyze.',
      },
      includeSuggestions: {
        type: 'boolean',
        description: 'Whether to include actionable suggestions for improving incomplete sections.',
        default: true,
      },
    },
    required: ['prdId'],
  },
  // No _meta.ui — this is a text-only analysis tool, no UI rendering
};

// ──────────────────────────────────────────────
// Tool: update_section
// Lets the LLM write content into a specific PRD section.
// ──────────────────────────────────────────────

export const updateSectionTool: Tool = {
  name: 'update_prd_section',
  description: `Update the content of a specific PRD section.
Use this when you've drafted content for a section (e.g., problem statement, user stories)
and want to push it into the PRD. The PM will see the update appear in the visual builder
if it's open, or it will be there when they next open it.

You can also use this to update section status (e.g., mark as "complete" after review).`,
  inputSchema: {
    type: 'object',
    properties: {
      prdId: {
        type: 'string',
        description: 'ID of the PRD to update.',
      },
      sectionId: {
        type: 'string',
        description: 'ID of the section to update.',
      },
      content: {
        type: 'string',
        description: 'New content for the section. Replaces existing content.',
      },
      status: {
        type: 'string',
        enum: ['empty', 'draft', 'review', 'complete'],
        description: 'New status for the section.',
      },
    },
    required: ['prdId', 'sectionId'],
  },
  // No _meta.ui — this is a data-only update, the UI (if open) receives the change via notification
};

// ──────────────────────────────────────────────
// Tool: export_prd
// Exports the PRD to the requested format.
// ──────────────────────────────────────────────

export const exportPRDTool: Tool = {
  name: 'export_prd',
  description: `Export a PRD to markdown, JSON, or plain text.
Use this when the PM is satisfied with the PRD and wants to save or share it.
The exported content is returned as text that the PM can copy or save to a file.`,
  inputSchema: {
    type: 'object',
    properties: {
      prdId: {
        type: 'string',
        description: 'ID of the PRD to export.',
      },
      format: {
        type: 'string',
        enum: ['markdown', 'json', 'plain'],
        description: 'Export format. Markdown is recommended for most use cases.',
        default: 'markdown',
      },
    },
    required: ['prdId'],
  },
};

// ──────────────────────────────────────────────
// Tool: list_templates
// Returns available PRD templates.
// ──────────────────────────────────────────────

export const listTemplatesTool: Tool = {
  name: 'list_prd_templates',
  description: `List all available PRD templates with their descriptions.
Use this to help the PM choose the right template for their use case.`,
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

// ──────────────────────────────────────────────
// Tool Registry
// ──────────────────────────────────────────────

export const allTools: Tool[] = [
  openPRDBuilderTool,
  analyzePRDTool,
  updateSectionTool,
  exportPRDTool,
  listTemplatesTool,
];

export const toolNames = allTools.map((t) => t.name);
export type ToolName = (typeof toolNames)[number];
