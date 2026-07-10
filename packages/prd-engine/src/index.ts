/**
 * PRD Engine — public API.
 *
 * This package contains all the core PRD logic that doesn't depend
 * on MCP or UI frameworks:
 *   - Template definitions and instantiation
 *   - Section validation rules
 *   - Completeness scoring
 *   - Export to markdown / JSON / plain text
 *
 * The MCP server and UI both import from here.
 */

// Templates
export {
  standardFeatureTemplate,
  platformTemplate,
  bugfixTemplate,
  allTemplates,
  getTemplateById,
  getDefaultTemplate,
} from './templates/default-prd';

// Validation
export {
  validateSection,
  validateAllSections,
  determineSectionStatus,
  allRules,
} from './validation/section-rules';

// Scoring
export { scoreDocument, getQualityLabel } from './scoring/completeness';

// Export
export { exportToMarkdown, exportToJSON, exportToPlainText } from './export';

// Factory: create a new PRD from a template
export { createPRDFromTemplate, updateSectionContent, reorderSections } from './factory';
