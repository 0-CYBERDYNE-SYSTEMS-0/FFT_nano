import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from '../src/config.js';
import { state } from '../src/app-state.js';
import { loadState, saveState } from '../src/state-persistence.js';
import os from 'os';
import { formatLearningDigest } from '../src/telegram-delivery.js';
import {
  createTelegramCommandHandlers,
  type TelegramCommandDeps,
} from '../src/telegram-commands.js';
import { closeDatabase, initDatabaseAtPath } from '../src/db.js';

const statePath = path.join(DATA_DIR, 'router_state.json');

async function withRouterStateBackup(
  fn: () => void | Promise<void>,
): Promise<void> {
  const backup = fs.existsSync(statePath)
    ? fs.readFileSync(statePath, 'utf-8')
    : null;
  try {
    await fn();
  } finally {
    if (backup !== null) {
      fs.writeFileSync(statePath, backup, 'utf-8');
    } else if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }
  }
}

// Mirrors tests/telegram-commands.test.ts's createBaseDeps() minimal surface
// needed to drive the /learning pause|resume path end to end. Uses the real
// `state` singleton (as production wiring.ts does) so saveState()/loadState()
// round-trips exercise the same object the command handler mutates.
function createBaseDeps(): TelegramCommandDeps {
  const sent: Array<{ chatJid: string; text: string }> = [];
  const audits: Array<{
    chatJid: string;
    command: string;
    allowed: boolean;
    reason: string;
  }> = [];

  const deps: TelegramCommandDeps = {
    state,
    constants: {
      assistantName: 'FarmFriend',
      mainGroupFolder: 'main',
      telegramAdminSecret: 'secret',
      telegramSettingsPanelPrefix: 'settings:',
      runtimeProviderPresetEnv: 'RUNTIME_PROVIDER_PRESET',
    },
    activeChatRuns: new Map(),
    activeCoderRuns: new Map(),
    sendMessage: async (chatJid, text) => {
      sent.push({ chatJid, text });
      return true;
    },
    sendTelegramSettingsPanel: async () => {},
    editTelegramSettingsPanel: async () => {},
    promptTelegramSetupInput: async () => {},
    clearTelegramSetupInputState: () => {},
    setTelegramSetupInputState: () => {},
    setTelegramSetupInputProvider: () => {},
    getTelegramSetupInputState: () => null,
    getTelegramSettingsPanelAction: () => null,
    updateChatRunPreferences: () => {},
    isMainChat: () => true,
    formatTasksText: () => 'tasks',
    formatGroupsText: () => 'groups',
    formatStatusText: () => 'status',
    formatLearningDigest: () => formatLearningDigest(),
    formatHelpText: () => 'help',
    formatUsageText: () => 'usage',
    formatActiveSubagentsText: () => 'subagents',
    summarizeTask: () => 'task detail',
    formatTaskRunsText: () => 'task runs',
    formatPendingTasksText: () => ({ text: 'No pending tasks.', keyboard: [] }),
    promoteChatToMain: () => {},
    refreshTelegramCommandMenus: async () => {},
    runGatewayServiceCommand: () => ({ ok: true, text: 'ok' }),
    setTyping: async () => {},
    sendAgentResultMessage: async (chatJid, text) => {
      sent.push({ chatJid, text });
      return true;
    },
    updateChatUsage: () => {},
    logTelegramCommandAudit: (chatJid, command, allowed, reason) => {
      audits.push({ chatJid, command, allowed, reason });
    },
    runAgent: async () => ({ ok: true, result: 'done', streamed: false }),
    saveState: () => {},
    normalizeTelegramCommandToken: (value: string) => value.toLowerCase(),
  } as unknown as TelegramCommandDeps;

  Object.assign(deps, { sent, audits });
  return deps;
}

