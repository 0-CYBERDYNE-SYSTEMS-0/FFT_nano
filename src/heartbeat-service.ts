import path from 'path';

import {
  MAIN_GROUP_FOLDER,
  MAIN_WORKSPACE_DIR,
  PARITY_CONFIG,
  TIMEZONE,
} from './config.js';
import { logger } from './logger.js';
import {
  state,
  activeChatRuns,
  activeChatRunsById,
  heartbeatLastSent,
  heartbeatLastTargetByChannel,
  type ActiveChatRun,
  type ChatRunPreferences,
} from './app-state.js';
import {
  isWithinHeartbeatActiveHours,
  parseHeartbeatActiveHours,
  shouldSuppressDuplicateHeartbeat,
  stripHeartbeatToken,
  isHeartbeatFileEffectivelyEmpty,
} from './heartbeat-policy.js';
import { writeHeartbeatChecklist } from './heartbeat-checklist.js';
import { resolveGroupIpcPath } from './group-folder.js';
import { isTelegramJid } from './telegram.js';
import { parseDurationMs } from './chat-preferences.js';
import type { RegisteredGroup } from './types.js';
import type { CodingHint } from './coding-delegation.js';
import type { ContainerProgressEvent } from './pi-runner.js';

export interface HeartbeatServiceDeps {
  findMainChatJid: () => string | null;
  findMainTelegramChatJid: () => string | null;
  parseTelegramTargetJid: (raw: string) => string | null;
  runAgent: (
    group: RegisteredGroup,
    prompt: string,
    chatJid: string,
    codingHint: CodingHint,
    requestId: string | undefined,
    runtimePrefs: ChatRunPreferences,
    options: {
      suppressErrorReply?: boolean;
      isHeartbeatTask?: boolean;
      suppressPreviewStreaming?: boolean;
      skipSkillMaintenance?: boolean;
      onProgressEvent?: (event: ContainerProgressEvent) => void;
    },
    abortSignal: AbortSignal,
  ) => Promise<{
    result: string | null;
    streamed: boolean;
    ok: boolean;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      provider?: string;
      model?: string;
    };
  }>;
  setTyping: (jid: string, isTyping: boolean) => Promise<void>;
  sendMessage: (jid: string, text: string) => Promise<boolean>;
  updateChatUsage: (
    chatJid: string,
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      provider?: string;
      model?: string;
    },
  ) => void;
}

// Heartbeat config constants
const HEARTBEAT_PROMPT = PARITY_CONFIG.heartbeat.prompt;
const HEARTBEAT_INTERVAL_MS =
  parseDurationMs(PARITY_CONFIG.heartbeat.every || '4h') || 4 * 60 * 60 * 1000;
export const HEARTBEAT_ENABLED =
  PARITY_CONFIG.heartbeat.enabled && HEARTBEAT_INTERVAL_MS > 0;
const HEARTBEAT_ACK_MAX_CHARS = Math.max(
  0,
  PARITY_CONFIG.heartbeat.ackMaxChars || 300,
);
const HEARTBEAT_TARGET = PARITY_CONFIG.heartbeat.target;
const HEARTBEAT_TARGET_TO = PARITY_CONFIG.heartbeat.to;
const HEARTBEAT_TARGET_ACCOUNT_ID = PARITY_CONFIG.heartbeat.accountId;
const HEARTBEAT_SHOW_OK = PARITY_CONFIG.heartbeat.visibility.showOk;
const HEARTBEAT_SHOW_ALERTS = PARITY_CONFIG.heartbeat.visibility.showAlerts;
const HEARTBEAT_INCLUDE_REASONING = PARITY_CONFIG.heartbeat.includeReasoning;

function resolveHeartbeatTimezoneLabel(raw: string | undefined): string {
  const value = (raw || '').trim();
  if (!value) return TIMEZONE;
  if (value === 'user' || value === 'local') {
    return process.env.FFT_NANO_USER_TIMEZONE || TIMEZONE;
  }
  return value;
}

