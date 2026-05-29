import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeTelegramDeliveryMode } from '../src/chat-preferences.js';
import { createMessageDispatcher } from '../src/message-dispatch.js';
import {
  createTelegramCommandHandlers,
  type TelegramCommandDeps,
} from '../src/telegram-commands.js';
import {
  resolveTelegramStreamCompletionState,
  type TelegramMessagePreviewState,
} from '../src/telegram-streaming.js';
import { StreamConsumer } from '../src/streaming/stream-consumer.js';
import type { PlatformAdapter } from '../src/streaming/platform-adapter.js';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

function createAdapter(): PlatformAdapter & {
  sent: Array<{ chatId: string; content: string }>;
  edits: Array<{ chatId: string; messageId: string; content: string }>;
  drafts: Array<{ chatId: string; draftId: number; content: string }>;
} {
  let messageCounter = 0;
  const sent: Array<{ chatId: string; content: string }> = [];
  const edits: Array<{ chatId: string; messageId: string; content: string }> =
    [];
  const drafts: Array<{ chatId: string; draftId: number; content: string }> =
    [];

  return {
    sent,
    edits,
    drafts,
    async send(chatId, content) {
      messageCounter++;
      sent.push({ chatId, content });
      return { success: true, messageId: String(messageCounter) };
    },
    async editMessage(chatId, messageId, content) {
      edits.push({ chatId, messageId, content });
      return { success: true, messageId };
    },
    async deleteMessage() {},
    async sendDraft(chatId, draftId, content) {
      drafts.push({ chatId, draftId, content });
      return { success: true, messageId: String(draftId) };
    },
    supportsDraftStreaming() {
      return true;
    },
  };
}

