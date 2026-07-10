/**
 * Default PRD templates.
 *
 * Each template defines the section structure that a new PRD starts from.
 * Templates are the starting point — the PM (with Claude's help) fills in
 * the content section by section.
 */

import type { PRDTemplate } from '@prd-builder/shared';

// ──────────────────────────────────────────────
// Standard Feature PRD
// The default template — covers the most common product feature work.
// ──────────────────────────────────────────────

export const standardFeatureTemplate: PRDTemplate = {
  id: 'standard-feature',
  name: 'Standard Feature PRD',
  description: 'Comprehensive template for new product features. Covers problem definition through success metrics.',
  category: 'feature',
  recommended: true,
  sections: [
    {
      id: 'title-meta',
      title: 'Title & Metadata',
      type: 'text',
      required: true,
      priority: 'must',
      weight: 3,
      guidance: 'Product name, version, author, target release date, and key stakeholders.',
    },
    {
      id: 'problem-statement',
      title: 'Problem Statement',
      type: 'text',
      required: true,
      priority: 'must',
      weight: 10,
      guidance: 'What problem are users experiencing? Why does it matter now? Include data or customer quotes if available.',
    },
    {
      id: 'target-users',
      title: 'Target Users & Personas',
      type: 'text',
      required: true,
      priority: 'must',
      weight: 8,
      guidance: 'Who experiences this problem? Define primary and secondary personas. What are their goals and constraints?',
    },
    {
      id: 'solution-overview',
      title: 'Solution Overview',
      type: 'text',
      required: true,
      priority: 'must',
      weight: 9,
      guidance: 'High-level description of the proposed solution. What is the core approach? How does it address the problem?',
    },
    {
      id: 'user-stories',
      title: 'User Stories',
      type: 'user-stories',
      required: true,
      priority: 'must',
      weight: 9,
      guidance: 'Write stories in "As a [persona], I want [action], so that [benefit]" format. Include acceptance criteria.',
    },
    {
      id: 'requirements',
      title: 'Functional Requirements',
      type: 'list',
      required: true,
      priority: 'must',
      weight: 8,
      guidance: 'Detailed feature requirements. Each should be testable. Mark priority (must/should/could/wont).',
    },
    {
      id: 'non-functional',
      title: 'Non-Functional Requirements',
      type: 'list',
      required: false,
      priority: 'should',
      weight: 5,
      guidance: 'Performance, security, accessibility, scalability, and reliability requirements.',
    },
    {
      id: 'success-metrics',
      title: 'Success Metrics',
      type: 'metrics',
      required: true,
      priority: 'must',
      weight: 8,
      guidance: 'How will we measure success? Include baseline, target, and measurement method for each metric.',
      fields: [
        { id: 'metric-name', label: 'Metric', type: 'text', required: true, placeholder: 'e.g., Signup conversion rate' },
        { id: 'metric-baseline', label: 'Baseline', type: 'text', required: true, placeholder: 'Current value' },
        { id: 'metric-target', label: 'Target', type: 'text', required: true, placeholder: 'Target value' },
        { id: 'metric-method', label: 'Measurement Method', type: 'text', required: false, placeholder: 'How will this be tracked?' },
      ],
    },
    {
      id: 'timeline',
      title: 'Timeline & Milestones',
      type: 'timeline',
      required: false,
      priority: 'should',
      weight: 5,
      guidance: 'Key milestones, dependencies, and target dates. Include design, dev, QA, and launch phases.',
    },
    {
      id: 'risks',
      title: 'Risks & Mitigations',
      type: 'table',
      required: false,
      priority: 'should',
      weight: 5,
      guidance: 'What could go wrong? For each risk, note likelihood, impact, and mitigation strategy.',
    },
    {
      id: 'open-questions',
      title: 'Open Questions',
      type: 'list',
      required: false,
      priority: 'could',
      weight: 3,
      guidance: 'Unresolved questions that need further research or stakeholder input.',
    },
  ],
};

// ──────────────────────────────────────────────
// Platform/Infrastructure PRD
// For cross-cutting platform work, tech debt, or infrastructure changes.
// ──────────────────────────────────────────────

