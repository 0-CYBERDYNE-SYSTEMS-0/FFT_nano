import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createStatusTelemetry,
  formatStatusReport,
  isUserAbortedErrorMessage,
} from '../src/status-report.ts';

test('isUserAbortedErrorMessage detects operator-initiated cancels', () => {
  assert.equal(isUserAbortedErrorMessage('Aborted by user'), true);
  assert.equal(isUserAbortedErrorMessage('execution ABORTED BY USER'), true);
  assert.equal(
    isUserAbortedErrorMessage('timed out while waiting for provider'),
    false,
  );
  assert.equal(isUserAbortedErrorMessage(undefined), false);
});

test('status telemetry keeps most recent incidents in the configured window', () => {
  const telemetry = createStatusTelemetry({
    incidentWindowMs: 30 * 60 * 1000,
    maxIncidents: 3,
  });

  const now = Date.parse('2026-04-12T12:00:00.000Z');
  telemetry.noteRunFailed({
    runId: 'old',
    errorMessage: 'timed out after 30s',
    createdAt: '2026-04-12T11:20:00.000Z',
  });
  telemetry.noteRunProgress({
    runId: 'r1',
    phase: 'stale',
    text: 'Coder status: Run stalled.',
    createdAt: '2026-04-12T11:45:00.000Z',
  });
  telemetry.noteRunFailed({
    runId: 'r2',
    errorMessage: 'Pi runner timed out after 600000ms',
    createdAt: '2026-04-12T11:50:00.000Z',
  });
  telemetry.noteRunFailed({
    runId: 'r3',
    errorMessage: 'Unhandled worker exception',
    createdAt: '2026-04-12T11:59:00.000Z',
  });

  const snapshot = telemetry.getSnapshot(now);
  assert.equal(snapshot.incidents.length, 3);
  assert.deepEqual(
    snapshot.incidents.map((incident) => incident.runId),
    ['r3', 'r2', 'r1'],
  );
  assert.deepEqual(
    snapshot.incidents.map((incident) => incident.kind),
    ['failed', 'timeout', 'stale'],
  );
});

test('status telemetry prunes stale incidents when writing new events', () => {
  const telemetry = createStatusTelemetry({
    incidentWindowMs: 30 * 60 * 1000,
    maxIncidents: 3,
  });

  telemetry.noteRunFailed({
    runId: 'old',
    errorMessage: 'timed out after 30s',
    createdAt: '2026-04-12T10:00:00.000Z',
  });
  telemetry.noteRunFailed({
    runId: 'new',
    errorMessage: 'worker crash',
    createdAt: '2026-04-12T11:00:00.000Z',
  });

  const snapshot = telemetry.getSnapshot(
    Date.parse('2026-04-12T10:05:00.000Z'),
  );
  assert.deepEqual(
    snapshot.incidents.map((incident) => incident.runId),
    ['new'],
  );
});

test('status report renders pulse first and alerts on timeout incidents', () => {
  const telemetry = createStatusTelemetry({
    incidentWindowMs: 30 * 60 * 1000,
    maxIncidents: 3,
  });

  telemetry.noteRunProgress({
    runId: 'coder-1',
    phase: 'tool_running',
    text: 'Coder status: Running bash.',
    detail: 'bash',
    chatJid: 'telegram:1',
    createdAt: '2026-04-12T11:59:30.000Z',
  });
  telemetry.noteRunFailed({
    runId: 'coder-2',
    errorMessage: 'timed out while waiting for provider',
    chatJid: 'telegram:1',
    createdAt: '2026-04-12T11:59:40.000Z',
  });

  const text = formatStatusReport({
    assistantName: 'FarmFriend',
    version: '1.2.3 main@abc1234',
    runtime: 'docker',
    serviceStartedAt: '2026-04-12T10:00:00.000Z',
    incidentWindowLabel: '30m',
    stuckWarningSeconds: 120,
    nowMs: Date.parse('2026-04-12T12:00:00.000Z'),
    telegramEnabled: true,
    whatsappEnabled: false,
    whatsappConnected: false,
    registeredGroupCount: 2,
    mainGroupName: 'main',
    tasks: { active: 2, paused: 1, completed: 7 },
    activeChatRuns: [
      {
        requestId: 'chat-1',
        chatJid: 'telegram:1',
        startedAt: Date.parse('2026-04-12T11:59:00.000Z'),
      },
    ],
    activeCoderRuns: [
      {
        requestId: 'coder-1',
        mode: 'execute',
        chatJid: 'telegram:1',
        groupName: 'main',
        startedAt: Date.parse('2026-04-12T11:58:00.000Z'),
        config: { toolMode: 'full', isSubagent: false, workspaceMode: 'ephemeral_worktree' },
        state: 'running',
      },
    ],
    telemetry: telemetry.getSnapshot(Date.parse('2026-04-12T12:00:00.000Z')),
    agentRunning: true,
    chatRuntimePreferenceLines: ['- model: zai/glm-4.7'],
    chatUsage: { runs: 5, totalTokens: 12345 },
    chatActiveRun: {
      requestId: 'chat-1',
      startedAt: Date.parse('2026-04-12T11:59:00.000Z'),
    },
  });

  assert.match(text, /^FarmFriend pulse: ALERT/m);
  assert.match(text, /- version: 1.2.3 main@abc1234/);
  assert.match(text, /- agent_running: working/);
  assert.match(text, /- active_runs: agent=1 coder=1 subagent=0/);
  assert.match(text, /Active coder\/subagent runs:/);
  assert.match(text, /phase=tool_running\(bash\)/);
  assert.match(text, /Recent incidents \(30m\):/);
  assert.match(text, /kind=timeout run=coder-2/);
  assert.match(text, /Chat context:/);
  assert.match(text, /- chat_run_active: yes/);
});