test.describe('SPEC-01 Part B: learning_paused_at regression guard', () => {
  test.beforeEach(() => {
    state.learningPaused = false;
    state.learningPausedAt = null;
  });

  test.afterEach(() => {
    state.learningPaused = false;
    state.learningPausedAt = null;
  });

  test('loadState populates learningPausedAt from a fixture router_state.json', async () => {
    await withRouterStateBackup(() => {
      fs.writeFileSync(
        statePath,
        JSON.stringify({
          learning_paused: true,
          learning_paused_at: '2026-06-21T00:00:00Z',
        }),
        'utf-8',
      );
      loadState();
      assert.equal(state.learningPaused, true);
      assert.equal(state.learningPausedAt, '2026-06-21T00:00:00Z');
    });
  });

  test('loadState defaults learningPausedAt to null when absent', async () => {
    await withRouterStateBackup(() => {
      fs.writeFileSync(
        statePath,
        JSON.stringify({ learning_paused: false }),
        'utf-8',
      );
      state.learningPausedAt = '2026-01-01T00:00:00Z';
      loadState();
      assert.equal(state.learningPausedAt, null);
    });
  });

  test('/learning pause stamps learningPausedAt with a valid ISO timestamp that survives saveState round-trip', async () => {
    await withRouterStateBackup(async () => {
      const deps = createBaseDeps() as TelegramCommandDeps & {
        sent: Array<{ chatJid: string; text: string }>;
      };
      deps.isMainChat = () => true;
      deps.saveState = () => saveState();

      const handlers = createTelegramCommandHandlers(deps);
      await handlers.handleTelegramCommand({
        chatJid: 'telegram:main',
        chatName: 'Main',
        content: '/learning pause',
      });

      assert.equal(state.learningPaused, true);
      const stampedAt = state.learningPausedAt;
      assert.ok(stampedAt, 'learningPausedAt should be stamped');
      assert.equal(
        new Date(stampedAt as string).toISOString(),
        stampedAt,
        'learningPausedAt should be a valid ISO timestamp',
      );

      state.learningPausedAt = null;
      loadState();
      assert.equal(state.learningPausedAt, stampedAt);
    });
  });

  test('/learning resume clears learningPausedAt to null and it survives saveState round-trip', async () => {
    await withRouterStateBackup(async () => {
      const deps = createBaseDeps() as TelegramCommandDeps & {
        sent: Array<{ chatJid: string; text: string }>;
      };
      deps.isMainChat = () => true;
      deps.saveState = () => saveState();
      state.learningPaused = true;
      state.learningPausedAt = '2026-06-21T00:00:00.000Z';

      const handlers = createTelegramCommandHandlers(deps);
      await handlers.handleTelegramCommand({
        chatJid: 'telegram:main',
        chatName: 'Main',
        content: '/learning resume',
      });

      assert.equal(state.learningPaused, false);
      assert.equal(state.learningPausedAt, null);

      state.learningPausedAt = 'sentinel';
      loadState();
      assert.equal(state.learningPausedAt, null);
    });
  });

  test('formatLearningDigest renders "paused since <date> (<N> days)" when paused with an age', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-digest-age-'));
    const dbPath = path.join(tmpRoot, 'messages.db');
    try {
      initDatabaseAtPath(dbPath);
      state.learningPaused = true;
      state.learningPausedAt = new Date(
        Date.now() - 5 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const digest = formatLearningDigest();
      assert.match(
        digest,
        /Learning is paused since .+ \(5 days\)/,
        `digest should render pause age but got: ${digest}`,
      );
    } finally {
      closeDatabase();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('formatLearningDigest falls back to plain paused message when no age is on record', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-digest-age-'));
    const dbPath = path.join(tmpRoot, 'messages.db');
    try {
      initDatabaseAtPath(dbPath);
      state.learningPaused = true;
      state.learningPausedAt = null;
      const digest = formatLearningDigest();
      assert.match(digest, /Pause status: Learning is paused$/m);
    } finally {
      closeDatabase();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
