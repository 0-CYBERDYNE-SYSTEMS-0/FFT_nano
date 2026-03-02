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

  if (requested === 'main') {
    const available = sessions
      .map((entry) => entry.sessionKey)
      .slice(0, 8)
      .join(', ');
    return {
      sessionKey: requested,
      shouldLoadHistory: false,
      infoMessage:
        [
          'Session "main" is not registered yet, so onboarding gate cannot run in TUI.',
          'Claim a main chat first (Telegram DM: /id then /main <secret>), then reconnect TUI.',
          available
            ? `Available sessions right now: ${available} (use /session <key> to switch).`
            : 'No alternate sessions are currently available.',
        ].join(' '),
    };
  }

  return {
    sessionKey: sessions[0]?.sessionKey || requested,
    shouldLoadHistory: true,
  };
}
