/**
 * SectionEditor — inline editor for a single PRD section.
 *
 * Features:
 * - Editable text area for free-form content
 * - Structured field editing (for metrics, tables, etc.)
 * - Status selector (manual override)
 * - Real-time validation feedback (issues + suggestions)
 * - Guidance text when section is empty
 *
 * Edits are applied optimistically to local state and debounced
 * before being sent to the server.
 */

import { useState, useEffect, useRef } from 'react';
import type { PRDSection, SectionScore, SectionStatus, PRDField } from '@prd-builder/shared';

interface SectionEditorProps {
  section: PRDSection | null;
  score: SectionScore | undefined;
  onContentChange: (sectionId: string, content: string) => void;
  onFieldChange: (sectionId: string, fieldId: string, value: PRDField['value']) => void;
  onStatusChange: (sectionId: string, status: SectionStatus) => void;
}

const STATUS_OPTIONS: { value: SectionStatus; label: string; icon: string }[] = [
  { value: 'empty', label: 'Empty', icon: '⬜' },
  { value: 'draft', label: 'Draft', icon: '🔄' },
  { value: 'review', label: 'Review', icon: '👀' },
  { value: 'complete', label: 'Complete', icon: '✅' },
];

export function SectionEditor({
  section,
  score,
  onContentChange,
  onFieldChange,
  onStatusChange,
}: SectionEditorProps) {
  const [content, setContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync local content when section changes (e.g., server push)
  useEffect(() => {
    if (section) {
      setContent(section.content);
    }
  }, [section?.id, section?.content]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [content]);

  if (!section) {
    return (
      <div className="section-editor empty">
        <div className="editor-placeholder">
          <p>Select a section from the left to start editing.</p>
          <p>Or ask Claude in the chat to help draft a section for you.</p>
        </div>
      </div>
    );
  }

  const handleContentChange = (value: string) => {
    setContent(value);
    setIsEditing(true);

    // Debounce send to server
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onContentChange(section.id, value);
      setIsEditing(false);
    }, 500);
  };

  return (
    <div className="section-editor">
      {/* Section Header */}
      <div className="editor-header">
        <div className="editor-title-row">
          <h2 className="editor-title">{section.title}</h2>
          {section.required && (
            <span className="required-badge">Required</span>
          )}
          <span className={`priority-badge priority-${section.priority}`}>
            {section.priority.toUpperCase()}
          </span>
        </div>

        {/* Status selector */}
        <div className="status-selector">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`status-btn ${section.status === opt.value ? 'active' : ''}`}
              onClick={() => onStatusChange(section.id, opt.value)}
              title={opt.label}
            >
              {opt.icon} <span className="status-label">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Guidance (shown when empty) */}
      {section.content.trim().length === 0 && section.guidance && (
        <div className="section-guidance">
          <strong>💡 Guidance:</strong> {section.guidance}
        </div>
      )}

      {/* Main content editor */}
      <div className="editor-content">
        <textarea
          ref={textareaRef}
          className="content-textarea"
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          placeholder={`Write the ${section.title.toLowerCase()} here...\n\nTip: You can also ask Claude in the chat to draft this section for you.`}
          rows={6}
        />
        {isEditing && <div className="saving-indicator">Saving...</div>}
      </div>

      {/* Structured fields (for metrics, etc.) */}
      {section.fields && section.fields.length > 0 && (
        <div className="section-fields">
          <h4>Structured Fields</h4>
          {section.fields.map((field) => (
            <div key={field.id} className="field-row">
              <label className="field-label">
                {field.label}
                {field.required && <span className="required-marker">*</span>}
              </label>
              {field.helpText && (
                <div className="field-help">{field.helpText}</div>
              )}
              {field.type === 'textarea' ? (
                <textarea
                  className="field-input field-textarea"
                  value={(field.value as string) || ''}
                  placeholder={field.placeholder}
                  onChange={(e) => onFieldChange(section.id, field.id, e.target.value)}
                  rows={3}
                />
              ) : field.type === 'select' ? (
                <select
                  className="field-input field-select"
                  value={(field.value as string) || ''}
                  onChange={(e) => onFieldChange(section.id, field.id, e.target.value)}
                >
                  <option value="">— Select —</option>
                  {field.options?.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                  className="field-input field-text"
                  value={(field.value as string | number) || ''}
                  placeholder={field.placeholder}
                  onChange={(e) =>
                    onFieldChange(
                      section.id,
                      field.id,
                      field.type === 'number' ? Number(e.target.value) : e.target.value
                    )
                  }
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Validation feedback */}
      {score && score.issues.length > 0 && (
        <div className="section-issues">
          <h4>Issues</h4>
          {score.issues.map((issue, i) => (
            <div key={i} className={`issue issue-${issue.severity}`}>
              <span className="issue-icon">
                {issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️'}
              </span>
              <span className="issue-message">{issue.message}</span>
            </div>
          ))}
        </div>
      )}

      {score && score.suggestions.length > 0 && (
        <div className="section-suggestions">
          <h4>Suggestions</h4>
          <ul>
            {score.suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
