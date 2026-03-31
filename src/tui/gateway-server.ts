import { randomUUID } from 'crypto';

import { WebSocket, WebSocketServer } from 'ws';

import { logger } from '../logger.js';
import type { ActiveRunStatusDetail } from '../app-state.js';

import type {
  AgentEventPayload,
  ChatEventPayload,
  GatewayEventFrame,
  GatewayRequestFrame,
  GatewayResponseFrame,
  TuiSessionSummary,
} from './protocol.js';
import { isGatewayRequestFrame } from './protocol.js';
import {
  projectEventToGatewayFrame,
  type HostEventOrLegacyTuiEvent,
  type HostEventSubscriber,
} from '../runtime/host-events.js';

type ThinkLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
type ReasoningLevel = 'off' | 'on' | 'stream';
type VerboseMode = 'off' | 'new' | 'all' | 'verbose';

export interface SessionPrefs {
  provider?: string;
  model?: string;
  thinkLevel?: ThinkLevel;
  reasoningLevel?: ReasoningLevel;
  verboseMode?: VerboseMode;
  noContinueNext?: boolean;
}

export interface SessionHistoryMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: string;
  runId?: string;
}

export interface TuiGatewayServer {
  port: number;
  host: string;
  close: () => Promise<void>;
}

export interface TuiGatewayAdapters {
  getStatus: () => {
    runtime: string;
    sessions: number;
    activeRuns: number;
    activeRunDetails: ActiveRunStatusDetail[];
  };
  listSessions: () => TuiSessionSummary[];
  resolveChatJid: (sessionKey: string) => string | null;
  getSessionKeyForChat: (chatJid: string) => string;
  getSessionPrefs: (chatJid: string) => SessionPrefs;
  patchSessionPrefs: (chatJid: string, patch: SessionPrefs) => SessionPrefs;
  resetSession: (
    chatJid: string,
    reason: string,
  ) => { ok: boolean; reason: string };
  getHistory: (
    chatJid: string,
    limit: number,
  ) => Promise<SessionHistoryMessage[]>;
  sendChat: (params: {
    chatJid: string;
    sessionKey: string;
    message: string;
    runId: string;
    deliver: boolean;
  }) => Promise<{
    runId: string;
    status: 'started' | 'queued' | 'already_running';
  }>;
  abortChat: (params: {
    chatJid: string;
    runId: string;
  }) => Promise<{ aborted: boolean }>;
  serviceGateway: (params: {
    action: 'status' | 'restart' | 'doctor';
  }) => Promise<{ ok: boolean; text: string }> | { ok: boolean; text: string };
}

const DEFAULT_PORT = Number(process.env.FFT_NANO_TUI_PORT || 28989);
const DEFAULT_HOST = process.env.FFT_NANO_TUI_HOST || '127.0.0.1';

export interface TuiGatewayOptions {
  port?: number;
  host?: string;
  authToken?: string;
}

function normalizeThinkLevel(raw: unknown): ThinkLevel | undefined {
  const key = String(raw || '')
    .trim()
    .toLowerCase();
  if (!key) return undefined;
  if (key === 'off') return 'off';
  if (['minimal', 'min'].includes(key)) return 'minimal';
  if (key === 'low') return 'low';
  if (['med', 'mid', 'medium'].includes(key)) return 'medium';
  if (['high', 'max'].includes(key)) return 'high';
  if (['xhigh', 'x-high', 'x_high'].includes(key)) return 'xhigh';
  return undefined;
}

function normalizeReasoningLevel(raw: unknown): ReasoningLevel | undefined {
  const key = String(raw || '')
    .trim()
    .toLowerCase();
  if (!key) return undefined;
  if (['off', 'false', '0', 'no'].includes(key)) return 'off';
  if (['on', 'true', '1', 'yes'].includes(key)) return 'on';
  if (['stream', 'streaming', 'live'].includes(key)) return 'stream';
  return undefined;
}

function normalizeVerboseMode(raw: unknown): VerboseMode | undefined {
  const key = String(raw || '')
    .trim()
    .toLowerCase();
  if (!key) return undefined;
  if (['off', 'false', '0', 'no'].includes(key)) return 'off';
  if (key === 'new') return 'new';
  if (['all', 'on', 'true', '1', 'yes'].includes(key)) return 'all';
  if (['verbose', 'full', 'max', '2'].includes(key)) return 'verbose';
  return undefined;
}

function getSessionKey(params: Record<string, unknown> | undefined): string {
  const raw = typeof params?.sessionKey === 'string' ? params.sessionKey : '';
  const trimmed = raw.trim();
  return trimmed || 'main';
}

function asText(input: unknown): string {
  return typeof input === 'string' ? input : '';
}

