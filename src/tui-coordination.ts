import fs from 'fs';

import {
  ASSISTANT_NAME,
  FFT_NANO_TUI_AUTH_TOKEN,
  FFT_NANO_TUI_ENABLED,
  FFT_NANO_TUI_HOST,
  FFT_NANO_TUI_PORT,
  MAIN_GROUP_FOLDER,
} from './config.js';
import { getChatHistory, getAllChats } from './db.js';
import { storeHostMessage } from './db.js';
import { logger } from './logger.js';
import { getContainerRuntime } from './container-runtime.js';
import { startDetachedUpdateCommand } from './update-command.js';
import {
  startTuiGatewayServer,
  type SessionHistoryMessage,
  type SessionPrefs as TuiSessionPrefs,
  type TuiGatewayAdapters,
} from './tui/gateway-server.js';
import type { TuiSessionSummary } from './tui/protocol.js';
import { createHostEventId, HostEventBus } from './runtime/host-events.js';
import {
  state,
  activeChatRunsById,
  TUI_SENDER_ID,
  TUI_SENDER_NAME,
} from './app-state.js';

export interface TuiCoordinationDeps {
  isMainChat: (chatJid: string) => boolean;
  findMainChatJid: () => string | null;
  getTuiSessionPrefs: (chatJid: string) => TuiSessionPrefs;
  patchTuiSessionPrefs: (
    chatJid: string,
    patch: TuiSessionPrefs,
  ) => TuiSessionPrefs;
  runDirectSessionTurn: (params: {
    chatJid: string;
    text: string;
    runId: string;
    deliver: boolean;
  }) => Promise<{
    runId: string;
    status: 'started' | 'queued' | 'already_running';
  }>;
  runGatewayServiceCommand: (action: 'status' | 'restart' | 'doctor') => {
    ok: boolean;
    text: string;
  };
}

export function getSessionKeyForChat(
  chatJid: string,
  deps: Pick<TuiCoordinationDeps, 'isMainChat'>,
): string {
  return deps.isMainChat(chatJid) ? 'main' : chatJid;
}

export function resolveChatJidForSessionKey(
  sessionKey: string,
  deps: Pick<TuiCoordinationDeps, 'findMainChatJid'>,
): string | null {
  const trimmed = sessionKey.trim();
  if (!trimmed) return null;
  if (trimmed === 'main') return deps.findMainChatJid();
  return state.registeredGroups[trimmed] ? trimmed : null;
}

export function buildTuiSessionList(
  deps: Pick<TuiCoordinationDeps, 'isMainChat'>,
): TuiSessionSummary[] {
  const chatByJid = new Map(
    getAllChats().map((chat) => [chat.jid, chat] as const),
  );
  const sessions: TuiSessionSummary[] = [];

  for (const [jid, group] of Object.entries(state.registeredGroups)) {
    const chat = chatByJid.get(jid);
    sessions.push({
      sessionKey: getSessionKeyForChat(jid, deps),
      chatJid: jid,
      name: chat?.name || group.name || jid,
      isMain: group.folder === MAIN_GROUP_FOLDER,
      lastActivity: chat?.last_message_time,
    });
  }

  sessions.sort((a, b) => {
    const aMain = a.isMain ? 1 : 0;
    const bMain = b.isMain ? 1 : 0;
    if (aMain !== bMain) return bMain - aMain;
    return (b.lastActivity || '').localeCompare(a.lastActivity || '');
  });
  return sessions;
}

export function normalizeAssistantHistoryContent(content: string): string {
  const prefix = `${ASSISTANT_NAME}:`;
  if (content.startsWith(prefix)) {
    return content.slice(prefix.length).trimStart();
  }
  return content;
}

export function getTuiSessionHistory(
  chatJid: string,
  limit: number,
): SessionHistoryMessage[] {
  const rows = getChatHistory(chatJid, limit);
  return rows.map((row) => {
    const role = row.is_from_me ? 'assistant' : 'user';
    return {
      role,
      text:
        role === 'assistant'
          ? normalizeAssistantHistoryContent(row.content)
          : row.content,
      timestamp: row.timestamp,
    };
  });
}

export function emitTuiChatEvent(
  hostEventBus: HostEventBus,
  payload: {
    runId: string;
    sessionKey: string;
    state: 'message' | 'final' | 'aborted' | 'error';
    message?: { role: 'user' | 'assistant' | 'system'; content: string };
    errorMessage?: string;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      provider?: string;
      model?: string;
    };
  },
): void {
  const createdAt = new Date().toISOString();
  hostEventBus.publish({
    kind: 'run_state',
    id: createHostEventId('chat'),
    createdAt,
    source: 'index',
    runId: payload.runId,
    sessionKey: payload.sessionKey,
    state: payload.state,
    ...(payload.message ? { message: payload.message } : {}),
    ...(payload.errorMessage ? { errorMessage: payload.errorMessage } : {}),
    ...(payload.usage ? { usage: payload.usage } : {}),
  });
}

export function emitTuiAgentEvent(
  hostEventBus: HostEventBus,
  payload: {
    runId: string;
    sessionKey: string;
    phase: 'start' | 'end' | 'error';
    detail?: string;
  },
): void {
  hostEventBus.publish({
    kind: 'run_state',
    id: createHostEventId('run'),
    createdAt: new Date().toISOString(),
    source: 'index',
    runId: payload.runId,
    sessionKey: payload.sessionKey,
    phase: payload.phase,
    detail: payload.detail,
  });
}

