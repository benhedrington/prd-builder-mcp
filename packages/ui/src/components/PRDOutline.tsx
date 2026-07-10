/**
 * PRDOutline — the sidebar list of all PRD sections.
 *
 * Shows each section with:
 * - Status icon (⬜🔄👀✅)
 * - Title (with required indicator)
 * - Mini progress bar
 * - Drag handle for reordering
 *
 * Clicking a section selects it for editing in the SectionEditor.
 */

import type { PRDSection, SectionScore } from '@prd-builder/shared';

interface PRDOutlineProps {
  sections: PRDSection[];
  scores: SectionScore[] | undefined;
  selectedSectionId: string | null;
  onSelectSection: (sectionId: string) => void;
  onReorder: (sectionIds: string[]) => void;
}

export function PRDOutline({
  sections,
  scores,
  selectedSectionId,
  onSelectSection,
  onReorder,
}: PRDOutlineProps) {
  const sorted = [...sections].sort((a, b) => a.order - b.order);

  const handleDragStart = (e: React.DragEvent, sectionId: string) => {
    e.dataTransfer.setData('text/plain', sectionId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId === targetId) return;

    const ids = sorted.map((s) => s.id);
    const draggedIdx = ids.indexOf(draggedId);
    const targetIdx = ids.indexOf(targetId);
    if (draggedIdx === -1 || targetIdx === -1) return;

    // Reorder
    ids.splice(draggedIdx, 1);
    ids.splice(targetIdx, 0, draggedId);
    onReorder(ids);
  };

  const statusIcons: Record<string, string> = {
    empty: '⬜',
    draft: '🔄',
    review: '👀',
    complete: '✅',
  };

  return (
    <div className="prd-outline">
      <div className="outline-header">
        <h3>Sections</h3>
      </div>
      <div className="outline-list">
        {sorted.map((section) => {
          const score = scores?.find((s) => s.sectionId === section.id);
          const isSelected = section.id === selectedSectionId;
          const hasIssues = score && score.issues.length > 0;

          return (
            <div
              key={section.id}
              className={`outline-item ${isSelected ? 'selected' : ''} ${hasIssues ? 'has-issues' : ''}`}
              draggable
              onDragStart={(e) => handleDragStart(e, section.id)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, section.id)}
              onClick={() => onSelectSection(section.id)}
            >
              <div className="outline-item-drag">⋮⋮</div>
              <div className="outline-item-status">
                {statusIcons[section.status]}
              </div>
              <div className="outline-item-content">
                <div className="outline-item-title">
                  {section.title}
                  {section.required && <span className="required-marker" title="Required">*</span>}
                </div>
                {score && (
                  <div className="outline-item-meta">
                    <div className="mini-progress">
                      <div
                        className="mini-progress-fill"
                        style={{ width: `${score.score}%` }}
                      />
                    </div>
                    <span className="mini-score">{score.score}%</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
