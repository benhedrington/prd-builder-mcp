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
  GetPRDArgs,
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
and you'll see their changes via get_prd.

This tool returns:
- prdId: the ID of the created/loaded PRD (needed for all other tools)
- sections: array of { id, title, status, required } for every section
- Use the section IDs from this response when calling update_prd_section.`,
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
    // Deprecated flat key — Claude.ai only recognizes this form (issue #71).
    // The spec defines the nested _meta.ui.resourceUri, but Claude.ai's
    // renderer ignores it. Emitting both ensures compatibility.
    'ui/resourceUri': 'ui://prd-builder/main',
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

You can also use this to update section status (e.g., mark as "complete" after review).

IMPORTANT: You must call open_prd_builder or get_prd first to obtain the valid sectionId values.
If you provide an invalid sectionId, the error response will list all valid IDs for that PRD.

On success, returns the updated section object with its new status.`,
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
  description: `List all available PRD templates with their full section schemas.
Use this to help the PM choose the right template and to discover the section IDs
each template defines. Each template returns:
- id, name, category, description, recommended
- sections: array of { id, title, type, required, priority, weight, guidance }
The section IDs are stable and used by open_prd_builder, get_prd, and update_prd_section.`,
  inputSchema: {
    type: 'object',
    properties: {},
  },
};


// ──────────────────────────────────────────────
// Tool: get_prd
// Fetches the full state of a PRD — section IDs, titles, statuses, content.
// This is how the assistant sees UI-side changes after a user edits inline.
// ──────────────────────────────────────────────

export const getPRDTool: Tool = {
  name: 'get_prd',
  description: `Fetch the full state of a PRD including all section IDs, titles, statuses, and content.
Use this after open_prd_builder to check what sections exist and their current state.
This is the primary read tool — use it to see what the PM has edited in the UI.
Returns: prdId, title, templateId, overall completeness score, and for each section:
  { id, title, status, required, content, updatedAt }`,
  inputSchema: {
    type: 'object',
    properties: {
      prdId: {
        type: 'string',
        description: 'ID of the PRD to fetch. Obtain this from open_prd_builder or list existing PRDs.',
      },
    },
    required: ['prdId'],
  },
};

// ──────────────────────────────────────────────
// Tool Registry
// ──────────────────────────────────────────────

export const allTools: Tool[] = [
  openPRDBuilderTool,
  getPRDTool,
  analyzePRDTool,
  updateSectionTool,
  exportPRDTool,
  listTemplatesTool,
];

export const toolNames = allTools.map((t) => t.name);
export type ToolName = (typeof toolNames)[number];
