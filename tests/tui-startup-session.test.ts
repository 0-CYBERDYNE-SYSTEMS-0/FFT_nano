import assert from 'node:assert/strict';
import test from 'node:test';

import type { TuiSessionSummary } from '../src/tui/protocol.ts';
import { resolveStartupSession } from '../src/tui/startup-session.ts';

function makeSession(
  sessionKey: string,
  options: Partial<TuiSessionSummary> = {},
): TuiSessionSummary {
  return {
    sessionKey,
    chatJid: options.chatJid || `chat:${sessionKey}`,
    name: options.name || sessionKey,
    isMain: options.isMain ?? sessionKey === 'main',
    lastActivity: options.lastActivity,
  };
}

test('startup resolver skips history load when no sessions are available', () => {
  const resolved = resolveStartupSession('main', []);
  assert.equal(resolved.sessionKey, 'main');
  assert.equal(resolved.shouldLoadHistory, false);
  assert.match(resolved.infoMessage || '', /No sessions are registered yet/);
});

test('startup resolver does not silently fallback when requested main is missing', () => {
  const sessions = [makeSession('group-a'), makeSession('group-b')];
  const resolved = resolveStartupSession('main', sessions);
  assert.equal(resolved.sessionKey, 'main');
  assert.equal(resolved.shouldLoadHistory, false);
  assert.match(resolved.infoMessage || '', /Session "main" is not registered yet/);
});

test('startup resolver falls back to first session for non-main missing requests', () => {
  const sessions = [makeSession('group-a'), makeSession('group-b')];
  const resolved = resolveStartupSession('group-missing', sessions);
  assert.equal(resolved.sessionKey, 'group-a');
  assert.equal(resolved.shouldLoadHistory, true);
  assert.equal(resolved.infoMessage, undefined);
});

test('startup resolver keeps requested session when it exists', () => {
  const sessions = [makeSession('main'), makeSession('group-b')];
  const resolved = resolveStartupSession('main', sessions);
  assert.equal(resolved.sessionKey, 'main');
  assert.equal(resolved.shouldLoadHistory, true);
  assert.equal(resolved.infoMessage, undefined);
});
