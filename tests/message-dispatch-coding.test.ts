import assert from 'node:assert/strict';
import test from 'node:test';

import { createMessageDispatcher, finalizeCompletedRun } from '../src/message-dispatch.js';

function createDeps() {
  const codingCalls: Array<Record<string, unknown>> = [];
  const agentCalls: Array<Record<string, unknown>> = [];
  const sent: string[] = [];
  const suggestions: Array<Record<string, unknown>> = [];
  const createdProjects: Array<{ slug: string }> = [];

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
    parseDelegationTrigger: (text: string) => {
      if (text.startsWith('/coder-create-project ')) {
        const rest = text.slice('/coder-create-project '.length).trim();
        const [projectSlug, ...taskParts] = rest.split(/\s+/);
        return {
          hint: 'force_delegate_create_plan',
          trigger: 'coder-create-project',
          projectSlug,
          instruction: taskParts.join(' ').trim() || null,
        };
      }
      if (text.startsWith('/coding ')) {
        return {
          hint: 'force_delegate_execute',
          trigger: 'coding',
          instruction: text.slice('/coding '.length),
          projectSlug: null,
        };
      }
      return { hint: 'none', trigger: 'none', instruction: null, projectSlug: null };
    },
    isSubstantialCodingTask: (text: string) => text.includes('build an app'),
    isCoderDelegationCommand: () => false,
    onboardingCommandBlockedText: () => 'blocked',
    makeRunId: (prefix: string) => `${prefix}-1`,
    prepareCoderTarget: async ({ taskText }: { taskText: string }) => ({
      status: 'ready' as const,
      workspaceRoot: '/tmp/projects/agintel-dashboard',
      taskText,
      projectLabel: 'agintel-dashboard',
    }),
    presentCoderSuggestion: async (params: Record<string, unknown>) => {
      suggestions.push(params);
    },
    createCoderProject: async ({ slug }: { slug: string }) => {
      createdProjects.push({ slug });
      return {
        workspaceRoot: `/tmp/projects/${slug}`,
        projectLabel: slug,
        isGitRepo: false,
      };
    },
  };

  return { deps, codingCalls, agentCalls, sent, suggestions, createdProjects };
}

test('processMessage routes /coding requests to the coding worker with a resolved workspace root', async () => {
  const { deps, codingCalls, agentCalls, sent } = createDeps();
  const dispatcher = createMessageDispatcher(deps as any);

  await dispatcher.processMessage({
    id: '1',
    chat_jid: 'telegram:main',
    sender: 'user',
    sender_name: 'User',
    content: '/coding build an app',
    timestamp: '2026-03-22T00:00:00.000Z',
  });

  assert.equal(codingCalls.length, 1);
  assert.equal(agentCalls.length, 0);
  assert.equal(codingCalls[0]?.workspaceRoot, '/tmp/projects/agintel-dashboard');
  assert.match(sent[0] || '', /Starting coder run .*agintel-dashboard/i);
});

test('processMessage suggests coder instead of auto-running for substantial natural-language coding asks', async () => {
  const { deps, codingCalls, agentCalls, suggestions } = createDeps();
  const dispatcher = createMessageDispatcher(deps as any);

  await dispatcher.processMessage({
    id: '2',
    chat_jid: 'telegram:main',
    sender: 'user',
    sender_name: 'User',
    content: 'please build an app with auth and tests',
    timestamp: '2026-03-22T00:00:00.000Z',
  });

  assert.equal(codingCalls.length, 0);
  assert.equal(agentCalls.length, 0);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0]?.taskText, 'please build an app with auth and tests');
});

test('processMessage keeps ordinary requests on the direct agent path', async () => {
  const { deps, codingCalls, agentCalls, suggestions } = createDeps();
  deps.isSubstantialCodingTask = () => false;
  const dispatcher = createMessageDispatcher(deps as any);

  await dispatcher.processMessage({
    id: '3',
    chat_jid: 'telegram:main',
    sender: 'user',
    sender_name: 'User',
    content: 'hello there',
    timestamp: '2026-03-22T00:00:00.000Z',
  });

  assert.equal(codingCalls.length, 0);
  assert.equal(agentCalls.length, 1);
  assert.equal(suggestions.length, 0);
});

test('processMessage supports text-based project creation for non-Telegram coder flows', async () => {
  const { deps, codingCalls, createdProjects, sent } = createDeps();
  const dispatcher = createMessageDispatcher(deps as any);

  await dispatcher.processMessage({
    id: '4',
    chat_jid: 'telegram:main',
    sender: 'user',
    sender_name: 'User',
    content: '/coder-create-project orchard-os build the first dashboard',
    timestamp: '2026-03-22T00:00:00.000Z',
  });

  assert.equal(createdProjects.length, 1);
  assert.equal(createdProjects[0]?.slug, 'orchard-os');
  assert.equal(codingCalls.length, 1);
  assert.equal(codingCalls[0]?.mode, 'plan');
  assert.equal(codingCalls[0]?.workspaceRoot, '/tmp/projects/orchard-os');
  assert.match(sent[0] || '', /Created orchard-os/i);
});

test('processMessage blocks /coder-create-project while onboarding is pending', async () => {
  const { deps, codingCalls, createdProjects, sent } = createDeps();
  deps.resolveMainOnboardingGate = () => ({ active: true });
  deps.isCoderDelegationCommand = (text: string) => text.startsWith('/coder-create-project ');
  const dispatcher = createMessageDispatcher(deps as any);

  await dispatcher.processMessage({
    id: '5',
    chat_jid: 'telegram:main',
    sender: 'user',
    sender_name: 'User',
    content: '/coder-create-project orchard-os build the first dashboard',
    timestamp: '2026-03-22T00:00:00.000Z',
  });

  assert.equal(createdProjects.length, 0);
  assert.equal(codingCalls.length, 0);
  assert.equal(sent[0], 'blocked');
});