test('status report marks warn when active run progress is stale beyond threshold', () => {
  const telemetry = createStatusTelemetry({
    incidentWindowMs: 30 * 60 * 1000,
    maxIncidents: 3,
  });

  telemetry.noteRunProgress({
    runId: 'coder-stuck',
    phase: 'thinking',
    text: 'Coder status: Reasoning about the task.',
    createdAt: '2026-04-12T11:55:00.000Z',
  });

  const text = formatStatusReport({
    assistantName: 'FarmFriend',
    version: '1.2.3 main@abc1234',
    runtime: 'docker',
    serviceStartedAt: '2026-04-12T11:00:00.000Z',
    incidentWindowLabel: '30m',
    stuckWarningSeconds: 120,
    nowMs: Date.parse('2026-04-12T12:00:00.000Z'),
    telegramEnabled: true,
    whatsappEnabled: true,
    whatsappConnected: true,
    registeredGroupCount: 1,
    mainGroupName: 'main',
    tasks: { active: 0, paused: 0, completed: 0 },
    activeChatRuns: [],
    activeCoderRuns: [
      {
        requestId: 'coder-stuck',
        mode: 'execute',
        chatJid: 'telegram:1',
        groupName: 'main',
        startedAt: Date.parse('2026-04-12T11:50:00.000Z'),
        config: { toolMode: 'full', isSubagent: false, workspaceMode: 'ephemeral_worktree' },
        state: 'running',
      },
    ],
    telemetry: telemetry.getSnapshot(Date.parse('2026-04-12T12:00:00.000Z')),
    agentRunning: true,
  });

  assert.match(text, /^FarmFriend pulse: WARN/m);
  assert.match(text, /warnings: stuck_runs=1/);
});

test('status report includes active durable long runs in agent count and details', () => {
  const telemetry = createStatusTelemetry({
    incidentWindowMs: 30 * 60 * 1000,
    maxIncidents: 3,
  });

  const text = formatStatusReport({
    assistantName: 'FarmFriend',
    version: '1.2.3 main@abc1234',
    runtime: 'docker',
    serviceStartedAt: '2026-04-12T11:00:00.000Z',
    incidentWindowLabel: '30m',
    stuckWarningSeconds: 120,
    nowMs: Date.parse('2026-04-12T12:00:00.000Z'),
    telegramEnabled: true,
    whatsappEnabled: true,
    whatsappConnected: true,
    registeredGroupCount: 1,
    mainGroupName: 'main',
    tasks: { active: 0, paused: 0, completed: 0 },
    activeChatRuns: [],
    activeLongRuns: [
      {
        id: 'run-long-1',
        chatJid: 'telegram:1',
        status: 'running',
        createdAt: Date.parse('2026-04-12T11:50:00.000Z'),
        startedAt: Date.parse('2026-04-12T11:51:00.000Z'),
        lastProgressAt: Date.parse('2026-04-12T11:59:30.000Z'),
        phase: 'tool_running',
        detail: 'bash',
      },
    ],
    activeCoderRuns: [],
    telemetry: telemetry.getSnapshot(Date.parse('2026-04-12T12:00:00.000Z')),
    agentRunning: true,
  });

  assert.match(text, /- agent_running: working/);
  assert.match(text, /- active_runs: agent=1 coder=0 subagent=0/);
  assert.match(text, /Active long runs:/);
  assert.match(
    text,
    /id=run-long-1 status=running phase=tool_running\(bash\) age=540s last_progress=30s ago chat=telegram:1/,
  );
});

