import { randomUUID } from 'crypto';
import { existsSync, lstatSync, mkdirSync, unlinkSync } from 'fs';
import { Socket } from 'net';
import { dirname } from 'path';
import { WebSocket, WebSocketServer } from 'ws';

import { logger } from '../logger.js';
import { getPlatformAdapter } from '../platform/index.js';
import type { UpdateCommandStartResult } from '../update-command.js';

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
type TelegramDeliveryMode =
  | 'status'
  | 'stream'
  | 'append'
  | 'off'
  | 'draft';

export interface SessionPrefs {
  provider?: string;
  model?: string;
  thinkLevel?: ThinkLevel;
  reasoningLevel?: ReasoningLevel;
  verboseMode?: VerboseMode;
  telegramDeliveryMode?: TelegramDeliveryMode;
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
  socketPath?: string;
  close: () => Promise<void>;
}

export interface TuiGatewayAdapters {
  getStatus: () => {
    runtime: string;
    sessions: number;
    activeRuns: number;
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
  hostUpdate: () => UpdateCommandStartResult;
  executeOperatorCommand?: (params: {
    chatJid: string;
    command: string;
    args: string;
  }) => Promise<{ ok: boolean; text: string }>;
}

const DEFAULT_PORT = Number(process.env.FFT_NANO_TUI_PORT || 28989);
const DEFAULT_HOST = process.env.FFT_NANO_TUI_HOST || '127.0.0.1';

export interface TuiGatewayOptions {
  port?: number;
  host?: string;
  authToken?: string;
  socketPath?: string;
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

function normalizeTelegramDeliveryMode(
  raw: unknown,
): TelegramDeliveryMode | undefined {
  const key = String(raw || '')
    .trim()
    .toLowerCase();
  if (
    key === 'status' ||
    key === 'stream' ||
    key === 'append' ||
    key === 'off' ||
    key === 'draft'
  ) {
    return key;
  }
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

/**
 * A union of the two transport client shapes the gateway talks to:
 *  - `WebSocket` for the main ws:// transport
 *  - `LocalClient` for the raw net.Socket / NDJSON transport
 *
 * Both expose a `send` (and optional `readyState` for the WebSocket
 * path) so the rest of the gateway can write the same JSON frame to
 * either transport.
 */
type GatewayClientConnection =
  | WebSocket
  | {
      send: (data: string) => void;
      close?: () => void;
      readyState?: number;
      on: (event: string, listener: (...args: unknown[]) => void) => void;
      off?: (event: string, listener: (...args: unknown[]) => void) => void;
    };

function sendFrame(
  target: GatewayClientConnection,
  frame: GatewayResponseFrame | GatewayEventFrame,
): void {
  const payload = JSON.stringify(frame) + '\n';
  if ('readyState' in target && typeof target.readyState === 'number') {
    // WebSocket transport: honor OPEN state
    if (target.readyState !== WebSocket.OPEN) return;
    target.send(payload.replace(/\n$/, ''));
    return;
  }
  // LocalClient transport: send is a net.Socket writer
  target.send(payload);
}

function broadcast(
  recipients: Set<GatewayClientConnection>,
  frame: GatewayEventFrame,
): void {
  for (const client of recipients) {
    sendFrame(client, frame);
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

export async function isUnixSocketAcceptingConnections(
  socketPath: string,
): Promise<boolean> {
  if (!existsSync(socketPath)) return false;

  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finish = (accepting: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(accepting);
    };

    socket.setTimeout(250, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.connect(socketPath);
  });
}

export async function removeStaleUnixSocket(socketPath: string): Promise<void> {
  // Only attempt to unlink the path if it currently looks like a Unix
  // socket. We use lstatSync to inspect the entry without dereferencing
  // symlinks, and skip anything that is a directory or regular file —
  // unlinking those would be destructive (EISDIR/ENOTDIR) and the
  // caller should fail with the underlying EADDRINUSE/EINVAL error
  // surfaced by `listen`.
  let stat: import('fs').Stats | null = null;
  try {
    stat = lstatSync(socketPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    throw err;
  }
  if (!stat.isSocket()) {
    // Not a socket — let `listen` fail loudly with the real bind error.
    return;
  }
  if (await isUnixSocketAcceptingConnections(socketPath)) {
    // Socket exists and is in use; do not remove it.
    return;
  }
  try {
    unlinkSync(socketPath);
    logger.warn({ socketPath }, 'Removed stale TUI local socket');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
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
  const socketPath = resolvedOptions.socketPath;
  const authToken = (resolvedOptions.authToken || '').trim();
  const authRequired = authToken.length > 0;

  const clients = new Set<GatewayClientConnection>();
  const authenticatedClients = new Set<GatewayClientConnection>();
  const wss = new WebSocketServer({
    port,
    host,
  });

  logger.info({ host, port, authRequired }, 'TUI gateway server listening');

  // Helper to handle incoming message frames
  function handleMessage(
    ws: GatewayClientConnection,
    frame: GatewayRequestFrame,
    isLocal = false,
  ): void {
    const params = (frame.params || {}) as Record<string, unknown>;
    const sessionKey = getSessionKey(params);
    const chatJid = adapters.resolveChatJid(sessionKey);
    // Local connections skip auth check; WebSocket connections check auth
    const isAuthenticated =
      isLocal || !authRequired || authenticatedClients.has(ws);

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
                if (typeof ws.close === 'function') {
                  ws.close(4401, 'Unauthorized');
                } else if ('terminate' in ws) {
                  (ws as WebSocket).terminate();
                }
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
        const telegramDeliveryMode = normalizeTelegramDeliveryMode(
          params.telegramDeliveryMode,
        );

        const patch: SessionPrefs = {};
        if (provider || params.provider === '')
          patch.provider = provider || undefined;
        if (model || params.model === '') patch.model = model || undefined;
        if (thinkLevel) patch.thinkLevel = thinkLevel;
        if (reasoningLevel) patch.reasoningLevel = reasoningLevel;
        if (verboseMode) patch.verboseMode = verboseMode;
        if (telegramDeliveryMode) {
          patch.telegramDeliveryMode = telegramDeliveryMode;
        }

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

      case 'gateway.service':
      case 'service.gateway': {
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

      case 'host.update': {
        void Promise.resolve(adapters.hostUpdate())
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

      case 'operator.command': {
        if (!chatJid) {
          sendFrame(ws, failure(frame.id, `Unknown session: ${sessionKey}`));
          break;
        }
        const command = asText(params.command).trim().toLowerCase();
        const args = asText(params.args).trim();
        if (!command) {
          sendFrame(ws, failure(frame.id, 'Missing operator command.'));
          break;
        }
        if (!adapters.executeOperatorCommand) {
          sendFrame(ws, failure(frame.id, 'Operator controls unavailable.'));
          break;
        }
        void adapters
          .executeOperatorCommand({ chatJid, command, args })
          .then((result) => sendFrame(ws, response(frame.id, result)))
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
  }

  // Local mode: raw newline-delimited JSON over a net server.
  // The same `connect` / `chat.history` / event frame shape used on
  // the WebSocket transport applies here, but the wire format is one
  // JSON object per line so a plain `net.Socket` (no HTTP upgrade,
  // no WebSocket framing) is enough. This matches the TUI client's
  // LocalTuiConnection and is required for `FFT_NANO_TUI_LOCAL=1`.
  const platformAdapter = getPlatformAdapter();
  let localServer:
    | ReturnType<typeof platformAdapter.createLocalSocket>
    | undefined;
  let localEndpoint: string | undefined;
  if (socketPath) {
    try {
      localEndpoint = socketPath;
      if (process.platform !== 'win32') {
        mkdirSync(dirname(localEndpoint), { recursive: true, mode: 0o700 });
      }
      await removeStaleUnixSocket(localEndpoint);

      localServer = platformAdapter.createLocalSocket();

      // Each net.Socket acts like a tiny per-connection state machine.
      // We model the socket as a "client" object that the rest of the
      // gateway can talk to via sendFrame / on close.
      type LocalClient = {
        socket: import('net').Socket;
        send: (line: string) => void;
        close: () => void;
      };
      const localClients = new Set<LocalClient>();

      localServer.on('connection', (socket) => {
        const client: LocalClient = {
          socket,
          send: (line: string) => {
            if (socket.writable) socket.write(line);
          },
          close: () => {
            try {
              socket.end();
            } catch {
              // ignore
            }
          },
        };
        localClients.add(client);
        // Local connections are inherently authenticated. Track them in
        // the global clients set so broadcast() reaches them.
        clients.add(client as unknown as WebSocket);
        authenticatedClients.add(client as unknown as WebSocket);

        let buffer = '';
        socket.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line) as unknown;
              if (!isGatewayRequestFrame(parsed)) continue;
              handleMessage(client as unknown as WebSocket, parsed, true);
            } catch {
              // ignore malformed frames
            }
          }
        });

        socket.on('close', () => {
          localClients.delete(client);
          clients.delete(client as unknown as WebSocket);
          authenticatedClients.delete(client as unknown as WebSocket);
        });
        socket.on('error', () => {
          try {
            socket.destroy();
          } catch {
            // ignore
          }
        });
      });

      // Wait for local server to be ready before returning
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => {
          logger.error(
            { err, socketPath: localEndpoint },
            'TUI local socket server error',
          );
          // Wrap the raw bind error so callers (and the startTuiGatewayService
          // health surface) get a stable, recognisable message even when the
          // underlying node error is "listen EADDRINUSE …".
          const wrapped = new Error(
            `TUI local socket server failed to listen on ${localEndpoint}: ${err.message}`,
          );
          (wrapped as Error & { cause?: unknown }).cause = err;
          reject(wrapped);
        };
        localServer!.once('error', onError);
        localServer!.listen(localEndpoint!, () => {
          localServer!.off('error', onError);
          logger.info(
            { socketPath: localEndpoint },
            'TUI local socket server listening',
          );
          resolve();
        });
      });
    } catch (err) {
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
      throw err;
    }
  }

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
      handleMessage(ws, frame, false);
    });
  });

  async function close(): Promise<void> {
    unsubscribe();
    for (const target of clients) {
      try {
        if (typeof target.close === 'function') {
          (target as { close: () => void }).close();
        } else if ('terminate' in target) {
          (target as WebSocket).terminate();
        }
      } catch {
        // ignore
      }
    }
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
    if (localServer) {
      await new Promise<void>((resolve) => {
        localServer!.close(() => resolve());
      });
    }
  }

  return {
    port,
    host,
    socketPath,
    close,
  };
}