export function resolveHeartbeatActiveHoursRaw(): string | undefined {
  const cfg = PARITY_CONFIG.heartbeat;
  if (cfg.activeHoursRaw && cfg.activeHoursRaw.trim()) {
    const normalized = cfg.activeHoursRaw.trim();
    if (normalized.includes('@user') || normalized.includes('@local')) {
      return normalized
        .replace(/@user\b/g, `@${resolveHeartbeatTimezoneLabel('user')}`)
        .replace(/@local\b/g, `@${resolveHeartbeatTimezoneLabel('local')}`);
    }
    return normalized;
  }
  if (!cfg.activeHours) return undefined;
  const timezone = resolveHeartbeatTimezoneLabel(cfg.activeHours.timezone);
  return `${cfg.activeHours.start}-${cfg.activeHours.end}@${timezone}`;
}

const HEARTBEAT_ACTIVE_HOURS = parseHeartbeatActiveHours(
  resolveHeartbeatActiveHoursRaw(),
);

function getChannelForJid(jid: string): 'telegram' | 'whatsapp' {
  return isTelegramJid(jid) ? 'telegram' : 'whatsapp';
}

export function rememberHeartbeatTarget(jid: string): void {
  const channel = getChannelForJid(jid);
  heartbeatLastTargetByChannel.set(channel, jid);
  state.heartbeatLastTargetAny = jid;
}

function resolveHeartbeatTargetJid(
  mainChatJid: string,
  deps: HeartbeatServiceDeps,
): string | null {
  const explicitTarget = HEARTBEAT_TARGET;
  if (explicitTarget === 'none') return null;
  if (explicitTarget === 'main') {
    if (HEARTBEAT_TARGET_TO?.trim()) {
      if (isTelegramJid(mainChatJid)) {
        const parsed = deps.parseTelegramTargetJid(HEARTBEAT_TARGET_TO);
        return parsed || mainChatJid;
      }
      return HEARTBEAT_TARGET_TO.includes('@')
        ? HEARTBEAT_TARGET_TO
        : `${HEARTBEAT_TARGET_TO}@s.whatsapp.net`;
    }
    return mainChatJid;
  }
  if (explicitTarget === 'last') {
    return state.heartbeatLastTargetAny || mainChatJid;
  }
  if (explicitTarget === 'telegram') {
    if (HEARTBEAT_TARGET_TO?.trim()) {
      return (
        deps.parseTelegramTargetJid(HEARTBEAT_TARGET_TO) ||
        deps.findMainTelegramChatJid()
      );
    }
    return (
      heartbeatLastTargetByChannel.get('telegram') ||
      deps.findMainTelegramChatJid()
    );
  }
  if (explicitTarget === 'whatsapp') {
    if (HEARTBEAT_TARGET_TO?.trim()) {
      return HEARTBEAT_TARGET_TO.includes('@')
        ? HEARTBEAT_TARGET_TO
        : `${HEARTBEAT_TARGET_TO}@s.whatsapp.net`;
    }
    return heartbeatLastTargetByChannel.get('whatsapp') || mainChatJid;
  }
  if (explicitTarget === 'chat') {
    if (!HEARTBEAT_TARGET_TO?.trim()) return mainChatJid;
    const raw = HEARTBEAT_TARGET_TO.trim();
    if (raw.startsWith('telegram:'))
      return deps.parseTelegramTargetJid(raw) || mainChatJid;
    if (raw.includes('@')) return raw;
    const asTelegram = deps.parseTelegramTargetJid(raw);
    if (asTelegram) return asTelegram;
    return `${raw}@s.whatsapp.net`;
  }
  return mainChatJid;
}

function logHeartbeatSkip(
  reason: string,
  extra: Record<string, string | number | boolean | null> = {},
): void {
  logger.debug({ reason, ...extra }, 'Skipping heartbeat');
}

function shouldBypassEmptyHeartbeatSkip(reason: string): boolean {
  return (
    reason === 'wake' ||
    reason === 'exec-event' ||
    reason.startsWith('cron:') ||
    reason.startsWith('hook:')
  );
}