test('status report includes knowledge section when knowledge telemetry is provided', () => {
  const telemetry = createStatusTelemetry({
    incidentWindowMs: 30 * 60 * 1000,
    maxIncidents: 3,
  });

  const text = formatStatusReport({
    assistantName: 'FarmFriend',
    version: '1.2.3 main@abc1234',
    runtime: 'docker',
    serviceStartedAt: '2026-04-12T11:00:00.000Z',
    incidentWindowLabel: '30m',
    stuckWarningSeconds: 120,
    nowMs: Date.parse('2026-04-12T12:00:00.000Z'),
    telegramEnabled: true,
    whatsappEnabled: true,
    whatsappConnected: true,
    registeredGroupCount: 1,
    mainGroupName: 'main',
    tasks: { active: 1, paused: 0, completed: 2 },
    knowledge: {
      ready: true,
      rawCaptures: 4,
      wikiDocs: 7,
      lastProgressUpdateAt: '2026-04-12T09:00:00.000Z',
      nightlyTaskStatus: 'active',
      nightlyTaskNextRun: '2026-04-13T02:17:00.000Z',
    },
    activeChatRuns: [],
    activeCoderRuns: [],
    telemetry: telemetry.getSnapshot(Date.parse('2026-04-12T12:00:00.000Z')),
    agentRunning: false,
  });

  assert.match(
    text,
    /- knowledge: ready=yes wiki_docs=7 raw_captures=4 task=active/,
  );
  assert.match(
    text,
    /- knowledge_progress: last_update=2026-04-12T09:00:00.000Z next_task_run=2026-04-13T02:17:00.000Z/,
  );
});

test('status report redacts evaluator verdict details from user-visible incidents', () => {
  const telemetry = createStatusTelemetry({
    incidentWindowMs: 30 * 60 * 1000,
    maxIncidents: 3,
  });

  telemetry.noteRuntimeError({
    runId: 'eval-raw-json',
    chatJid: 'telegram:1',
    errorMessage: JSON.stringify({
      pass: false,
      score: 1,
      issues: ['internal artifact verification failure'],
      feedback: 'internal evaluator feedback',
    }),
    createdAt: '2026-04-12T11:59:40.000Z',
  });
  telemetry.noteRuntimeError({
    runId: 'eval-text',
    chatJid: 'telegram:1',
    errorMessage:
      'verification_failed: score 1/10 issues internal artifact verification failure feedback internal evaluator feedback',
    createdAt: '2026-04-12T11:59:45.000Z',
  });

  const text = formatStatusReport({
    assistantName: 'FarmFriend',
    version: '1.2.3 main@abc1234',
    runtime: 'docker',
    serviceStartedAt: '2026-04-12T11:00:00.000Z',
    incidentWindowLabel: '30m',
    stuckWarningSeconds: 120,
    nowMs: Date.parse('2026-04-12T12:00:00.000Z'),
    telegramEnabled: true,
    whatsappEnabled: true,
    whatsappConnected: true,
    registeredGroupCount: 1,
    mainGroupName: 'main',
    tasks: { active: 1, paused: 0, completed: 2 },
    activeChatRuns: [],
    activeCoderRuns: [],
    telemetry: telemetry.getSnapshot(Date.parse('2026-04-12T12:00:00.000Z')),
    agentRunning: false,
  });

  assert.match(text, /Recent incidents \(30m\):/);
  assert.match(text, /verification_failed/);
  assert.doesNotMatch(text, /"pass"\s*:/);
  assert.doesNotMatch(text, /\bpass\s*:/);
  assert.doesNotMatch(text, /"score"\s*:/);
  assert.doesNotMatch(text, /score 1\/10/);
  assert.doesNotMatch(text, /"issues"\s*:/);
  assert.doesNotMatch(text, /internal artifact verification failure/);
  assert.doesNotMatch(text, /"feedback"\s*:/);
  assert.doesNotMatch(text, /internal evaluator feedback/);
});
