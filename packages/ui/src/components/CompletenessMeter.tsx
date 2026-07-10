/**
 * CompletenessMeter — visual progress indicator.
 *
 * Shows the overall PRD completeness as a circular gauge
 * and a breakdown of section statuses.
 */

import type { CompletenessScore } from '@prd-builder/shared';
import { getQualityLabel } from '@prd-builder/engine';

interface CompletenessMeterProps {
  score: CompletenessScore | null;
}

export function CompletenessMeter({ score }: CompletenessMeterProps) {
  if (!score) {
    return (
      <div className="completeness-meter empty">
        <div className="meter-label">No score yet</div>
      </div>
    );
  }

  const label = getQualityLabel(score.overall);
  const circumference = 2 * Math.PI * 45; // r=45
  const dashOffset = circumference - (score.overall / 100) * circumference;

  // Status counts
  const counts = {
    complete: score.sections.filter((s) => s.status === 'complete').length,
    review: score.sections.filter((s) => s.status === 'review').length,
    draft: score.sections.filter((s) => s.status === 'draft').length,
    empty: score.sections.filter((s) => s.status === 'empty').length,
  };

  return (
    <div className="completeness-meter">
      <div className="meter-gauge">
        <svg viewBox="0 0 100 100" className="gauge-svg">
          {/* Background circle */}
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="var(--border-color)"
            strokeWidth="6"
          />
          {/* Progress arc */}
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="var(--accent-color)"
            strokeWidth="6"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
            className="gauge-progress"
          />
        </svg>
        <div className="gauge-text">
          <span className="gauge-value">{score.overall}%</span>
          <span className="gauge-label">{label}</span>
        </div>
      </div>

      <div className="meter-breakdown">
        <div className="breakdown-item">
          <span className="status-icon">✅</span>
          <span className="status-count">{counts.complete}</span>
          <span className="status-label">Complete</span>
        </div>
        <div className="breakdown-item">
          <span className="status-icon">👀</span>
          <span className="status-count">{counts.review}</span>
          <span className="status-label">Review</span>
        </div>
        <div className="breakdown-item">
          <span className="status-icon">🔄</span>
          <span className="status-count">{counts.draft}</span>
          <span className="status-label">Draft</span>
        </div>
        <div className="breakdown-item">
          <span className="status-icon">⬜</span>
          <span className="status-count">{counts.empty}</span>
          <span className="status-label">Empty</span>
        </div>
      </div>

      {score.missingRequired.length > 0 && (
        <div className="meter-warning">
          <strong>⚠️ Missing required:</strong> {score.missingRequired.join(', ')}
        </div>
      )}

      {score.topSuggestions.length > 0 && (
        <div className="meter-suggestions">
          <strong>💡 Next steps:</strong>
          <ul>
            {score.topSuggestions.slice(0, 3).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
