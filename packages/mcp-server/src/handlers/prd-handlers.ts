/**
 * Tool call handlers.
 *
 * Each handler corresponds to a tool defined in tools/prd-tools.ts.
 * When the LLM calls a tool, the MCP server routes here.
 *
 * Handlers return structured data that:
 * 1. The LLM sees as the tool result (text + structured content)
 * 2. The host pushes to the UI via notifications (if the tool has _meta.ui)
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  OpenPRDBuilderArgs,
  AnalyzePRDArgs,
  UpdateSectionArgs,
  ExportPRDArgs,
  ToolResult,
} from '@prd-builder/shared';
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
import { prdStore } from './store';

// ──────────────────────────────────────────────
// open_prd_builder
// ──────────────────────────────────────────────

export function handleOpenPRDBuilder(
  args: OpenPRDBuilderArgs
): CallToolResult & { _meta?: { prd: ToolResult } } {
  let prd;

  if (args.existingPRDId) {
    prd = prdStore.get(args.existingPRDId);
    if (!prd) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: PRD with ID "${args.existingPRDId}" not found. It may have been cleared from memory. Create a new one instead.`,
          },
        ],
        isError: true,
      };
    }
  } else {
    prd = createPRDFromTemplate(args.templateId, {
      title: args.title,
      context: args.context,
    });
    prdStore.save(prd);
  }

  const score = scoreDocument(prd);

  return {
    content: [
      {
        type: 'text',
        text: `PRD Builder opened for "${prd.title}" (ID: ${prd.id}).
Completeness: ${score.overall}% — ${getQualityLabel(score.overall)}

${prd.sections.filter((s) => s.required && s.status === 'empty').length > 0
  ? `⚠️ ${score.missingRequired.length} required section(s) still empty: ${score.missingRequired.join(', ')}`
  : '✅ All required sections have content.'}

The PM can now interact with the PRD builder UI inline. They can edit sections, reorder them, and see real-time completeness feedback. You can help by drafting section content — use the update_prd_section tool to push your drafts into the PRD.`,
      },
      {
        type: 'text',
        text: `\n**PRD Structure:**\n${prd.sections
          .map((s) => {
            const icon = { empty: '⬜', draft: '🔄', review: '👀', complete: '✅' }[s.status];
            const req = s.required ? ' (required)' : '';
            return `${icon} ${s.title}${req}`;
          })
          .join('\n')}`,
      },
    ],
    _meta: {
      prd: {
        prd,
        score,
        message: `PRD Builder opened for "${prd.title}"`,
      },
    },
  };
}

// ──────────────────────────────────────────────
// analyze_prd
// ──────────────────────────────────────────────

export function handleAnalyzePRD(args: AnalyzePRDArgs): CallToolResult {
  const prd = prdStore.get(args.prdId);
  if (!prd) {
    return {
      content: [{ type: 'text', text: `Error: PRD "${args.prdId}" not found.` }],
      isError: true,
    };
  }

  const score = scoreDocument(prd);

  let text = `## PRD Analysis: "${prd.title}"\n\n`;
  text += `**Overall Score: ${score.overall}%** — ${getQualityLabel(score.overall)}\n\n`;

  text += `### Section Breakdown\n`;
  text += `| Section | Score | Status | Issues |\n`;
  text += `|---------|-------|--------|--------|\n`;
  for (const ss of score.sections) {
    const icons = { empty: '⬜', draft: '🔄', review: '👀', complete: '✅' };
    const issueCount = ss.issues.length;
    text += `| ${ss.sectionTitle} | ${ss.score}% | ${icons[ss.status]} ${ss.status} | ${issueCount > 0 ? `${issueCount} issue(s)` : '—'} |\n`;
  }

  if (score.missingRequired.length > 0) {
    text += `\n### ⚠️ Missing Required Sections\n`;
    for (const title of score.missingRequired) {
      text += `- ${title}\n`;
    }
  }

  if (args.includeSuggestions && score.topSuggestions.length > 0) {
    text += `\n### 💡 Top Suggestions\n`;
    for (const suggestion of score.topSuggestions) {
      text += `- ${suggestion}\n`;
    }
  }

  return {
    content: [{ type: 'text', text }],
  };
}

// ──────────────────────────────────────────────
// update_prd_section
// ──────────────────────────────────────────────

export function handleUpdateSection(args: UpdateSectionArgs): CallToolResult {
  const prd = prdStore.get(args.prdId);
  if (!prd) {
    return {
      content: [{ type: 'text', text: `Error: PRD "${args.prdId}" not found.` }],
      isError: true,
    };
  }

  const section = prd.sections.find((s) => s.id === args.sectionId);
  if (!section) {
    return {
      content: [{ type: 'text', text: `Error: Section "${args.sectionId}" not found in PRD.` }],
      isError: true,
    };
  }

  let updated = prd;
  if (args.content !== undefined) {
    updated = updateSectionContent(updated, args.sectionId, args.content);
  }

  if (args.status) {
    updated = {
      ...updated,
      sections: updated.sections.map((s) =>
        s.id === args.sectionId ? { ...s, status: args.status!, updatedAt: new Date().toISOString() } : s
      ),
    };
  }

  prdStore.save(updated);
  const score = scoreDocument(updated);
  const updatedSection = updated.sections.find((s) => s.id === args.sectionId)!;

  return {
    content: [
      {
        type: 'text',
        text: `Updated section "${updatedSection.title}" — status is now "${updatedSection.status}".
PRD completeness: ${score.overall}% (${getQualityLabel(score.overall)})`,
      },
    ],
    _meta: {
      prd: {
        prd: updated,
        score,
        message: `Section "${updatedSection.title}" updated`,
      },
    },
  };
}

// ──────────────────────────────────────────────
// export_prd
// ──────────────────────────────────────────────

export function handleExportPRD(args: ExportPRDArgs): CallToolResult {
  const prd = prdStore.get(args.prdId);
  if (!prd) {
    return {
      content: [{ type: 'text', text: `Error: PRD "${args.prdId}" not found.` }],
      isError: true,
    };
  }

  let content: string;
  let description: string;

  switch (args.format) {
    case 'markdown':
      content = exportToMarkdown(prd);
      description = 'Markdown';
      break;
    case 'json':
      content = exportToJSON(prd);
      description = 'JSON';
      break;
    case 'pdf':
      // PDF would require a server-side PDF library (puppeteer, jsPDF, etc.)
      // For now, fall back to markdown with a note
      content = exportToMarkdown(prd);
      description = 'Markdown (PDF not yet implemented — see DEPLOYMENT.md)';
      break;
    default:
      content = exportToPlainText(prd);
      description = 'Plain text';
  }

  return {
    content: [
      {
        type: 'text',
        text: `PRD exported as ${description}. Content below:\n\n---\n\n${content}`,
      },
    ],
  };
}

// ──────────────────────────────────────────────
// list_prd_templates
// ──────────────────────────────────────────────

export function handleListTemplates(): CallToolResult {
  const lines: string[] = ['## Available PRD Templates\n'];
  for (const tpl of allTemplates) {
    const recommended = tpl.recommended ? ' ⭐ (recommended)' : '';
    lines.push(`### ${tpl.name}${recommended}`);
    lines.push(`- **ID:** \`${tpl.id}\``);
    lines.push(`- **Category:** ${tpl.category}`);
    lines.push(`- **Description:** ${tpl.description}`);
    lines.push(`- **Sections:** ${tpl.sections.length}`);
    lines.push('');
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
  };
}

// ──────────────────────────────────────────────
// Router
// ──────────────────────────────────────────────

export { prdStore } from './store';
