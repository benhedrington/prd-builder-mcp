/**
 * usePRDState — manages local PRD state with optimistic updates.
 *
 * The UI keeps a local copy of the PRD for snappy editing (no round-trip
 * to the server for every keystroke). Changes are:
 * 1. Applied locally immediately (optimistic)
 * 2. Debounced and sent to the server via useMCPApp
 *
 * When the server pushes updates (e.g., Claude wrote a section), those
 * are merged into local state.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  PRDDocument,
  PRDSection,
  SectionStatus,
  CompletenessScore,
} from '@prd-builder/shared';

interface PRDStateResult {
  prd: PRDDocument | null;
  score: CompletenessScore | null;
  isDirty: boolean;

  // Local mutations (optimistic)
  updateSectionContent: (sectionId: string, content: string) => void;
  updateSectionStatus: (sectionId: string, status: SectionStatus) => void;
  updateTitle: (title: string) => void;
  reorderSections: (sectionIds: string[]) => void;

  // Sync from server
  syncFromServer: (prd: PRDDocument, score?: CompletenessScore) => void;
  syncSection: (section: PRDSection, score?: CompletenessScore) => void;
  syncScore: (score: CompletenessScore) => void;

  // Reset
  reset: () => void;
}

export function usePRDState(): PRDStateResult {
  const [prd, setPrd] = useState<PRDDocument | null>(null);
  const [score, setScore] = useState<CompletenessScore | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const dirtyRef = useRef(false);

  // ── Sync from server ──
  const syncFromServer = useCallback((newPrd: PRDDocument, newScore?: CompletenessScore) => {
    setPrd(newPrd);
    if (newScore) setScore(newScore);
    setIsDirty(false);
    dirtyRef.current = false;
  }, []);

  const syncSection = useCallback((section: PRDSection, newScore?: CompletenessScore) => {
    setPrd((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: prev.sections.map((s) => (s.id === section.id ? section : s)),
      };
    });
    if (newScore) setScore(newScore);
    // Don't clear dirty — the user might have other pending edits
  }, []);

  const syncScore = useCallback((newScore: CompletenessScore) => {
    setScore(newScore);
  }, []);

  // ── Local mutations (optimistic) ──

  const updateSectionContent = useCallback((sectionId: string, content: string) => {
    setPrd((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: prev.sections.map((s) =>
          s.id === sectionId
            ? { ...s, content, updatedAt: new Date().toISOString() }
            : s
        ),
        updatedAt: new Date().toISOString(),
      };
    });
    setIsDirty(true);
    dirtyRef.current = true;
  }, []);

  const updateSectionStatus = useCallback((sectionId: string, status: SectionStatus) => {
    setPrd((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: prev.sections.map((s) =>
          s.id === sectionId ? { ...s, status, updatedAt: new Date().toISOString() } : s
        ),
      };
    });
    setIsDirty(true);
    dirtyRef.current = true;
  }, []);

  const updateTitle = useCallback((title: string) => {
    setPrd((prev) => (prev ? { ...prev, title } : prev));
    setIsDirty(true);
    dirtyRef.current = true;
  }, []);

  const reorderSections = useCallback((sectionIds: string[]) => {
    setPrd((prev) => {
      if (!prev) return prev;
      const map = new Map(prev.sections.map((s) => [s.id, s]));
      const reordered = sectionIds
        .map((id, i) => {
          const s = map.get(id);
          return s ? { ...s, order: i } : null;
        })
        .filter((s): s is PRDSection => s !== null);
      return { ...prev, sections: reordered };
    });
    setIsDirty(true);
    dirtyRef.current = true;
  }, []);

  const reset = useCallback(() => {
    setPrd(null);
    setScore(null);
    setIsDirty(false);
    dirtyRef.current = false;
  }, []);

  return {
    prd,
    score,
    isDirty,
    updateSectionContent,
    updateSectionStatus,
    updateTitle,
    reorderSections,
    syncFromServer,
    syncSection,
    syncScore,
    reset,
  };
}
