/**
 * Toolbar — top bar with title, template selector, and export actions.
 */

import type { PRDTemplate } from '@prd-builder/shared';

interface ToolbarProps {
  title: string;
  template: PRDTemplate | null;
  availableTemplates: PRDTemplate[];
  isDirty: boolean;
  onTitleChange: (title: string) => void;
  onTemplateSelect: (templateId: string) => void;
  onExport: (format: 'markdown' | 'json' | 'pdf') => void;
  onAnalyze: () => void;
}

export function Toolbar({
  title,
  template,
  availableTemplates,
  isDirty,
  onTitleChange,
  onTemplateSelect,
  onExport,
  onAnalyze,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      {/* Title */}
      <div className="toolbar-title-group">
        <input
          className="toolbar-title-input"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Untitled PRD"
        />
        {isDirty && <span className="dirty-indicator" title="Unsaved changes">●</span>}
      </div>

      {/* Template selector */}
      <div className="toolbar-template-group">
        <select
          className="template-select"
          value={template?.id || ''}
          onChange={(e) => onTemplateSelect(e.target.value)}
          title="Change template"
        >
          {availableTemplates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {/* Actions */}
      <div className="toolbar-actions">
        <button className="toolbar-btn" onClick={onAnalyze} title="Run completeness analysis">
          📊 Analyze
        </button>
        <div className="export-menu">
          <button
            className="toolbar-btn primary"
            onClick={() => onExport('markdown')}
            title="Export as Markdown"
          >
            ⬇ Export MD
          </button>
          <button
            className="toolbar-btn"
            onClick={() => onExport('json')}
            title="Export as JSON"
          >
            ⬇ JSON
          </button>
        </div>
      </div>
    </div>
  );
}
