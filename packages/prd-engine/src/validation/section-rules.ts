/**
 * Validation rules for PRD sections.
 *
 * Each rule checks a section and returns a ValidationIssue if it violates
 * the rule. Rules are grouped by section type and run in sequence.
 *
 * The scoring engine uses these rules to determine section status
 * (empty → draft → review → complete) and to surface suggestions.
 */

import type {
  PRDSection,
  ValidationRule,
  ValidationIssue,
  SectionStatus,
} from '@prd-builder/shared';

// ──────────────────────────────────────────────
// Text Sections
// ──────────────────────────────────────────────

const textRules: ValidationRule[] = [
  {
    id: 'text:min-length',
    sectionType: 'text',
    description: 'Text sections should have at least 50 characters of content',
    severity: 'warning',
    check: (section): ValidationIssue | null => {
      if (section.content.trim().length < 50) {
        return {
          sectionId: section.id,
          severity: 'warning',
          message: `Section "${section.title}" has only ${section.content.trim().length} characters. Aim for at least 50 to provide adequate context.`,
          ruleId: 'text:min-length',
        };
      }
      return null;
    },
  },
  {
    id: 'text:has-structure',
    sectionType: 'text',
    description: 'Long text sections (>200 chars) should have some structure (paragraphs or bullets)',
    severity: 'info',
    check: (section): ValidationIssue | null => {
      if (section.content.length > 200 && !section.content.includes('\n')) {
        return {
          sectionId: section.id,
          severity: 'info',
          message: `Section "${section.title}" is a long block of text. Consider breaking it into paragraphs or bullet points for readability.`,
          ruleId: 'text:has-structure',
        };
      }
      return null;
    },
  },
];

// ──────────────────────────────────────────────
// List Sections
// ──────────────────────────────────────────────

const listRules: ValidationRule[] = [
  {
    id: 'list:min-items',
    sectionType: 'list',
    description: 'List sections should have at least 3 items',
    severity: 'warning',
    check: (section): ValidationIssue | null => {
      const items = section.content
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('- ') || l.startsWith('* ') || /^\d+\./.test(l));
      if (items.length < 3) {
        return {
          sectionId: section.id,
          severity: 'warning',
          message: `Section "${section.title}" has only ${items.length} item(s). Consider adding more detail — aim for at least 3.`,
          ruleId: 'list:min-items',
        };
      }
      return null;
    },
  },
];

// ──────────────────────────────────────────────
// User Story Sections
// ──────────────────────────────────────────────

const userStoryRules: ValidationRule[] = [
  {
    id: 'user-story:format',
    sectionType: 'user-stories',
    description: 'User stories should follow "As a... I want... so that..." format',
    severity: 'error',
    check: (section): ValidationIssue | null => {
      const stories = section.content.split('\n').filter((l) => l.trim().length > 0);
      const malformed = stories.filter(
        (s) =>
          !s.toLowerCase().includes('as a') &&
          !s.toLowerCase().includes('as an')
      );
      if (malformed.length > 0) {
        return {
          sectionId: section.id,
          severity: 'error',
          message: `${malformed.length} user story(ies) don't follow "As a [persona], I want [action], so that [benefit]" format.`,
          ruleId: 'user-story:format',
        };
      }
      return null;
    },
  },
  {
    id: 'user-story:acceptance-criteria',
    sectionType: 'user-stories',
    description: 'Each user story should have acceptance criteria',
    severity: 'warning',
    check: (section): ValidationIssue | null => {
      if (!section.content.toLowerCase().includes('acceptance') &&
          !section.content.toLowerCase().includes('given') &&
          !section.content.toLowerCase().includes('when') &&
          !section.content.toLowerCase().includes('then')) {
        return {
          sectionId: section.id,
          severity: 'warning',
          message: `No acceptance criteria detected. Each user story should have testable acceptance criteria (Given/When/Then or bullet points).`,
          ruleId: 'user-story:acceptance-criteria',
        };
      }
      return null;
    },
  },
];

