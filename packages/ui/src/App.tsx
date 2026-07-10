/**
 * App — main PRD Builder UI component.
 *
 * This is what renders inside Claude's chat conversation (in a sandboxed iframe).
 *
 * Layout:
 * ┌──────────────────────────────────────────────┐
 * │  Toolbar (title, template, export)            │
 * ├────────────┬─────────────────────────────────┤
 * │            │                                  │
 * │  PRD       │  Section Editor                  │
 * │  Outline   │  (content, fields, issues)       │
 * │  (sidebar) │                                  │
 * │            │                                  │
 * │            ├─────────────────────────────────┤
 * │            │  Completeness Meter              │
 * │            │  (score gauge + breakdown)       │
 * └────────────┴─────────────────────────────────┘
 *
 * Data flow:
 * - useMCPApp handles bidirectional comms with the server/LLM
 * - usePRDState manages local state with optimistic updates
 * - User edits → local state → debounced send to server
 * - Server pushes (Claude's content) → synced into local state
 */

import { useState, useEffect } from 'react';
import { useMCPApp } from './hooks/useMCPApp';
import { usePRDState } from './hooks/usePRDState';
import { Toolbar } from './components/Toolbar';
import { PRDOutline } from './components/PRDOutline';
import { SectionEditor } from './components/SectionEditor';
import { CompletenessMeter } from './components/CompletenessMeter';
import { allTemplates } from '@prd-builder/engine';
import type { PRDSection } from '@prd-builder/shared';
import './styles/main.css';

export function App() {
  // MCP communication
  const mcp = useMCPApp();

  // Local PRD state (optimistic updates)
  const prdState = usePRDState();

  // Selected section for editing
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);

  // ── Sync incoming server messages into local state ──
  useEffect(() => {
    if (mcp.prd) {
      prdState.syncFromServer(mcp.prd, mcp.score ?? undefined);
    }
  }, [mcp.prd, mcp.score]);

  // Auto-select first section when PRD loads
  useEffect(() => {
    if (prdState.prd && !selectedSectionId && prdState.prd.sections.length > 0) {
      setSelectedSectionId(prdState.prd.sections[0].id);
    }
  }, [prdState.prd, selectedSectionId]);

  // ── If no PRD loaded, show loading/connecting state ──
  if (!prdState.prd) {
    return (
      <div className="prd-builder-app">
        <div className="app-loading">
          <div className="loading-spinner" />
          <p>Connecting to PRD Builder...</p>
          <p className="loading-hint">
            If this persists, try asking Claude to "open the PRD builder" in the chat.
          </p>
        </div>
      </div>
    );
  }

  // ── Get selected section ──
  const selectedSection: PRDSection | null =
    prdState.prd.sections.find((s) => s.id === selectedSectionId) ?? null;

  const selectedScore = mcp.score?.sections.find(
    (s) => s.sectionId === selectedSectionId
  );

  // ── Handlers ──

  const handleContentChange = (sectionId: string, content: string) => {
    prdState.updateSectionContent(sectionId, content);
    mcp.editSection(sectionId, content);
  };

  const handleFieldChange = (sectionId: string, fieldId: string, value: any) => {
    mcp.changeField(sectionId, fieldId, value);
  };

  const handleStatusChange = (sectionId: string, status: any) => {
    prdState.updateSectionStatus(sectionId, status);
    mcp.changeSectionStatus(sectionId, status);
  };

  const handleReorder = (sectionIds: string[]) => {
    prdState.reorderSections(sectionIds);
    mcp.reorderSections(sectionIds);
  };

  const handleTitleChange = (title: string) => {
    prdState.updateTitle(title);
    mcp.changeTitle(title);
  };

  const handleExport = (format: 'markdown' | 'json' | 'pdf') => {
    mcp.requestExport(format);
  };

  const handleAnalyze = () => {
    mcp.requestAnalysis();
  };

  const handleTemplateSelect = (templateId: string) => {
    mcp.selectTemplate(templateId);
  };

  // ── Render ──

  return (
    <div className="prd-builder-app">
      <Toolbar
        title={prdState.prd.title}
        template={mcp.template}
        availableTemplates={allTemplates}
        isDirty={prdState.isDirty}
        onTitleChange={handleTitleChange}
        onTemplateSelect={handleTemplateSelect}
        onExport={handleExport}
        onAnalyze={handleAnalyze}
      />

      <div className="app-body">
        <PRDOutline
          sections={prdState.prd.sections}
          scores={mcp.score?.sections}
          selectedSectionId={selectedSectionId}
          onSelectSection={setSelectedSectionId}
          onReorder={handleReorder}
        />

        <div className="app-main">
          <SectionEditor
            section={selectedSection}
            score={selectedScore}
            onContentChange={handleContentChange}
            onFieldChange={handleFieldChange}
            onStatusChange={handleStatusChange}
          />

          <CompletenessMeter score={mcp.score} />
        </div>
      </div>
    </div>
  );
}
