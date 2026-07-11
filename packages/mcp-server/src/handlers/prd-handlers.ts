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
  GetPRDArgs,
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

  // Build machine-readable section map for the LLM
  const sections = prd.sections.map((s) => ({
    id: s.id,
    title: s.title,
    type: s.type,
    required: s.required,
    priority: s.priority,
    status: s.status,
    weight: s.weight,
  }));

  const structuredContent = {
    prdId: prd.id,
    title: prd.title,
    templateId: args.templateId || 'standard-feature',
    completeness: score.overall,
    qualityLabel: getQualityLabel(score.overall),
    sections,
    missingRequired: score.missingRequired,
  };

  // Include BOTH a text block (for the LLM to read) and an embedded resource
  // block (for Claude.ai to know which ui:// resource to render as an iframe).
  // The resource block references the ui:// URI — the host fetches the HTML
  // via resources/read and renders it in a sandboxed iframe.
  return {
    content: [
      {
        type: 'text',
        text: `PRD Builder opened for "${prd.title}".
PRD ID: ${prd.id}
Completeness: ${score.overall}% — ${getQualityLabel(score.overall)}

${prd.sections.filter((s) => s.required && s.status === 'empty').length > 0
  ? `Required sections still empty: ${score.missingRequired.join(', ')}`
  : 'All required sections have content.'}

Section IDs (use these with update_prd_section):
${prd.sections.map((s) => `  - ${s.id}: ${s.title} [${s.status}]${s.required ? ' (required)' : ''}`).join('\n')}

Use get_prd with prdId "${prd.id}" to fetch full section content at any time.
Use update_prd_section with prdId "${prd.id}" and a sectionId above to push content.`,
      },
      {
        type: 'resource',
        resource: {
          uri: 'ui://prd-builder/main',
          mimeType: 'text/html;profile=mcp-app',
        },
      },
    ],
    structuredContent,
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
    const validIds = prd.sections.map((s) => `"${s.id}" (${s.title})`).join(', ');
    return {
      content: [{ type: 'text', text: `Error: unknown sectionId "${args.sectionId}" for PRD ${args.prdId}.\nValid section IDs: ${validIds}` }],
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

  // Return the updated section object so the client can confirm the write landed
  const structuredContent = {
    prdId: updated.id,
    sectionId: updatedSection.id,
    title: updatedSection.title,
    status: updatedSection.status,
    content: updatedSection.content,
    updatedAt: updatedSection.updatedAt,
    completeness: score.overall,
    qualityLabel: getQualityLabel(score.overall),
  };

  return {
    content: [
      {
        type: 'text',
        text: `Updated section "${updatedSection.title}" — status is now "${updatedSection.status}".\nPRD completeness: ${score.overall}% (${getQualityLabel(score.overall)})`,
      },
    ],
    structuredContent,
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
  const structuredContent = allTemplates.map((tpl) => ({
    id: tpl.id,
    name: tpl.name,
    description: tpl.description,
    category: tpl.category,
    recommended: tpl.recommended || false,
    sections: tpl.sections.map((s) => ({
      id: s.id,
      title: s.title,
      type: s.type,
      required: s.required,
      priority: s.priority,
      weight: s.weight,
      guidance: s.guidance || undefined,
    })),
  }));

  // Human-readable text for the LLM
  const lines: string[] = ['Available PRD Templates:\n'];
  for (const tpl of allTemplates) {
    const rec = tpl.recommended ? ' (recommended)' : '';
    lines.push(`${tpl.name}${rec}`);
    lines.push(`  ID: ${tpl.id}`);
    lines.push(`  Category: ${tpl.category}`);
    lines.push(`  Sections (${tpl.sections.length}):`);
    for (const s of tpl.sections) {
      const req = s.required ? ' *' : '';
      lines.push(`    - ${s.id}: ${s.title}${req}`);
    }
    lines.push('');
  }
  lines.push('Section IDs marked with * are required.');
  lines.push('Use these section IDs with open_prd_builder and update_prd_section.');

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: { templates: structuredContent },
  };
}
// ──────────────────────────────────────────────
// get_prd
// ──────────────────────────────────────────────

export function handleGetPRD(args: GetPRDArgs): CallToolResult {
  const prd = prdStore.get(args.prdId);
  if (!prd) {
    return {
      content: [{ type: 'text', text: `Error: PRD "${args.prdId}" not found.` }],
      isError: true,
    };
  }

  const score = scoreDocument(prd);

  const structuredContent = {
    prdId: prd.id,
    title: prd.title,
    version: prd.version,
    status: prd.status,
    templateId: prd.sections[0]?.id ? 'derived-from-sections' : undefined,
    completeness: score.overall,
    qualityLabel: getQualityLabel(score.overall),
    sections: prd.sections.map((s) => ({
      id: s.id,
      title: s.title,
      type: s.type,
      required: s.required,
      priority: s.priority,
      status: s.status,
      content: s.content,
      updatedAt: s.updatedAt,
    })),
    missingRequired: score.missingRequired,
    topSuggestions: score.topSuggestions,
  };

  const lines: string[] = [`PRD: "${prd.title}" (ID: ${prd.id})`, `Completeness: ${score.overall}% — ${getQualityLabel(score.overall)}`, ''];
  for (const s of prd.sections) {
    const contentPreview = s.content ? (s.content.length > 80 ? s.content.slice(0, 80) + '...' : s.content) : '(empty)';
    lines.push(`  ${s.id}: ${s.title} [${s.status}]${s.required ? ' (required)' : ''}`);
    if (s.content) {
      lines.push(`    Content: ${contentPreview}`);
    }
  }
  if (score.missingRequired.length > 0) {
    lines.push('', `Missing required: ${score.missingRequired.join(', ')}`);
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent,
  };
}

// ──────────────────────────────────────────────
// Router
// ──────────────────────────────────────────────

export { prdStore } from './store';
