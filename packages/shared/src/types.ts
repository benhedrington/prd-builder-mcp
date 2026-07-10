/**
 * Core domain types for the PRD Builder MCP App.
 *
 * These types are shared across all packages:
 * - prd-engine: uses them for templates, scoring, validation
 * - mcp-server: uses them for tool schemas and handler return types
 * - ui: uses them for component props and state management
 *
 * Keeping them in one place ensures the server, UI, and engine
 * never drift on what a "section" or "score" looks like.
 */

// ──────────────────────────────────────────────
// Section & Document Model
// ──────────────────────────────────────────────

export type SectionType =
  | 'text'          // Free-form prose (problem statement, solution overview)
  | 'list'          // Bulleted list (features, requirements)
  | 'table'         // Structured rows (acceptance criteria, metrics)
  | 'metrics'       // Key-value pairs with targets (success metrics)
  | 'timeline'      // Date-ordered milestones
  | 'user-stories'; // User story format: As a... I want... so that...

export type SectionStatus =
  | 'empty'    // No content yet
  | 'draft'    // Has content but below quality threshold
  | 'review'   // Content meets minimum but needs PM review
  | 'complete'; // Content meets quality threshold and is reviewed

export type Priority = 'must' | 'should' | 'could' | 'wont';

/**
 * A single field within a section (e.g., a metric name + target value).
 * Allows structured data entry within a section rather than just free text.
 */
export interface PRDField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'multi-select';
  value?: string | string[] | number | null;
  required: boolean;
  placeholder?: string;
  options?: string[]; // For select / multi-select
  helpText?: string;
}

/**
 * A section of the PRD document.
 * Sections are the fundamental unit — each one has its own content,
 * status, and optional structured fields.
 */
export interface PRDSection {
  id: string;
  title: string;
  type: SectionType;
  required: boolean;
  priority: Priority;
  order: number;
  content: string;
  status: SectionStatus;
  fields?: PRDField[];
  subSections?: PRDSection[];
  /** Weight (1-10) used by the scoring engine — higher = more important */
  weight: number;
  /** Hints shown in the UI when the section is empty */
  guidance?: string;
  /** Last updated timestamp (ISO string) */
  updatedAt?: string;
}

/**
 * The complete PRD document.
 * This is what gets serialized, stored, and exported.
 */
export interface PRDDocument {
  id: string;
  title: string;
  version: string;
  author: string;
  status: 'draft' | 'in-review' | 'approved' | 'archived';
  createdAt: string;
  updatedAt: string;
  sections: PRDSection[];
  metadata: PRDMetadata;
}

export interface PRDMetadata {
  productName: string;
  targetRelease: string;
  stakeholders: string[];
  tags: string[];
  relatedPRDs: string[];
}

// ──────────────────────────────────────────────
// Template Model
// ──────────────────────────────────────────────

/**
 * A reusable PRD template.
 * Templates define the section structure that new PRDs start from.
 */
export interface PRDTemplate {
  id: string;
  name: string;
  description: string;
  category: 'feature' | 'platform' | 'bugfix' | 'research' | 'custom';
  sections: TemplateSectionDef[];
  recommended?: boolean;
}

/**
 * Template section definition — the blueprint for a section.
 * Unlike PRDSection (which holds actual content), this just defines
 * what sections should exist and their configuration.
 */
export interface TemplateSectionDef {
  id: string;
  title: string;
  type: SectionType;
  required: boolean;
  priority: Priority;
  weight: number;
  guidance?: string;
  fields?: PRDField[];
  subSections?: TemplateSectionDef[];
}

// ──────────────────────────────────────────────
// Scoring & Validation
// ──────────────────────────────────────────────

export interface SectionScore {
  sectionId: string;
  sectionTitle: string;
  score: number;        // 0-100
  status: SectionStatus;
  weight: number;
  weightedScore: number; // score * (weight / totalWeight)
  issues: ValidationIssue[];
  suggestions: string[];
}

export interface CompletenessScore {
  overall: number; // 0-100
  sections: SectionScore[];
  missingRequired: string[];
  topSuggestions: string[];
  computedAt: string;
}

export interface ValidationIssue {
  sectionId: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  ruleId: string;
}

export interface ValidationRule {
  id: string;
  sectionType: SectionType;
  description: string;
  severity: 'error' | 'warning' | 'info';
  /** Returns issues if the section violates this rule */
  check: (section: PRDSection) => ValidationIssue | null;
}

// ──────────────────────────────────────────────
// MCP Tool Schemas
// ──────────────────────────────────────────────

/**
 * Arguments for the open_prd_builder tool.
 * Called by the LLM to launch the interactive PRD UI.
 */
export interface OpenPRDBuilderArgs {
  templateId?: string;      // Which template to use (defaults to 'standard-feature')
  existingPRDId?: string;   // Load an existing PRD for editing
  title?: string;           // Pre-fill the title
  context?: string;         // Context the PM shared in chat (problem description, etc.)
}

/**
 * Arguments for the analyze_prd tool.
 * Called by the LLM to get a completeness assessment.
 */
export interface AnalyzePRDArgs {
  prdId: string;
  /** If true, the LLM will also receive suggestions for improving sections */
  includeSuggestions: boolean;
}

/**
 * Arguments for the update_section tool.
 * Called by the LLM to fill in or modify a specific section.
 */
export interface UpdateSectionArgs {
  prdId: string;
  sectionId: string;
  content?: string;
  fields?: Partial<PRDField>[];
  status?: SectionStatus;
}

/**
 * Arguments for the export_prd tool.
 */
export interface ExportPRDArgs {
  prdId: string;
  format: 'markdown' | 'json' | 'pdf';
}

/**
 * Result returned from MCP tool calls.
 * The LLM sees this as structured data alongside the UI resource.
 */
export interface ToolResult {
  prd: PRDDocument;
  score?: CompletenessScore;
  exportedContent?: string;
  message: string;
}

// ──────────────────────────────────────────────
// UI ↔ Server Communication (MCP Apps protocol)
// ──────────────────────────────────────────────

/**
 * Messages sent FROM the server TO the UI (via MCP notifications).
 * These push data into the iframe when the LLM updates something.
 */
export type ServerToUIMessage =
  | { type: 'prd:loaded'; prd: PRDDocument; score: CompletenessScore }
  | { type: 'section:updated'; section: PRDSection; score: CompletenessScore }
  | { type: 'section:content_pushed'; sectionId: string; content: string }
  | { type: 'score:updated'; score: CompletenessScore }
  | { type: 'template:loaded'; template: PRDTemplate }
  | { type: 'export:ready'; format: string; content: string };

/**
 * Messages sent FROM the UI TO the server (via postMessage).
 * These capture user interactions in the iframe — inline edits, reorders, etc.
 */
export type UIToServerMessage =
  | { type: 'section:edit'; sectionId: string; content: string }
  | { type: 'section:field_change'; sectionId: string; fieldId: string; value: PRDField['value'] }
  | { type: 'section:reorder'; sectionIds: string[] }
  | { type: 'section:status_change'; sectionId: string; status: SectionStatus }
  | { type: 'prd:title_change'; title: string }
  | { type: 'prd:request_analysis' }
  | { type: 'prd:request_export'; format: 'markdown' | 'json' | 'pdf' }
  | { type: 'template:select'; templateId: string }
  | { type: 'ui:ready' };
