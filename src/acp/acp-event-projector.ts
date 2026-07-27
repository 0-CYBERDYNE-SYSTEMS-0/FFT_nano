import type {
  SessionNotification,
  ToolCallContent,
} from '@agentclientprotocol/sdk';

import type { HostEvent } from '../runtime/host-events.js';

export interface AcpProjectionState {
  readonly assistantTextByRun: Map<string, string>;
}

export function createAcpProjectionState(): AcpProjectionState {
  return {
    assistantTextByRun: new Map(),
  };
}

export function projectEventToAcpNotifications(
  event: HostEvent,
  sessionId: string,
  activeRunId: string,
  state: AcpProjectionState,
): SessionNotification[] {
  switch (event.kind) {
    case 'run_state':
      if (event.runId !== activeRunId) return [];
      if ('phase' in event) return [];
      if (!event.message || event.message.role !== 'assistant') return [];
      if (
        event.state !== 'delta' &&
        event.state !== 'final' &&
        event.state !== 'error'
      ) {
        return [];
      }
      return projectAssistantText(
        event.runId,
        event.message.content,
        sessionId,
        state,
      );
    case 'tool_progress':
      if (event.runId !== activeRunId) return [];
      return [
        {
          sessionId,
          update:
            event.status === 'start'
              ? {
                  sessionUpdate: 'tool_call',
                  toolCallId: `${event.runId}:${event.index}`,
                  title: event.toolName,
                  kind: inferToolKind(event.toolName),
                  status: 'in_progress',
                  ...(event.args ? { rawInput: event.args } : {}),
                }
              : {
                  sessionUpdate: 'tool_call_update',
                  toolCallId: `${event.runId}:${event.index}`,
                  status: event.status === 'ok' ? 'completed' : 'failed',
                  ...(event.output ? { rawOutput: event.output } : {}),
                  ...(event.error ? { rawOutput: event.error } : {}),
                  ...toolOutputContent(event.output || event.error),
                },
        },
      ];
    case 'run_progress':
      if (event.runId !== activeRunId || event.phase !== 'thinking') return [];
      return [
        {
          sessionId,
          update: {
            sessionUpdate: 'agent_thought_chunk',
            messageId: `${event.runId}:thought`,
            content: { type: 'text', text: event.text },
          },
        },
      ];
    case 'chat_delivery_requested':
    case 'ipc_request':
    case 'ipc_result':
    case 'file_transfer':
    case 'host_error':
      return [];
  }
}

function projectAssistantText(
  runId: string,
  text: string,
  sessionId: string,
  state: AcpProjectionState,
): SessionNotification[] {
  const previous = state.assistantTextByRun.get(runId) || '';
  const nextChunk = text.startsWith(previous)
    ? text.slice(previous.length)
    : text;
  state.assistantTextByRun.set(runId, text);
  if (!nextChunk) return [];
  return [
    {
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: runId,
        content: { type: 'text', text: nextChunk },
      },
    },
  ];
}

function inferToolKind(
  toolName: string,
): 'execute' | 'read' | 'edit' | 'other' {
  const normalized = toolName.trim().toLowerCase();
  if (normalized === 'bash' || normalized === 'shell') return 'execute';
  if (normalized.includes('read')) return 'read';
  if (normalized.includes('write') || normalized.includes('edit'))
    return 'edit';
  return 'other';
}

function toolOutputContent(
  text: string | undefined,
): { readonly content: ToolCallContent[] } | Record<string, never> {
  if (!text) return {};
  return {
    content: [
      {
        type: 'content',
        content: { type: 'text', text },
      },
    ],
  };
}
