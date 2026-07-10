/**
 * Completeness scoring engine.
 *
 * Calculates a weighted completeness score for a PRD document.
 * Each section contributes to the overall score based on:
 *   - Its own quality score (0-100, derived from validation)
 *   - Its weight (1-10, set in the template)
 *
 * The overall score = sum(sectionScore * sectionWeight) / sum(all weights)
 *
 * Also generates actionable suggestions for improving incomplete sections.
 */

import type {
  PRDDocument,
  PRDSection,
  CompletenessScore,
  SectionScore,
  ValidationIssue,
} from '@prd-builder/shared';
import { validateSection, determineSectionStatus } from '../validation/section-rules';

// ──────────────────────────────────────────────
// Per-Section Scoring
// ──────────────────────────────────────────────

/**
 * Calculate a 0-100 quality score for a single section.
 *
 * Scoring logic:
 * - Start at 100
 * - Subtract 40 per error (required content missing, format violations)
 * - Subtract 15 per warning (too short, missing acceptance criteria, etc.)
 * - Subtract 5 per info issue
 * - Clamp to 0-100
 */
function scoreSection(section: PRDSection): SectionScore {
  const issues = validateSection(section);
  const status = determineSectionStatus(section, issues);

  let score = 100;
  for (const issue of issues) {
    switch (issue.severity) {
      case 'error':
        score -= 40;
        break;
      case 'warning':
        score -= 15;
        break;
      case 'info':
        score -= 5;
        break;
    }
  }
  score = Math.max(0, Math.min(100, score));

  // Empty sections get 0
  if (status === 'empty') {
    score = 0;
  }

  const suggestions = generateSectionSuggestions(section, issues, status);

  return {
    sectionId: section.id,
    sectionTitle: section.title,
    score,
    status,
    weight: section.weight,
    // Weighted score is calculated relative to total weight in the document
    weightedScore: 0, // Filled in by scoreDocument
    issues,
    suggestions,
  };
}

// ──────────────────────────────────────────────
// Suggestions
// ──────────────────────────────────────────────

function generateSectionSuggestions(
  section: PRDSection,
  issues: ValidationIssue[],
  status: PRDSection['status']
): string[] {
  const suggestions: string[] = [];

  if (status === 'empty') {
    if (section.guidance) {
      suggestions.push(`Start here: ${section.guidance}`);
    } else {
      suggestions.push(`This section is empty. Ask Claude to help draft it based on the problem statement.`);
    }
    return suggestions;
  }

  // Convert issues to actionable suggestions
  for (const issue of issues) {
    switch (issue.ruleId) {
      case 'text:min-length':
        suggestions.push(`Expand "${section.title}" — add more detail about the why and what.`);
        break;
      case 'text:has-structure':
        suggestions.push(`Break "${section.title}" into paragraphs or bullets for readability.`);
        break;
      case 'list:min-items':
        suggestions.push(`Add more items to "${section.title}" — aim for at least 3.`);
        break;
      case 'user-story:format':
        suggestions.push(`Reformat user stories to: "As a [persona], I want [action], so that [benefit]"`);
        break;
      case 'user-story:acceptance-criteria':
        suggestions.push(`Add acceptance criteria to each user story (Given/When/Then or bullet points).`);
        break;
      case 'metrics:has-fields':
        suggestions.push(`Define at least one metric with a name, baseline, and target value.`);
        break;
      case 'universal:no-placeholder':
        suggestions.push(`Replace placeholder text (TODO, TBD) in "${section.title}" with actual content.`);
        break;
      default:
        suggestions.push(issue.message);
    }
  }

  if (suggestions.length === 0 && status === 'review') {
    suggestions.push(`Section looks good — review and mark as complete when satisfied.`);
  }

  return suggestions;
}

// ──────────────────────────────────────────────
// Document-Level Scoring
// ──────────────────────────────────────────────

/**
 * Calculate the overall completeness score for a PRD document.
 *
 * The score is a weighted average of all section scores.
 * Required sections that are empty pull the score down significantly
 * because they have score=0 AND typically high weight.
 */
export function scoreDocument(prd: PRDDocument): CompletenessScore {
  const sectionScores = prd.sections.map((s) => scoreSection(s));

  // Calculate total weight
  const totalWeight = prd.sections.reduce((sum, s) => sum + s.weight, 0);

  // Calculate weighted scores and overall
  let overall = 0;
  for (const ss of sectionScores) {
    ss.weightedScore = totalWeight > 0 ? (ss.score * ss.weight) / totalWeight : 0;
    overall += ss.weightedScore;
  }
  overall = Math.round(overall);

  // Find missing required sections
  const missingRequired = prd.sections
    .filter((s) => s.required && s.status === 'empty')
    .map((s) => s.title);

  // Top suggestions: prioritize empty required sections, then high-weight incomplete sections
  const topSuggestions = sectionScores
    .filter((ss) => ss.suggestions.length > 0)
    .sort((a, b) => {
      // Empty required sections first
      const aEmpty = a.status === 'empty' && prd.sections.find((s) => s.id === a.sectionId)?.required;
      const bEmpty = b.status === 'empty' && prd.sections.find((s) => s.id === b.sectionId)?.required;
      if (aEmpty && !bEmpty) return -1;
      if (bEmpty && !aEmpty) return 1;
      // Then by weight (higher weight = more impact)
      return b.weight - a.weight;
    })
    .slice(0, 5)
    .flatMap((ss) => ss.suggestions.slice(0, 1)); // One suggestion per section

  return {
    overall,
    sections: sectionScores,
    missingRequired,
    topSuggestions,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Get a human-readable quality label from a score.
 */
export function getQualityLabel(score: number): string {
  if (score >= 85) return 'Excellent — ready for review';
  if (score >= 70) return 'Good — minor improvements needed';
  if (score >= 50) return 'Fair — several sections need work';
  if (score >= 25) return 'Poor — major sections incomplete';
  return 'Draft — just getting started';
}
