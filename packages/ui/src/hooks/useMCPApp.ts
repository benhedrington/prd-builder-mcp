/**
 * useMCPApp — hook for communicating with the MCP host.
 *
 * Implements the MCP Apps communication protocol (SEP-1865):
 * 1. UI sends `ui/initialize` request to host via postMessage
 * 2. Host responds with `McpUiInitializeResult` (theme, tool context)
 * 3. UI sends `ui/notifications/initialized` notification
 * 4. Host sends `ui/notifications/tool-result` with the tool call data
 * 5. UI can call `tools/call` to invoke tools on the server via the host
 *
 * All communication uses JSON-RPC 2.0 over postMessage.
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
  hostContext: HostContext | null;
  lastMessage: ServerToUIMessage | null;
}

interface HostContext {
  theme?: 'light' | 'dark';
  toolInfo?: {
    name: string;
    inputSchema: Record<string, unknown>;
  };
  displayMode?: 'inline' | 'fullscreen' | 'pip';
}

// ──────────────────────────────────────────────
// JSON-RPC helpers
// ──────────────────────────────────────────────

let nextRequestId = 1;

function sendRequest(method: string, params: Record<string, unknown>): Promise<any> {
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    const listener = (event: MessageEvent) => {
      const data = event.data;
      if (data?.id === id) {
        window.removeEventListener('message', listener);
        if (data.error) reject(new Error(JSON.stringify(data.error)));
        else resolve(data.result);
      }
    };
    window.addEventListener('message', listener);
    window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
    // Timeout after 10s — host may not respond if not ready
    setTimeout(() => {
      window.removeEventListener('message', listener);
      reject(new Error(`Timeout waiting for ${method} response`));
    }, 10000);
  });
}

function sendNotification(method: string, params: Record<string, unknown>) {
  window.parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
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
    hostContext: null,
    lastMessage: null,
  });

  const initializedRef = useRef(false);

  // ── Setup: perform the ui/initialize handshake ──
  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        // Step 1: Send ui/initialize request to the host
        const result = await sendRequest('ui/initialize', {
          protocolVersion: '2026-01-26',
          clientInfo: { name: 'prd-builder-ui', version: '1.0.0' },
          capabilities: {},
        });

        if (cancelled) return;

        const hostContext: HostContext = {
          theme: result?.hostContext?.theme,
          toolInfo: result?.hostContext?.toolInfo?.tool
            ? { name: result.hostContext.toolInfo.tool.name, inputSchema: result.hostContext.toolInfo.tool.inputSchema || {} }
            : undefined,
          displayMode: result?.hostContext?.displayMode,
        };

        setState((prev) => ({
          ...prev,
          hostContext,
          connected: true,
        }));

        // Step 2: Send ui/notifications/initialized
        sendNotification('ui/notifications/initialized', {});

        initializedRef.current = true;
      } catch (err) {
        // Host may not support the full handshake — try a degraded mode
        console.warn('[useMCPApp] ui/initialize failed, falling back:', err);
        setState((prev) => ({ ...prev, connected: false }));
      }
    }

    initialize();

    // ── Listen for host notifications ──
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      // Only handle JSON-RPC messages
      if (data.jsonrpc !== '2.0') return;

      // Handle ui/notifications/tool-result — this carries the tool call data
      if (data.method === 'ui/notifications/tool-result') {
        const toolResult = data.params;
        const prdData = toolResult?._meta?.prd || toolResult?.structuredContent;

        if (prdData?.prd) {
          setState((prev) => ({
            ...prev,
            prd: prdData.prd,
            score: prdData.score,
            connected: true,
            lastMessage: {
              type: 'prd:loaded' as const,
              prd: prdData.prd,
              score: prdData.score,
            },
          }));
        } else if (toolResult?.structuredContent) {
          // Parse structuredContent for PRD data
          const sc = toolResult.structuredContent;
          if (sc.prdId) {
            // This is from open_prd_builder — build a minimal PRD from the section map
            // The full PRD might come via _meta
            setState((prev) => ({
              ...prev,
              connected: true,
              lastMessage: {
                type: 'prd:loaded' as const,
                prd: prev.prd, // may be set via _meta above
                score: prev.score,
              },
            }));
          }
        }
        return;
      }

      // Handle ui/notifications/host-context-changed (theme changes, etc.)
      if (data.method === 'ui/notifications/host-context-changed') {
        const ctx = data.params;
        setState((prev) => ({
          ...prev,
          hostContext: {
            ...prev.hostContext,
            theme: ctx?.theme || prev.hostContext?.theme,
          },
        }));
        return;
      }

      // Handle ui/notifications/tool-input (input changes before result)
      if (data.method === 'ui/notifications/tool-input') {
        // Tool input received — could use for live preview
        return;
      }

      // Handle ui/resource-teardown
      if (data.method === 'ui/resource-teardown') {
        setState((prev) => ({ ...prev, connected: false }));
        return;
      }

      // Handle responses to our requests (already handled by sendRequest listeners)
      // Handle server-pushed notifications for section updates, etc.
      const message = extractAppMessage(data);
      if (message) {
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
            default:
              return newState;
          }
        });
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      cancelled = true;
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  // ── Send messages to server via host proxy ──
  const sendMessage = useCallback((message: UIToServerMessage) => {
    // Use JSON-RPC notification — the host forwards to the MCP server
    sendNotification('notifications/message', message as unknown as Record<string, unknown>);
  }, []);

  // ── Call a tool on the MCP server via the host ──
  const callTool = useCallback(async (toolName: string, args: Record<string, unknown>) => {
    return sendRequest('tools/call', { name: toolName, arguments: args });
  }, []);

  // ── Convenience methods ──

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
    hostContext: state.hostContext,
    // Actions
    editSection,
    changeField,
    reorderSections,
    changeSectionStatus,
    changeTitle,
    requestAnalysis,
    requestExport,
    selectTemplate,
    callTool,
  };
}

// ──────────────────────────────────────────────
// Helper: extract app-specific message from JSON-RPC envelope
// ──────────────────────────────────────────────

function extractAppMessage(data: any): ServerToUIMessage | null {
  // Direct message format (our custom protocol layer)
  if (data.type) {
    if (data.type.startsWith('prd:') || data.type.startsWith('section:') ||
        data.type.startsWith('score:') || data.type.startsWith('template:') ||
        data.type.startsWith('export:')) {
      return data as ServerToUIMessage;
    }
  }

  // JSON-RPC notification with our custom message types
  if (data.jsonrpc === '2.0' && data.method === 'notifications/message' && data.params) {
    return data.params as ServerToUIMessage;
  }

  return null;
}