export function emitTuiToolEvent(
  hostEventBus: HostEventBus,
  payload: {
    runId: string;
    sessionKey: string;
    index: number;
    toolName: string;
    status: 'start' | 'ok' | 'error';
    args?: string;
    output?: string;
    error?: string;
  },
): void {
  hostEventBus.publish({
    kind: 'tool_progress',
    id: createHostEventId('tool'),
    createdAt: new Date().toISOString(),
    source: 'index',
    runId: payload.runId,
    sessionKey: payload.sessionKey,
    index: payload.index,
    toolName: payload.toolName,
    status: payload.status,
    ...(payload.args ? { args: payload.args } : {}),
    ...(payload.output ? { output: payload.output } : {}),
    ...(payload.error ? { error: payload.error } : {}),
  });
}

export function persistAssistantHistory(
  chatJid: string,
  text: string,
  runId?: string,
): string {
  if (!state.registeredGroups[chatJid]) return '';
  const timestamp = new Date().toISOString();
  const content = text.startsWith(`${ASSISTANT_NAME}:`)
    ? text
    : `${ASSISTANT_NAME}: ${text}`;
  const messageId = runId ? `${runId}:assistant` : `assistant-${Date.now()}`;
  storeHostMessage({
    id: messageId,
    chatJid,
    sender: ASSISTANT_NAME,
    senderName: ASSISTANT_NAME,
    content,
    timestamp,
    isFromMe: true,
  });
  return timestamp;
}

export function persistTuiUserHistory(
  chatJid: string,
  text: string,
  runId: string,
): string {
  const timestamp = new Date().toISOString();
  if (state.registeredGroups[chatJid]) {
    storeHostMessage({
      id: `${runId}:user`,
      chatJid,
      sender: TUI_SENDER_ID,
      senderName: TUI_SENDER_NAME,
      content: text,
      timestamp,
      isFromMe: false,
    });
  }
  return timestamp;
}

export function resetTuiSession(
  chatJid: string,
  reason: string,
  deps: Pick<TuiCoordinationDeps, 'patchTuiSessionPrefs'>,
): { ok: boolean; reason: string } {
  deps.patchTuiSessionPrefs(chatJid, { noContinueNext: true });
  return { ok: true, reason };
}

export function createTuiGatewayAdapters(
  hostEventBus: HostEventBus,
  deps: TuiCoordinationDeps,
): TuiGatewayAdapters {
  return {
    getStatus: () => ({
      runtime: getContainerRuntime(),
      sessions: buildTuiSessionList(deps).length,
      activeRuns: activeChatRunsById.size,
    }),
    listSessions: () => buildTuiSessionList(deps),
    resolveChatJid: (sessionKey: string) =>
      resolveChatJidForSessionKey(sessionKey, deps),
    getSessionKeyForChat: (chatJid: string) =>
      getSessionKeyForChat(chatJid, deps),
    getSessionPrefs: (chatJid: string) => deps.getTuiSessionPrefs(chatJid),
    patchSessionPrefs: (chatJid: string, patch: TuiSessionPrefs) =>
      deps.patchTuiSessionPrefs(chatJid, patch),
    resetSession: (chatJid: string, reason: string) =>
      resetTuiSession(chatJid, reason, deps),
    getHistory: async (chatJid: string, limit: number) =>
      getTuiSessionHistory(chatJid, limit),
    sendChat: async ({ chatJid, message, runId, deliver }) =>
      deps.runDirectSessionTurn({
        chatJid,
        text: message,
        runId,
        deliver,
      }),
    abortChat: async ({ chatJid, runId }) => {
      const active = activeChatRunsById.get(runId);
      if (!active || active.chatJid !== chatJid) {
        return { aborted: false };
      }
      active.abortController.abort(new Error('Aborted via TUI gateway'));
      return { aborted: true };
    },
    serviceGateway: async ({ action }) => deps.runGatewayServiceCommand(action),
    hostUpdate: () =>
      startDetachedUpdateCommand({
        cwd: process.cwd(),
      }),
  };
}

export async function startTuiGatewayService(
  hostEventBus: HostEventBus,
  deps: TuiCoordinationDeps,
): Promise<void> {
  if (state.tuiGatewayServer) return;
  if (!FFT_NANO_TUI_ENABLED) {
    logger.info('TUI gateway disabled via FFT_NANO_TUI_ENABLED');
    return;
  }
  try {
    state.tuiGatewayServer = await startTuiGatewayServer(
      createTuiGatewayAdapters(hostEventBus, deps),
      hostEventBus,
      {
        host: FFT_NANO_TUI_HOST,
        port: FFT_NANO_TUI_PORT,
        authToken: FFT_NANO_TUI_AUTH_TOKEN || undefined,
        socketPath: '/tmp/fft_nano_tui.sock',
      },
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error(
      { err: error },
      'TUI gateway failed to start; continuing without TUI surface',
    );
  }
}

export async function stopTuiGatewayService(): Promise<void> {
  if (!state.tuiGatewayServer) return;
  const server = state.tuiGatewayServer;
  state.tuiGatewayServer = null;
  try {
    await server.close();
    logger.info('TUI gateway server stopped');
  } catch (err) {
    logger.warn({ err }, 'Failed to stop TUI gateway server cleanly');
  }
}
