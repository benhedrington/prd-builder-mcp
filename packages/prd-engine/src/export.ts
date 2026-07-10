/**
 * PRD export utilities.
 *
 * Converts a PRDDocument into various formats:
 * - Markdown: The primary export format — clean, readable, version-controllable
 * - JSON: Machine-readable for integrations and round-tripping
 * - PDF: Would be handled at the server level with a PDF library (stub here)
 */

import type { PRDDocument, PRDSection } from '@prd-builder/shared';
import { scoreDocument, getQualityLabel } from './scoring/completeness';

// ──────────────────────────────────────────────
// Markdown Export
// ──────────────────────────────────────────────

export function exportToMarkdown(prd: PRDDocument): string {
  const lines: string[] = [];
  const score = scoreDocument(prd);

  // Header
  lines.push(`# ${prd.title}`);
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| **Version** | ${prd.version} |`);
  lines.push(`| **Author** | ${prd.author} |`);
  lines.push(`| **Status** | ${prd.status} |`);
  lines.push(`| **Product** | ${prd.metadata.productName} |`);
  lines.push(`| **Target Release** | ${prd.metadata.targetRelease} |`);
  lines.push(`| **Stakeholders** | ${prd.metadata.stakeholders.join(', ') || '—'} |`);
  lines.push(`| **Tags** | ${prd.metadata.tags.join(', ') || '—'} |`);
  lines.push(`| **Completeness** | ${score.overall}% — ${getQualityLabel(score.overall)} |`);
  lines.push('');
  lines.push(`> Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Sections
  for (const section of prd.sections) {
    lines.push(...sectionToMarkdown(section));
    lines.push('');
  }

  // Appendix: Completeness breakdown
  lines.push('---');
  lines.push('');
  lines.push('## Appendix: Completeness Breakdown');
  lines.push('');
  lines.push('| Section | Score | Status | Weight |');
  lines.push('|---------|-------|--------|--------|');
  for (const ss of score.sections) {
    const statusIcon = {
      empty: '⬜',
      draft: '🔄',
      review: '👀',
      complete: '✅',
    }[ss.status];
    lines.push(`| ${ss.sectionTitle} | ${ss.score}% | ${statusIcon} ${ss.status} | ${ss.weight} |`);
  }
  lines.push('');
  lines.push(`**Overall: ${score.overall}%**`);
  if (score.missingRequired.length > 0) {
    lines.push('');
    lines.push(`**Missing required sections:** ${score.missingRequired.join(', ')}`);
  }

  return lines.join('\n');
}

function sectionToMarkdown(section: PRDSection, depth = 2): string[] {
  const lines: string[] = [];
  const prefix = '#'.repeat(depth);
  const statusIcon = {
    empty: '⬜',
    draft: '🔄',
    review: '👀',
    complete: '✅',
  }[section.status];

  lines.push(`${prefix} ${statusIcon} ${section.title}`);
  lines.push('');

  if (section.content.trim().length > 0) {
    lines.push(section.content);
    lines.push('');
  } else {
    lines.push('*Not yet written.*');
    lines.push('');
  }

  // Structured fields
  if (section.fields && section.fields.length > 0) {
    const filledFields = section.fields.filter((f) => f.value !== null && f.value !== '');
    if (filledFields.length > 0) {
      lines.push(`| Field | Value |`);
      lines.push(`|-------|-------|`);
      for (const field of filledFields) {
        const value = Array.isArray(field.value) ? field.value.join(', ') : String(field.value);
        lines.push(`| ${field.label} | ${value} |`);
      }
      lines.push('');
    }
  }

  // Sub-sections
  if (section.subSections) {
    for (const sub of section.subSections) {
      lines.push(...sectionToMarkdown(sub, depth + 1));
    }
  }

  return lines;
}

// ──────────────────────────────────────────────
// JSON Export
// ──────────────────────────────────────────────

export function exportToJSON(prd: PRDDocument): string {
  const score = scoreDocument(prd);
  const exportObj = {
    ...prd,
    completenessScore: score,
    exportedAt: new Date().toISOString(),
  };
  return JSON.stringify(exportObj, null, 2);
}

// ──────────────────────────────────────────────
// Plain Text Export (for pasting into chat or docs)
// ──────────────────────────────────────────────

export function exportToPlainText(prd: PRDDocument): string {
  const lines: string[] = [];
  lines.push(`PRD: ${prd.title}`);
  lines.push(`Version: ${prd.version} | Author: ${prd.author} | Status: ${prd.status}`);
  lines.push('');
  for (const section of prd.sections) {
    lines.push(`[${section.title}]`);
    if (section.content.trim().length > 0) {
      lines.push(section.content);
    } else {
      lines.push('(empty)');
    }
    lines.push('');
  }
  return lines.join('\n');
}
