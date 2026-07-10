/**
 * Factory functions for creating PRD documents.
 */

import type { PRDDocument, PRDSection, PRDTemplate, TemplateSectionDef } from '@prd-builder/shared';
import { getTemplateById, getDefaultTemplate } from './templates/default-prd';
import { determineSectionStatus, validateSection } from './validation/section-rules';

/**
 * Convert a template section definition into a live PRD section.
 */
function templateSectionToPRDSection(
  def: TemplateSectionDef,
  order: number
): PRDSection {
  const section: PRDSection = {
    id: def.id,
    title: def.title,
    type: def.type,
    required: def.required,
    priority: def.priority,
    order,
    content: '',
    status: 'empty',
    weight: def.weight,
    guidance: def.guidance,
    fields: def.fields?.map((f) => ({ ...f, value: null })),
    subSections: def.subSections?.map((sub, i) => templateSectionToPRDSection(sub, i)),
  };

  // Run validation to set initial status
  const issues = validateSection(section);
  section.status = determineSectionStatus(section, issues);
  return section;
}

/**
 * Create a new PRD document from a template.
 *
 * @param templateId - ID of the template to use (defaults to 'standard-feature')
 * @param options - Optional pre-fill values
 */
export function createPRDFromTemplate(
  templateId?: string,
  options?: {
    title?: string;
    author?: string;
    productName?: string;
    context?: string; // Context shared by the PM in chat
  }
): PRDDocument {
  const template: PRDTemplate = templateId
    ? (getTemplateById(templateId) ?? getDefaultTemplate())
    : getDefaultTemplate();

  const now = new Date().toISOString();
  const id = `prd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const sections = template.sections.map((def, i) => {
    const section = templateSectionToPRDSection(def, i);

    // If context was provided and this is the problem statement section,
    // pre-fill it with the context
    if (options?.context && def.id === 'problem-statement') {
      section.content = options.context;
      const issues = validateSection(section);
      section.status = determineSectionStatus(section, issues);
      section.updatedAt = now;
    }

    return section;
  });

  return {
    id,
    title: options?.title || `New PRD — ${template.name}`,
    version: '0.1',
    author: options?.author || 'Unknown',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    sections,
    metadata: {
      productName: options?.productName || '',
      targetRelease: '',
      stakeholders: [],
      tags: [],
      relatedPRDs: [],
    },
  };
}

/**
 * Update a section's content and recalculate its status.
 */
export function updateSectionContent(
  prd: PRDDocument,
  sectionId: string,
  content: string
): PRDDocument {
  const sections = prd.sections.map((s) => {
    if (s.id === sectionId) {
      const updated = { ...s, content, updatedAt: new Date().toISOString() };
      const issues = validateSection(updated);
      updated.status = determineSectionStatus(updated, issues);
      return updated;
    }
    return s;
  });

  return { ...prd, sections, updatedAt: new Date().toISOString() };
}

/**
 * Reorder sections based on a new ordering of IDs.
 */
export function reorderSections(
  prd: PRDDocument,
  sectionIds: string[]
): PRDDocument {
  const sectionMap = new Map(prd.sections.map((s) => [s.id, s]));
  const sections = sectionIds
    .map((id, i) => {
      const s = sectionMap.get(id);
      return s ? { ...s, order: i } : null;
    })
    .filter((s): s is PRDSection => s !== null);

  return { ...prd, sections, updatedAt: new Date().toISOString() };
}