export const platformTemplate: PRDTemplate = {
  id: 'platform-initiative',
  name: 'Platform Initiative PRD',
  description: 'Template for platform, infrastructure, or cross-cutting technical initiatives.',
  category: 'platform',
  sections: [
    {
      id: 'title-meta',
      title: 'Title & Metadata',
      type: 'text',
      required: true,
      priority: 'must',
      weight: 3,
      guidance: 'Initiative name, owner, target quarter, affected teams.',
    },
    {
      id: 'problem-statement',
      title: 'Problem Statement',
      type: 'text',
      required: true,
      priority: 'must',
      weight: 10,
      guidance: 'What technical or business problem motivates this initiative? Include current-state pain points.',
    },
    {
      id: 'current-architecture',
      title: 'Current State Architecture',
      type: 'text',
      required: true,
      priority: 'must',
      weight: 7,
      guidance: 'Describe the current system architecture and where the problems manifest.',
    },
    {
      id: 'proposed-architecture',
      title: 'Proposed Solution Architecture',
      type: 'text',
      required: true,
      priority: 'must',
      weight: 9,
      guidance: 'Target architecture. Include diagrams references, key components, and data flow.',
    },
    {
      id: 'scope',
      title: 'Scope & Phasing',
      type: 'list',
      required: true,
      priority: 'must',
      weight: 8,
      guidance: 'What is in scope vs out of scope? Break into phases if multi-quarter.',
    },
    {
      id: 'impact-analysis',
      title: 'Impact Analysis',
      type: 'table',
      required: true,
      priority: 'must',
      weight: 8,
      guidance: 'Which teams/systems are affected? What changes for each? Migration plan?',
    },
    {
      id: 'success-metrics',
      title: 'Success Metrics',
      type: 'metrics',
      required: true,
      priority: 'must',
      weight: 7,
      guidance: 'Latency improvements, cost savings, reliability targets, developer productivity metrics.',
    },
    {
      id: 'risks',
      title: 'Risks & Mitigations',
      type: 'table',
      required: true,
      priority: 'must',
      weight: 6,
      guidance: 'Technical risks, migration risks, team capacity risks.',
    },
    {
      id: 'timeline',
      title: 'Timeline & Milestones',
      type: 'timeline',
      required: true,
      priority: 'must',
      weight: 5,
      guidance: 'Phase breakdown with target dates and dependencies.',
    },
  ],
};

// ──────────────────────────────────────────────
// Lightweight Bugfix / Small Change PRD
// For small, well-understood changes that still need documentation.
// ──────────────────────────────────────────────

export const bugfixTemplate: PRDTemplate = {
  id: 'bugfix-small-change',
  name: 'Bugfix / Small Change PRD',
  description: 'Lightweight template for bug fixes and small, well-scoped changes.',
  category: 'bugfix',
  sections: [
    {
      id: 'title-meta',
      title: 'Title & Metadata',
      type: 'text',
      required: true,
      priority: 'must',
      weight: 5,
      guidance: 'Brief title, author, target sprint.',
    },
    {
      id: 'problem-statement',
      title: 'Problem Description',
      type: 'text',
      required: true,
      priority: 'must',
      weight: 10,
      guidance: 'What is the bug or desired change? Include reproduction steps if applicable.',
    },
    {
      id: 'solution',
      title: 'Proposed Fix',
      type: 'text',
      required: true,
      priority: 'must',
      weight: 8,
      guidance: 'What is the proposed solution? Why this approach over alternatives?',
    },
    {
      id: 'acceptance-criteria',
      title: 'Acceptance Criteria',
      type: 'list',
      required: true,
      priority: 'must',
      weight: 8,
      guidance: 'Testable criteria that confirm the fix works.',
    },
    {
      id: 'testing-notes',
      title: 'Testing Notes',
      type: 'text',
      required: false,
      priority: 'should',
      weight: 4,
      guidance: 'Edge cases, regression risks, and test plan highlights.',
    },
  ],
};

// ──────────────────────────────────────────────
// Registry
// ──────────────────────────────────────────────

export const allTemplates: PRDTemplate[] = [
  standardFeatureTemplate,
  platformTemplate,
  bugfixTemplate,
];

export function getTemplateById(id: string): PRDTemplate | undefined {
  return allTemplates.find((t) => t.id === id);
}

export function getDefaultTemplate(): PRDTemplate {
  return standardFeatureTemplate;
}
