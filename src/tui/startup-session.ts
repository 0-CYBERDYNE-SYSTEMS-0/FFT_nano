import type { TuiSessionSummary } from './protocol.js';

export interface StartupSessionResolution {
  sessionKey: string;
  shouldLoadHistory: boolean;
  infoMessage?: string;
}

export function resolveStartupSession(
  requestedSessionKey: string,
  sessions: TuiSessionSummary[],
): StartupSessionResolution {
  const requested = requestedSessionKey.trim() || 'main';
  if (sessions.length === 0) {
    return {
      sessionKey: requested,
      shouldLoadHistory: false,
      infoMessage:
        'No sessions are registered yet. Register a chat first (for Telegram: DM the bot and run /main <secret>), then run /sessions.',
    };
  }

  if (sessions.some((entry) => entry.sessionKey === requested)) {
    return { sessionKey: requested, shouldLoadHistory: true };
  }

  return {
    sessionKey: sessions[0]?.sessionKey || requested,
    shouldLoadHistory: true,
  };
}
