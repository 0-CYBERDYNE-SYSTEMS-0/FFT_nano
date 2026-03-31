import assert from 'node:assert/strict';
import test from 'node:test';

import { createMessageDispatcher, finalizeCompletedRun } from '../src/message-dispatch.js';

function createDeps() {
  const codingCalls: Array<Record<string, unknown>> = [];
  const agentCalls: Array<Record<string, unknown>> = [];
  const sent: string[] = [];

  const deps = {
    state: {
      registeredGroups: {
        'telegram:main': {
          jid: 'telegram:main',
          name: 'Main',
          folder: 'main',
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
      mainWorkspaceDir: '/tmp/main',
    },
    activeChatRuns: new Map(),
    activeChatRunsById: new Map(),
    activeCoderRuns: new Map(),
    tuiMessageQueue: new Map(),
    sendMessage: async (_chatJid: string, text: string) => {
      sent.push(text);
    },
    setTyping: async () => {},
    getMessagesSince: () => [],
    getSessionKeyForChat: () => 'main',
    resolveMainOnboardingGate: () => ({ active: false }),
    buildOnboardingInterviewPrompt: ({ prompt }: { prompt: string }) => prompt,
    extractOnboardingCompletion: (text: string | null) => ({ text, completed: false }),
    completeMainWorkspaceOnboarding: () => {},
    rememberHeartbeatTarget: () => {},
    runAgent: async (_group: unknown, prompt: string) => {
      agentCalls.push({ prompt });
      return { ok: true, result: 'direct', streamed: false };
    },
    runCodingTask: async (params: Record<string, unknown>) => {
      codingCalls.push(params);
      return {
        ok: true,
        result: 'coder',
        streamed: false,
        workerResult: {
          status: 'success',
          summary: 'coder',
          finalMessage: 'coder',
          changedFiles: [],
          commandsRun: [],
          testsRun: [],
          artifacts: [],
          childRunIds: [],
          startedAt: '2026-03-22T00:00:00.000Z',
          finishedAt: '2026-03-22T00:00:01.000Z',
        },
      };
    },
    consumeNextRunNoContinue: () => false,
    updateChatUsage: () => {},
    persistAssistantHistory: () => {},
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async () => {},
    emitTuiChatEvent: () => {},
    emitTuiAgentEvent: () => {},
    isTelegramJid: () => true,
    consumeTelegramHostCompletedRun: () => false,
    consumeTelegramHostStreamState: () => null,
    resolveTelegramStreamCompletionState: ({ externallyCompleted, previewState }: any) => ({
      effectiveStreamed: externallyCompleted,
      messagePreviewState: previewState,
    }),
    finalizeCompletedRun,
    parseDelegationTrigger: () => ({ hint: 'none', instruction: null }),
    isSubstantialCodingTask: (text: string) => text.includes('automate'),
    isLiveImpactCodingTask: (text: string) => text.includes('greenhouse vents'),
    isCoderDelegationCommand: () => false,
    onboardingCommandBlockedText: () => 'blocked',
    makeRunId: (prefix: string) => `${prefix}-1`,
  };

  return { deps, codingCalls, agentCalls, sent };
}

test('processMessage blocks auto-coder execution for live-impact tasks and asks for explicit approval', async () => {
  const { deps, codingCalls, agentCalls, sent } = createDeps();
  const dispatcher = createMessageDispatcher(deps as any);

  await dispatcher.processMessage({
    id: 'live-1',
    chat_jid: 'telegram:main',
    sender: 'user',
    sender_name: 'User',
    content: 'please automate the greenhouse vents based on temperature',
    timestamp: '2026-03-22T00:00:00.000Z',
  });

  assert.equal(codingCalls.length, 0);
  assert.equal(agentCalls.length, 0);
  assert.match(sent[0] || '', /live-impact/i);
  assert.match(sent[0] || '', /\/coder-plan/i);
});