// ──────────────────────────────────────────────
// Metrics Sections
// ──────────────────────────────────────────────

const metricsRules: ValidationRule[] = [
  {
    id: 'metrics:has-fields',
    sectionType: 'metrics',
    description: 'Metrics sections should have at least one defined metric with a target',
    severity: 'warning',
    check: (section): ValidationIssue | null => {
      if (!section.fields || section.fields.length === 0) {
        // Also check content for structured metric definitions
        if (!section.content.includes('target') && !section.content.includes('Target')) {
          return {
            sectionId: section.id,
            severity: 'warning',
            message: `No metrics with targets detected. Each success metric should have a name, baseline, and target value.`,
            ruleId: 'metrics:has-fields',
          };
        }
      }
      return null;
    },
  },
];

// ──────────────────────────────────────────────
// Universal Rules (apply to all section types)
// ──────────────────────────────────────────────

const universalRules: ValidationRule[] = [
  {
    id: 'universal:not-empty',
    sectionType: 'text',
    description: 'Required sections must not be empty',
    severity: 'error',
    // This rule is special-cased in the validator — see runValidation()
    check: () => null,
  },
  {
    id: 'universal:no-placeholder',
    sectionType: 'text',
    description: 'Sections should not contain placeholder text (e.g., "TODO", "TBD", "FIXME")',
    severity: 'warning',
    check: (section): ValidationIssue | null => {
      const placeholders = ['TODO', 'TBD', 'FIXME', 'PLACEHOLDER', 'Lorem ipsum'];
      const found = placeholders.filter((p) =>
        section.content.toUpperCase().includes(p.toUpperCase())
      );
      if (found.length > 0) {
        return {
          sectionId: section.id,
          severity: 'warning',
          message: `Section "${section.title}" contains placeholder text: ${found.join(', ')}. Replace with actual content.`,
          ruleId: 'universal:no-placeholder',
        };
      }
      return null;
    },
  },
];

// ──────────────────────────────────────────────
// Rule Registry
// ──────────────────────────────────────────────

const rulesByType: Record<string, ValidationRule[]> = {
  text: [...textRules],
  list: [...listRules],
  'user-stories': [...userStoryRules],
  metrics: [...metricsRules],
  table: [],
  timeline: [],
};

const allRules: ValidationRule[] = [
  ...universalRules,
  ...Object.values(rulesByType).flat(),
];

// ──────────────────────────────────────────────
// Validation Runner
// ──────────────────────────────────────────────

/**
 * Run all applicable validation rules against a section.
 * Returns the list of issues found (empty array = no issues).
 */
export function validateSection(section: PRDSection): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Universal: empty check for required sections
  if (section.required && section.content.trim().length === 0) {
    issues.push({
      sectionId: section.id,
      severity: 'error',
      message: `Required section "${section.title}" is empty.`,
      ruleId: 'universal:not-empty',
    });
  }

  // Universal: placeholder check
  const universalIssue = universalRules[1].check(section);
  if (universalIssue) issues.push(universalIssue);

  // Type-specific rules
  const typeRules = rulesByType[section.type] || [];
  for (const rule of typeRules) {
    const issue = rule.check(section);
    if (issue) issues.push(issue);
  }

  return issues;
}

/**
 * Run validation across all sections of a PRD.
 */
export function validateAllSections(sections: PRDSection[]): ValidationIssue[] {
  return sections.flatMap((s) => validateSection(s));
}

/**
 * Determine the status of a section based on validation results.
 * This is the core state machine: empty → draft → review → complete
 */
export function determineSectionStatus(
  section: PRDSection,
  issues: ValidationIssue[]
): SectionStatus {
  // Empty
  if (section.content.trim().length === 0 && (!section.fields || section.fields.every((f) => !f.value))) {
    return 'empty';
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  // Has errors → draft (needs work)
  if (errors.length > 0) {
    return 'draft';
  }

  // Has warnings but no errors → review (PM should review)
  if (warnings.length > 0) {
    return 'review';
  }

  // No issues → complete
  return 'complete';
}

export { allRules };