let serviceDeps: HeartbeatServiceDeps | null = null;

export async function runHeartbeatTurn(reason = 'interval'): Promise<void> {
  if (!HEARTBEAT_ENABLED) return;
  if (!serviceDeps) {
    logger.warn('runHeartbeatTurn called before heartbeat service initialized');
    return;
  }
  const deps = serviceDeps;
  const mainChatJid = deps.findMainChatJid();
  if (!mainChatJid) {
    logHeartbeatSkip('no-main-chat');
    return;
  }
  if (!isWithinHeartbeatActiveHours(HEARTBEAT_ACTIVE_HOURS)) {
    logHeartbeatSkip('quiet-hours', {
      activeHours: HEARTBEAT_ACTIVE_HOURS?.raw || null,
      reason,
    });
    return;
  }
  if (activeChatRuns.has(mainChatJid)) {
    logHeartbeatSkip('active-run', { chatJid: mainChatJid, reason });
    return;
  }

  const group = state.registeredGroups[mainChatJid];
  if (!group || group.folder !== MAIN_GROUP_FOLDER) {
    logHeartbeatSkip('main-group-not-registered', {
      chatJid: mainChatJid,
      reason,
    });
    return;
  }
  if (
    !shouldBypassEmptyHeartbeatSkip(reason) &&
    isHeartbeatFileEffectivelyEmpty(
      path.join(MAIN_WORKSPACE_DIR, 'HEARTBEAT.md'),
    )
  ) {
    logHeartbeatSkip('empty-heartbeat-file', { chatJid: mainChatJid, reason });
    return;
  }

  const requestId = `heartbeat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const abortController = new AbortController();
  const activeRun: ActiveChatRun = {
    chatJid: mainChatJid,
    startedAt: Date.now(),
    requestId,
    abortController,
  };
  activeChatRuns.set(mainChatJid, activeRun);
  activeChatRunsById.set(requestId, activeRun);
  await deps.setTyping(mainChatJid, true);
  try {
    const run = await deps.runAgent(
      group,
      `${HEARTBEAT_PROMPT}\n\n[SYSTEM NOTE]\nHeartbeat run.`,
      mainChatJid,
      'auto',
      requestId,
      state.chatRunPreferences[mainChatJid] || {},
      { suppressErrorReply: true, isHeartbeatTask: true },
      abortController.signal,
    );
    try {
      const checklistPath = writeHeartbeatChecklist({
        workspaceDir: MAIN_WORKSPACE_DIR,
        requestId,
        reason,
        result: run.result,
        ok: run.ok,
        currentTasksPath: path.join(
          resolveGroupIpcPath(MAIN_GROUP_FOLDER),
          'current_tasks.json',
        ),
        runtimeLogPath: path.join(process.cwd(), 'logs', 'fft_nano.log'),
      });
      logger.debug(
        { chatJid: mainChatJid, reason, checklistPath },
        'Heartbeat checklist written',
      );
    } catch (err) {
      logger.warn(
        { err, chatJid: mainChatJid, reason },
        'Failed to write heartbeat checklist',
      );
    }
    if (!run.ok) {
      logger.warn({ chatJid: mainChatJid, reason }, 'Heartbeat run failed');
      return;
    }
    deps.updateChatUsage(mainChatJid, run.usage);
    if (run.streamed || !run.result) return;

    const normalized = stripHeartbeatToken(run.result, {
      mode: 'heartbeat',
      maxAckChars: HEARTBEAT_ACK_MAX_CHARS,
    });
    if (normalized.shouldSkip || !normalized.text.trim()) {
      if (HEARTBEAT_SHOW_OK && normalized.didStrip) {
        const destination = resolveHeartbeatTargetJid(mainChatJid, deps);
        if (!destination) {
          logHeartbeatSkip('no-destination', { chatJid: mainChatJid, reason });
          return;
        }
        const sent = await deps.sendMessage(destination, 'heartbeat okay');
        if (!sent) {
          logger.error(
            { chatJid: mainChatJid, destination, reason },
            'Heartbeat HEARTBEAT_OK delivery failed',
          );
        } else {
          rememberHeartbeatTarget(destination);
        }
      }
      logHeartbeatSkip('ack-token', {
        chatJid: mainChatJid,
        didStrip: normalized.didStrip,
        reason,
      });
      return;
    }
    if (!HEARTBEAT_SHOW_ALERTS) {
      logHeartbeatSkip('alerts-hidden', { chatJid: mainChatJid, reason });
      return;
    }

    const nowMs = Date.now();
    const previous = heartbeatLastSent.get(mainChatJid);
    if (
      shouldSuppressDuplicateHeartbeat({
        text: normalized.text,
        nowMs,
        previousText: previous?.text,
        previousSentAt: previous?.sentAt,
      })
    ) {
      logHeartbeatSkip('duplicate', { chatJid: mainChatJid, reason });
      return;
    }

    const destination = resolveHeartbeatTargetJid(mainChatJid, deps);
    if (!destination) {
      logHeartbeatSkip('no-destination', { chatJid: mainChatJid, reason });
      return;
    }
    if (HEARTBEAT_TARGET_ACCOUNT_ID?.trim()) {
      logger.debug(
        { accountId: HEARTBEAT_TARGET_ACCOUNT_ID, target: HEARTBEAT_TARGET },
        'Heartbeat accountId configured but ignored (single-account channels in FFT_nano)',
      );
    }
    const sent = await deps.sendMessage(destination, normalized.text);
    if (!sent) {
      logger.error(
        { chatJid: mainChatJid, destination, reason },
        'Heartbeat alert delivery failed; user did not receive the heartbeat notification',
      );
      return;
    }
    rememberHeartbeatTarget(destination);
    if (HEARTBEAT_INCLUDE_REASONING) {
      const match =
        run.result.match(/<reasoning>([\s\S]*?)<\/reasoning>/i) ||
        run.result.match(/<thinking>([\s\S]*?)<\/thinking>/i);
      const reasoning = match?.[1]?.trim();
      if (reasoning) {
        const reasonSent = await deps.sendMessage(
          destination,
          `Reasoning:\n${reasoning}`,
        );
        if (!reasonSent) {
          logger.warn(
            { chatJid: mainChatJid, destination, reason },
            'Heartbeat reasoning delivery failed (alert was sent)',
          );
        }
      }
    }
    heartbeatLastSent.set(mainChatJid, {
      text: normalized.text,
      sentAt: nowMs,
    });
  } catch (err) {
    logger.error(
      { err, chatJid: mainChatJid, reason },
      'Heartbeat run failed; agent threw an exception',
    );
  } finally {
    if (activeChatRuns.get(mainChatJid) === activeRun) {
      activeChatRuns.delete(mainChatJid);
    }
    activeChatRunsById.delete(requestId);
    await deps.setTyping(mainChatJid, false);
  }
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let ipcEventUnsubscribe: (() => void) | null = null;

export function startHeartbeatLoop(deps: HeartbeatServiceDeps): void {
  if (!HEARTBEAT_ENABLED || state.heartbeatLoopStarted) return;
  serviceDeps = deps;
  state.heartbeatLoopStarted = true;
  heartbeatTimer = setInterval(() => {
    if (state.shuttingDown) return;
    void runHeartbeatTurn('interval');
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();
  logger.info({ everyMs: HEARTBEAT_INTERVAL_MS }, 'Heartbeat loop started');
}

export function stopHeartbeatLoop(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    state.heartbeatLoopStarted = false;
  }
  if (ipcEventUnsubscribe !== null) {
    ipcEventUnsubscribe();
    ipcEventUnsubscribe = null;
  }
}

export function requestHeartbeatNow(reason = 'manual'): void {
  if (state.shuttingDown) return;
  void runHeartbeatTurn(reason);
}
