import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { state } from '../src/app-state.js';
import {
  handleTelegramUnknownGroup,
  maybeRegisterTelegramChat,
  TELEGRAM_GROUP_APPROVALS_PATH,
} from '../src/telegram-group-mgmt.js';
import type { RegisteredGroup } from '../src/types.js';
import {
  createMessageDispatcher,
  type MessageDispatcherDeps,
} from '../src/message-dispatch.js';

const DM_JID = 'telegram:555000';

function withEnv<T>(key: string, value: string | undefined, fn: () => T): T {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

function withCleanRegistry<T>(fn: () => T): T {
  const prev = state.registeredGroups;
  state.registeredGroups = {};
  try {
    return fn();
  } finally {
    state.registeredGroups = prev;
  }
}

function withCleanApprovalsFile<T>(fn: () => Promise<T>): Promise<T> {
  const hadFile = fs.existsSync(TELEGRAM_GROUP_APPROVALS_PATH);
  const backup = hadFile
    ? fs.readFileSync(TELEGRAM_GROUP_APPROVALS_PATH)
    : null;
  if (hadFile) fs.rmSync(TELEGRAM_GROUP_APPROVALS_PATH);
  return fn().finally(() => {
    if (backup !== null) {
      fs.writeFileSync(TELEGRAM_GROUP_APPROVALS_PATH, backup);
    } else if (fs.existsSync(TELEGRAM_GROUP_APPROVALS_PATH)) {
      fs.rmSync(TELEGRAM_GROUP_APPROVALS_PATH);
    }
  });
}

test('unknown DM is not auto-registered by default (approval required)', () => {
  withCleanRegistry(() => {
    withEnv('TELEGRAM_AUTO_REGISTER', undefined, () => {
      withEnv('TELEGRAM_MAIN_CHAT_ID', undefined, () => {
        const registered: string[] = [];
        const didRegister = maybeRegisterTelegramChat(DM_JID, 'Stranger', {
          registerGroup: (jid) => registered.push(jid),
          hasMainGroup: () => true,
        });
        assert.equal(didRegister, false);
        assert.deepEqual(registered, []);
      });
    });
  });
});

test('TELEGRAM_AUTO_REGISTER=1 restores old auto-register behavior for DMs', () => {
  withCleanRegistry(() => {
    withEnv('TELEGRAM_AUTO_REGISTER', '1', () => {
      withEnv('TELEGRAM_MAIN_CHAT_ID', undefined, () => {
        const registered: Array<{ jid: string; group: RegisteredGroup }> = [];
        const didRegister = maybeRegisterTelegramChat(DM_JID, 'Stranger', {
          registerGroup: (jid, group) => registered.push({ jid, group }),
          hasMainGroup: () => true,
        });
        assert.equal(didRegister, true);
        assert.equal(registered.length, 1);
        assert.equal(registered[0]?.jid, DM_JID);
        assert.equal(registered[0]?.group.folder, 'telegram-555000');
      });
    });
  });
});

test('unknown DM with a main chat sends an approval request and no agent run', async () => {
  await withCleanApprovalsFile(async () => {
    await withCleanRegistry(async () => {
      const prevBot = state.telegramBot;
      const sent: Array<{ jid: string; text: string }> = [];
      const panels: Array<{ jid: string; text: string }> = [];
      state.telegramBot = {
        sendMessageWithKeyboard: async (jid: string, text: string) => {
          panels.push({ jid, text });
          return true;
        },
      } as unknown as typeof state.telegramBot;

      try {
        await handleTelegramUnknownGroup(
          { chatJid: DM_JID, chatName: 'Stranger', content: 'hi there' },
          {
            sendMessage: async (jid, text) => {
              sent.push({ jid, text });
              return true;
            },
            findMainTelegramChatJid: () => 'telegram:100',
            buildTelegramGroupsPanel: () => ({
              text: 'Pending approvals',
              keyboard: [],
            }),
          },
        );
      } finally {
        state.telegramBot = prevBot;
      }

      // The sender got a friendly "approval request sent" reply...
      const senderReply = sent.find((m) => m.jid === DM_JID);
      assert.ok(senderReply, 'sender should receive a reply');
      assert.match(senderReply!.text, /approval request/i);
      // ...and the owner's main chat received the approval panel.
      assert.equal(panels.length, 1);
      assert.equal(panels[0]?.jid, 'telegram:100');
      // The DM was recorded as pending, never registered (so no agent runs).
      assert.equal(state.registeredGroups[DM_JID], undefined);
    });
  });
});

function createHintDeps(
  overrides: Partial<MessageDispatcherDeps> = {},
): MessageDispatcherDeps {
  return {
    state: {
      registeredGroups: {
        'telegram:2': {
          jid: 'telegram:2',
          name: 'Field Crew',
          folder: 'field-crew',
          trigger: '@FarmFriend',
        },
      },
      chatRunPreferences: {},
    },
    constants: {
      assistantName: 'FarmFriend',
      mainGroupFolder: 'main',
      triggerPattern: /@FarmFriend/i,
      tuiSenderName: 'TUI',
    },
    activeChatRuns: new Map(),
    activeChatRunsById: new Map(),
    activeCoderRuns: new Map(),
    tuiMessageQueue: new Map(),
    sendMessage: async () => true,
    setTyping: async () => {},
    getMessagesSince: () => [],
    getSessionKeyForChat: (chatJid) => chatJid,
    resolveMainOnboardingGate: () => ({ active: false }),
    buildOnboardingInterviewPrompt: ({ prompt }) => prompt,
    extractOnboardingCompletion: (text) => ({ text, completed: false }),
    completeMainWorkspaceOnboarding: () => {},
    rememberHeartbeatTarget: () => {},
    runAgent: async () => ({ ok: true, result: 'done', streamed: false }),
    consumeNextRunNoContinue: () => false,
    updateChatUsage: () => {},
    persistAssistantHistory: () => {},
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async () => true,
    emitTuiChatEvent: () => {},
    emitTuiAgentEvent: () => {},
    isTelegramJid: () => true,
    consumeTelegramHostCompletedRun: () => false,
    consumeTelegramHostStreamState: () => null,
    resolveTelegramStreamCompletionState: ({
      externallyCompleted,
      previewState,
    }) => ({
      effectiveStreamed: externallyCompleted,
      messagePreviewState: previewState,
    }),
    finalizeCompletedRun: async () => {},
    ...overrides,
  } as MessageDispatcherDeps;
}

test('trigger-gate hint is sent exactly once for an approved non-main chat', async () => {
  const sent: string[] = [];
  let agentRuns = 0;
  const deps = createHintDeps({
    sendMessage: async (_chatJid, text) => {
      sent.push(text);
      return true;
    },
    runAgent: async () => {
      agentRuns += 1;
      return { ok: true, result: 'done', streamed: false };
    },
  });
  deps.markTriggerHintSent = (chatJid) => {
    deps.state.chatRunPreferences[chatJid] = {
      ...(deps.state.chatRunPreferences[chatJid] || {}),
      triggerHintSent: true,
    };
  };

  const dispatcher = createMessageDispatcher(deps);
  const msg = {
    id: 'm-1',
    chat_jid: 'telegram:2',
    sender: 'telegram:2',
    sender_name: 'User',
    content: 'how are the tomatoes',
    timestamp: '2026-06-01T00:00:00.000Z',
    is_from_me: 0 as const,
  };

  await dispatcher.processMessage(msg);
  await dispatcher.processMessage({ ...msg, id: 'm-2' });

  assert.equal(agentRuns, 0, 'plain text must not trigger an agent run');
  assert.equal(sent.length, 1, 'hint should be sent exactly once');
  assert.match(sent[0], /start your message with @FarmFriend/);
});