test('Telegram /delivery modes propagate through dispatch, StreamConsumer, and final delivery', async () => {
  for (const mode of ['stream', 'append', 'draft', 'off'] as const) {
    const state = {
      registeredGroups: {
        'telegram:1': {
          jid: 'telegram:1',
          name: 'Main',
          folder: 'main',
          trigger: '@FarmFriend',
        },
      },
      chatRunPreferences: {} as Record<string, Record<string, any>>,
      chatUsageStats: {},
      lastAgentTimestamp: {},
    };
    const adapter = createAdapter();
    const commandAcks: string[] = [];
    const runtimePrefsSeen: Array<Record<string, any>> = [];
    const previewsByRun = new Map<string, TelegramMessagePreviewState | null>();
    const finalSends: string[] = [];
    const finalizedPreviews: Array<{ messageId: number; text: string }> = [];

    const commandDeps = {
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
      sendMessage: async (_chatJid: string, text: string) => {
        commandAcks.push(text);
      },
      sendTelegramSettingsPanel: async () => {},
      editTelegramSettingsPanel: async () => {},
      promptTelegramSetupInput: async () => {},
      clearTelegramSetupInputState: () => {},
      getTelegramSetupInputState: () => null,
      getTelegramSettingsPanelAction: () => null,
      updateChatRunPreferences: (
        chatJid: string,
        updater: (prefs: Record<string, any>) => Record<string, any>,
      ) => {
        const next = updater({ ...(state.chatRunPreferences[chatJid] || {}) });
        state.chatRunPreferences[chatJid] = next;
      },
      isMainChat: () => true,
      formatTasksText: () => 'tasks',
      formatGroupsText: () => 'groups',
      formatStatusText: () => 'status',
      formatHelpText: () => 'help',
      formatUsageText: () => 'usage',
      formatActiveSubagentsText: () => 'subagents',
      summarizeTask: () => 'task',
      formatTaskRunsText: () => 'task runs',
      runPiListModels: () => ({ text: 'models' }),
      validateProviderModelRef: () => ({ ok: true }),
      normalizeThinkLevel: () => null,
      normalizeReasoningLevel: () => null,
      normalizeTelegramDeliveryMode,
      parseQueueArgs: () => ({}),
      parseVerboseDirective: () => ({ kind: 'none' }),
      describeVerboseMode: () => 'off',
      getEffectiveVerboseMode: () => 'off',
      getEffectiveModelLabel: () => 'provider/model',
      resolveMainOnboardingGate: () => ({ active: false }),
      onboardingCommandBlockedText: () => 'blocked',
      runCompactionForChat: async () => 'compacted',
      parseTelegramChatId: () => '1',
      parseTelegramTargetJid: () => null,
      normalizeTelegramCommandToken: (token: string) =>
        token.split('@')[0]?.toLowerCase() || null,
      promoteChatToMain: () => {},
      refreshTelegramCommandMenus: async () => {},
      hasMainGroup: () => true,
      approveTelegramGroup: async () => ({ ok: true, text: 'approved' }),
      ignoreTelegramGroup: async () => ({ ok: true, text: 'ignored' }),
      unignoreTelegramGroup: async () => ({ ok: true, text: 'unignored' }),
      runGatewayServiceCommand: () => ({ ok: true, text: 'ok' }),
      runUpdateCommand: () => ({ ok: true, text: 'updated' }),
      startUpdateCommand: () => ({ ok: true, text: 'started' }),
      buildRuntimeProviderPresetUpdates: () => ({}),
      getRuntimeConfigEnv: () => ({}),
      persistRuntimeConfigUpdates: () => {},
      resolveRuntimeConfigSnapshot: () => ({
        providerPreset: 'manual',
        apiKeyEnv: 'OPENAI_API_KEY',
      }),
      registerTelegramSettingsPanelAction: () => 'settings:1',
      buildAdminPanelKeyboard: () => [],
      getTaskById: () => null,
      updateTask: () => {},
      deleteTask: () => {},
      emitTuiChatEvent: () => {},
      emitTuiAgentEvent: () => {},
      emitRunProgress: () => {},
      getSessionKeyForChat: () => 'telegram:1',
      runAgent: async () => ({ ok: true, result: 'done', streamed: false }),
      setTyping: async () => {},
      persistAssistantHistory: () => {},
      sendAgentResultMessage: async () => true,
      updateChatUsage: () => {},
      logTelegramCommandAudit: () => {},
    } as unknown as TelegramCommandDeps;

    const handlers = createTelegramCommandHandlers(commandDeps);
    const handled = await handlers.handleTelegramCommand({
      chatJid: 'telegram:1',
      chatName: 'Main',
      content: `/delivery ${mode}`,
    });

    assert.equal(handled, true);
    assert.deepEqual(commandAcks, [
      `Delivery mode set to ${mode} for this chat.`,
    ]);

    const dispatcher = createMessageDispatcher({
      state,
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
      sendMessage: async () => {},
      setTyping: async () => {},
      getMessagesSince: () => [],
      getSessionKeyForChat: (chatJid) => chatJid,
      resolveMainOnboardingGate: () => ({ active: false }),
      buildOnboardingInterviewPrompt: ({ prompt }) => prompt,
      extractOnboardingCompletion: (text) => ({ text, completed: false }),
      completeMainWorkspaceOnboarding: () => {},
      rememberHeartbeatTarget: () => {},
      runAgent: async (
        _group,
        _prompt,
        chatJid,
        _codingHint,
        requestId,
        runtimePrefs,
      ) => {
        runtimePrefsSeen.push(runtimePrefs);
        const deliveryMode = runtimePrefs.telegramDeliveryMode || 'stream';
        if (deliveryMode !== 'off') {
          const consumer = new StreamConsumer({
            chatId: chatJid,
            runId: requestId,
            adapter,
            draftId: 777,
            deliveryMode,
            verboseMode: 'off',
            heartbeatMs: 0,
          });
          await consumer.onDelta(
            'First Telegram preview update with enough characters',
          );
          await flush();
          await consumer.onDelta(
            'Second Telegram preview update with enough characters',
          );
          await flush();
          const preview = consumer.getPreviewState();
          previewsByRun.set(
            requestId,
            preview
              ? {
                  messageId: Number(preview.messageId),
                  lastText: preview.lastText,
                  updatedAt: Date.now(),
                }
              : null,
          );
          consumer.stop();
        } else {
          previewsByRun.set(requestId, null);
        }
        return {
          ok: true,
          result: 'Final answer from agent',
          streamed: deliveryMode !== 'off',
        };
      },
      consumeNextRunNoContinue: () => false,
      updateChatUsage: () => {},
      persistAssistantHistory: () => {},
      persistTuiUserHistory: () => {},
      deleteTelegramPreviewMessage: async () => {},
      finalizeTelegramPreviewMessage: async (_chatJid, messageId, text) => {
        finalizedPreviews.push({ messageId, text });
        return true;
      },
      sendAgentResultMessage: async (_chatJid, text) => {
        finalSends.push(text);
        return true;
      },
      emitTuiChatEvent: () => {},
      emitTuiAgentEvent: () => {},
      isTelegramJid: () => true,
      prepareTelegramCompletionState: async ({ runId }) => ({
        externallyCompleted: false,
        previewState: previewsByRun.get(runId) || null,
      }),
      consumeTelegramHostCompletedRun: () => false,
      consumeTelegramHostStreamState: () => null,
      resolveTelegramStreamCompletionState,
      finalizeCompletedRun: async (params) => {
        await import('../src/message-dispatch.js').then(
          ({ finalizeCompletedRun }) => finalizeCompletedRun(params),
        );
      },
    } as any);

    const start = await dispatcher.runDirectSessionTurn({
      chatJid: 'telegram:1',
      text: `exercise ${mode}`,
      runId: `run-${mode}`,
      deliver: true,
    });

    assert.deepEqual(start, { runId: `run-${mode}`, status: 'started' });
    await waitFor(
      () => runtimePrefsSeen.length === 1,
      `runAgent was not called for ${mode}`,
    );
    await waitFor(
      () => finalSends.length > 0 || finalizedPreviews.length > 0,
      `final delivery did not complete for ${mode}`,
    );

    assert.equal(runtimePrefsSeen[0]?.telegramDeliveryMode, mode);

    if (mode === 'stream') {
      assert.equal(adapter.sent.length, 1);
      assert.ok(adapter.edits.length >= 1);
      assert.equal(adapter.drafts.length, 0);
      assert.deepEqual(finalSends, []);
      assert.deepEqual(finalizedPreviews, [
        { messageId: 1, text: 'Final answer from agent' },
      ]);
    } else if (mode === 'append') {
      assert.equal(adapter.sent.length, 2);
      assert.equal(adapter.edits.length, 0);
      assert.equal(adapter.drafts.length, 0);
      assert.deepEqual(finalizedPreviews, []);
      assert.deepEqual(finalSends, ['Final answer from agent']);
    } else if (mode === 'draft') {
      assert.equal(adapter.sent.length, 0);
      assert.equal(adapter.edits.length, 0);
      assert.ok(adapter.drafts.length >= 1);
      assert.deepEqual(finalizedPreviews, []);
      assert.deepEqual(finalSends, ['Final answer from agent']);
    } else {
      assert.equal(adapter.sent.length, 0);
      assert.equal(adapter.edits.length, 0);
      assert.equal(adapter.drafts.length, 0);
      assert.deepEqual(finalizedPreviews, []);
      assert.deepEqual(finalSends, ['Final answer from agent']);
    }
  }
});