function asBoolean(input: unknown, fallback = false): boolean {
  if (typeof input === 'boolean') return input;
  if (typeof input === 'number') return input !== 0;
  if (typeof input === 'string') {
    const normalized = input.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function sendFrame(
  ws: WebSocket,
  frame: GatewayResponseFrame | GatewayEventFrame,
): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(frame));
}

function broadcast(clients: Set<WebSocket>, frame: GatewayEventFrame): void {
  for (const ws of clients) {
    sendFrame(ws, frame);
  }
}

function response(id: string, result?: unknown): GatewayResponseFrame {
  return {
    id,
    ok: true,
    result,
  };
}

function failure(id: string, error: string): GatewayResponseFrame {
  return {
    id,
    ok: false,
    error,
  };
}

function parseMessage(data: WebSocket.RawData): GatewayRequestFrame | null {
  try {
    const raw = typeof data === 'string' ? data : data.toString('utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isGatewayRequestFrame(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function startTuiGatewayServer(
  adapters: TuiGatewayAdapters,
  eventHub: HostEventSubscriber<HostEventOrLegacyTuiEvent>,
  options: number | TuiGatewayOptions = {},
): Promise<TuiGatewayServer> {
  const resolvedOptions =
    typeof options === 'number' ? { port: options } : options;
  const host = resolvedOptions.host || DEFAULT_HOST;
  const port = resolvedOptions.port ?? DEFAULT_PORT;
  const authToken = (resolvedOptions.authToken || '').trim();
  const authRequired = authToken.length > 0;

  const clients = new Set<WebSocket>();
  const authenticatedClients = new Set<WebSocket>();
  const wss = new WebSocketServer({
    port,
    host,
  });

  logger.info({ host, port, authRequired }, 'TUI gateway server listening');

  const unsubscribe = eventHub.subscribe((event) => {
    const recipients = authRequired
      ? new Set(
          Array.from(clients).filter((ws) => authenticatedClients.has(ws)),
        )
      : clients;
    const frame = projectEventToGatewayFrame(event);
    if (!frame) return;
    broadcast(recipients, frame);
  });

  wss.on('connection', (ws) => {
    clients.add(ws);

    ws.on('close', () => {
      clients.delete(ws);
      authenticatedClients.delete(ws);
    });

    ws.on('message', (payload) => {
      const frame = parseMessage(payload);
      if (!frame) {
        sendFrame(
          ws,
          failure(
            'unknown',
            'Invalid request frame. Expected JSON with id/method.',
          ),
        );
        return;
      }

      const params = (frame.params || {}) as Record<string, unknown>;
      const sessionKey = getSessionKey(params);
      const chatJid = adapters.resolveChatJid(sessionKey);
      const isAuthenticated = !authRequired || authenticatedClients.has(ws);

      if (frame.method !== 'connect' && !isAuthenticated) {
        sendFrame(
          ws,
          failure(
            frame.id,
            'Unauthorized: send connect with a valid gateway token first.',
          ),
        );
        return;
      }

      switch (frame.method) {
        case 'connect': {
          if (authRequired) {
            const providedToken = asText(params.token).trim();
            if (providedToken !== authToken) {
              sendFrame(
                ws,
                failure(frame.id, 'Unauthorized: invalid gateway token.'),
              );
              setTimeout(() => {
                try {
                  ws.close(4401, 'Unauthorized');
                } catch {
                  // ignore close errors
                }
              }, 10);
              break;
            }
            authenticatedClients.add(ws);
          }

          sendFrame(
            ws,
            response(frame.id, {
              ok: true,
              protocol: 'fft_nano.tui.v2',
              serverTime: new Date().toISOString(),
              defaultSessionKey: 'main',
              authRequired,
            }),
          );
          break;
        }

        case 'status': {
          const status = adapters.getStatus();
          sendFrame(
            ws,
            response(frame.id, {
              runtime: status.runtime,
              connectedClients: clients.size,
              sessions: status.sessions,
              activeRuns: status.activeRuns,
              activeRunDetails: status.activeRunDetails,
            }),
          );
          break;
        }

        case 'sessions.list': {
          const sessions = adapters.listSessions();
          sendFrame(
            ws,
            response(frame.id, {
              sessions,
              defaultSessionKey: 'main',
            }),
          );
          break;
        }

        case 'chat.history': {
          if (!chatJid) {
            sendFrame(ws, failure(frame.id, `Unknown session: ${sessionKey}`));
            break;
          }
          const limitRaw = Number(params.limit || 120);
          const limit = Number.isFinite(limitRaw)
            ? Math.max(1, Math.min(400, Math.floor(limitRaw)))
            : 120;
          void adapters
            .getHistory(chatJid, limit)
            .then((history) => {
              sendFrame(
                ws,
                response(frame.id, {
                  sessionKey: adapters.getSessionKeyForChat(chatJid),
                  messages: history,
                }),
              );
            })
            .catch((err) => {
              sendFrame(
                ws,
                failure(
                  frame.id,
                  err instanceof Error ? err.message : String(err),
                ),
              );
            });
          break;
        }

        case 'sessions.patch': {
          if (!chatJid) {
            sendFrame(ws, failure(frame.id, `Unknown session: ${sessionKey}`));
            break;
          }
          const provider = asText(params.provider).trim();
          const model = asText(params.model).trim();
          const thinkLevel = normalizeThinkLevel(params.thinkLevel);
          const reasoningLevel = normalizeReasoningLevel(params.reasoningLevel);
          const verboseMode = normalizeVerboseMode(params.verboseMode);

          const patch: SessionPrefs = {};
          if (provider || params.provider === '')
            patch.provider = provider || undefined;
          if (model || params.model === '') patch.model = model || undefined;
          if (thinkLevel) patch.thinkLevel = thinkLevel;
          if (reasoningLevel) patch.reasoningLevel = reasoningLevel;
          if (verboseMode) patch.verboseMode = verboseMode;

          const next = adapters.patchSessionPrefs(chatJid, patch);
          sendFrame(
            ws,
            response(frame.id, {
              ok: true,
              key: adapters.getSessionKeyForChat(chatJid),
              ...next,
            }),
          );
          break;
        }

        case 'sessions.reset': {
          if (!chatJid) {
            sendFrame(ws, failure(frame.id, `Unknown session: ${sessionKey}`));
            break;
          }
          const reason = asText(params.reason).trim() || 'reset';
          const result = adapters.resetSession(chatJid, reason);
          sendFrame(
            ws,
            response(frame.id, {
              ok: result.ok,
              key: adapters.getSessionKeyForChat(chatJid),
              reason: result.reason,
            }),
          );
          break;
        }

        case 'chat.abort': {
          if (!chatJid) {
            sendFrame(ws, failure(frame.id, `Unknown session: ${sessionKey}`));
            break;
          }
          const runId = asText(params.runId).trim();
          if (!runId) {
            sendFrame(ws, failure(frame.id, 'Missing runId.'));
            break;
          }
          void adapters
            .abortChat({ chatJid, runId })
            .then((result) => {
              sendFrame(
                ws,
                response(frame.id, { ok: true, aborted: result.aborted }),
              );
            })
            .catch((err) => {
              sendFrame(
                ws,
                failure(
                  frame.id,
                  err instanceof Error ? err.message : String(err),
                ),
              );
            });
          break;
        }

        case 'chat.send': {
          if (!chatJid) {
            sendFrame(ws, failure(frame.id, `Unknown session: ${sessionKey}`));
            break;
          }
          const text = asText(params.message).trim();
          if (!text) {
            sendFrame(ws, failure(frame.id, 'Message cannot be empty.'));
            break;
          }

          const runId = asText(params.runId).trim() || randomUUID();
          const deliver = asBoolean(params.deliver, false);
          void adapters
            .sendChat({
              chatJid,
              sessionKey: adapters.getSessionKeyForChat(chatJid),
              message: text,
              runId,
              deliver,
            })
            .then((result) => {
              sendFrame(ws, response(frame.id, { ok: true, ...result }));
            })
            .catch((err) => {
              sendFrame(
                ws,
                failure(
                  frame.id,
                  err instanceof Error ? err.message : String(err),
                ),
              );
            });
          break;
        }

        case 'gateway.service': {
          const actionRaw = asText(params.action).trim().toLowerCase();
          const action =
            actionRaw === 'restart'
              ? 'restart'
              : actionRaw === 'doctor'
                ? 'doctor'
                : actionRaw === 'status'
                  ? 'status'
                  : null;
          if (!action) {
            sendFrame(
              ws,
              failure(
                frame.id,
                'action must be "status", "restart", or "doctor"',
              ),
            );
            break;
          }

          void Promise.resolve(adapters.serviceGateway({ action }))
            .then((result) => {
              sendFrame(ws, response(frame.id, result));
            })
            .catch((err) => {
              sendFrame(
                ws,
                failure(
                  frame.id,
                  err instanceof Error ? err.message : String(err),
                ),
              );
            });
          break;
        }

        default:
          sendFrame(ws, failure(frame.id, `Unknown method: ${frame.method}`));
      }
    });
  });

  async function close(): Promise<void> {
    unsubscribe();
    for (const ws of clients) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
  }

  return {
    port,
    host,
    close,
  };
}
