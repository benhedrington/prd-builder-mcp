/**
 * useMCPApp — hook for communicating with the MCP host.
 *
 * This wraps the @modelcontextprotocol/ext-apps SDK's PostMessageTransport
 * to provide a clean React hook for:
 * 1. Receiving data from the server (PRD loaded, section updated, etc.)
 * 2. Sending user actions back to the server (edits, reorders, exports)
 *
 * The communication happens via postMessage between the iframe (this UI)
 * and the host (Claude/ChatGPT), which proxies to the MCP server.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  ServerToUIMessage,
  UIToServerMessage,
  PRDDocument,
  CompletenessScore,
  PRDTemplate,
} from '@prd-builder/shared';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface MCPAppState {
  prd: PRDDocument | null;
  score: CompletenessScore | null;
  template: PRDTemplate | null;
  connected: boolean;
  lastMessage: ServerToUIMessage | null;
}

// ──────────────────────────────────────────────
// Hook
// ──────────────────────────────────────────────

export function useMCPApp() {
  const [state, setState] = useState<MCPAppState>({
    prd: null,
    score: null,
    template: null,
    connected: false,
    lastMessage: null,
  });

  const transportRef = useRef<any>(null);

  // ── Setup: connect to host via postMessage ──
  useEffect(() => {
    // The ext-apps SDK provides a transport that handles the postMessage protocol.
    // In a real build, import from @modelcontextprotocol/ext-apps
    // For now, we implement a minimal postMessage listener that works with
    // the MCP Apps JSON-RPC protocol.

    const handleMessage = (event: MessageEvent) => {
      // Verify origin for security — in production, check against allowed origins
      // const allowedOrigin = ... ;
      // if (event.origin !== allowedOrigin) return;

      const data = event.data;
      if (!data || typeof data !== 'object') return;

      // MCP Apps messages come wrapped in JSON-RPC
      // The SDK handles the protocol details — here we extract the notification payload
      const message = extractMessage(data) as ServerToUIMessage | null;
      if (!message) return;

      setState((prev) => {
        const newState = { ...prev, lastMessage: message };

        switch (message.type) {
          case 'prd:loaded':
            return { ...newState, prd: message.prd, score: message.score, connected: true };
          case 'section:updated':
            if (prev.prd) {
              return {
                ...newState,
                prd: {
                  ...prev.prd,
                  sections: prev.prd.sections.map((s) =>
                    s.id === message.section.id ? message.section : s
                  ),
                },
                score: message.score,
              };
            }
            return newState;
          case 'section:content_pushed':
            if (prev.prd) {
              return {
                ...newState,
                prd: {
                  ...prev.prd,
                  sections: prev.prd.sections.map((s) =>
                    s.id === message.sectionId ? { ...s, content: message.content } : s
                  ),
                },
              };
            }
            return newState;
          case 'score:updated':
            return { ...newState, score: message.score };
          case 'template:loaded':
            return { ...newState, template: message.template };
          case 'export:ready':
            // Trigger download or display in UI
            return newState;
          default:
            return newState;
        }
      });
    };

    window.addEventListener('message', handleMessage);

    // Signal that the UI is ready to receive data
    sendMessage({ type: 'ui:ready' });

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  // ── Send messages to server ──
  const sendMessage = useCallback((message: UIToServerMessage) => {
    // Wrap in JSON-RPC notification format that the host expects
    const envelope = {
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: message,
    };
    window.parent.postMessage(envelope, '*'); // In production, use specific origin
  }, []);

  // ── Convenience methods for common actions ──

  const editSection = useCallback(
    (sectionId: string, content: string) => {
      sendMessage({ type: 'section:edit', sectionId, content });
    },
    [sendMessage]
  );

  const changeField = useCallback(
    (sectionId: string, fieldId: string, value: any) => {
      sendMessage({ type: 'section:field_change', sectionId, fieldId, value });
    },
    [sendMessage]
  );

  const reorderSections = useCallback(
    (sectionIds: string[]) => {
      sendMessage({ type: 'section:reorder', sectionIds });
    },
    [sendMessage]
  );

  const changeSectionStatus = useCallback(
    (sectionId: string, status: any) => {
      sendMessage({ type: 'section:status_change', sectionId, status });
    },
    [sendMessage]
  );

  const changeTitle = useCallback(
    (title: string) => {
      sendMessage({ type: 'prd:title_change', title });
    },
    [sendMessage]
  );

  const requestAnalysis = useCallback(() => {
    sendMessage({ type: 'prd:request_analysis' });
  }, [sendMessage]);

  const requestExport = useCallback(
    (format: 'markdown' | 'json' | 'pdf') => {
      sendMessage({ type: 'prd:request_export', format });
    },
    [sendMessage]
  );

  const selectTemplate = useCallback(
    (templateId: string) => {
      sendMessage({ type: 'template:select', templateId });
    },
    [sendMessage]
  );

  return {
    // State
    prd: state.prd,
    score: state.score,
    template: state.template,
    connected: state.connected,
    // Actions
    editSection,
    changeField,
    reorderSections,
    changeSectionStatus,
    changeTitle,
    requestAnalysis,
    requestExport,
    selectTemplate,
  };
}

// ──────────────────────────────────────────────
// Helper: extract message from JSON-RPC envelope
// ──────────────────────────────────────────────

function extractMessage(data: any): ServerToUIMessage | null {
  // Direct message format (simplified protocol)
  if (data.type && data.type.startsWith('prd:') || data.type?.startsWith('section:') ||
      data.type?.startsWith('score:') || data.type?.startsWith('template:') ||
      data.type?.startsWith('export:') || data.type === 'ui:ready') {
    return data;
  }

  // JSON-RPC notification format (standard MCP Apps protocol)
  if (data.jsonrpc === '2.0' && data.method === 'notifications/message') {
    return data.params as ServerToUIMessage;
  }

  // JSON-RPC result (response to a tool call)
  if (data.jsonrpc === '2.0' && data.result?._meta?.prd) {
    return {
      type: 'prd:loaded',
      prd: data.result._meta.prd.prd,
      score: data.result._meta.prd.score,
    };
  }

  return null;
}
