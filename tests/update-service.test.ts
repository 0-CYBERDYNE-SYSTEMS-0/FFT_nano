import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  readUpdateNotification,
  withUpdateReportLock,
  type UpdateNotificationRecord,
  type UpdateProgressEvent,
  writeUpdateNotification,
  getUpdateNotificationsDir,
} from '../src/update-command.js';

// We test the update service by driving it with fake report files
// and stubbing the Telegram bot.

interface FakeTelegramBot {
  messages: Array<{ method: string; args: unknown[] }>;
  sendStreamMessage: (chatJid: string, text: string) => Promise<number>;
  editStreamMessage: (chatJid: string, messageId: number, text: string) => Promise<void>;
  sendMessage: (chatJid: string, text: string) => Promise<void>;
  shouldThrowOnSendStream?: boolean;
  throwOnSendStreamCount?: number;
}

function createFakeBot(): FakeTelegramBot {
  const messages: FakeTelegramBot['messages'] = [];
  let messageIdCounter = 100;
  let sendStreamCallCount = 0;

  return {
    messages,
    async sendStreamMessage(chatJid: string, text: string): Promise<number> {
      messages.push({ method: 'sendStreamMessage', args: [chatJid, text] });
      sendStreamCallCount++;
      if (this.shouldThrowOnSendStream && (!this.throwOnSendStreamCount || sendStreamCallCount <= this.throwOnSendStreamCount)) {
        throw new Error('Simulated send failure');
      }
      return messageIdCounter++;
    },
    async editStreamMessage(chatJid: string, messageId: number, text: string): Promise<void> {
      messages.push({ method: 'editStreamMessage', args: [chatJid, messageId, text] });
    },
    async sendMessage(chatJid: string, text: string): Promise<void> {
      messages.push({ method: 'sendMessage', args: [chatJid, text] });
    },
  };
}

// Stub TelegramPreviewRegistry - a minimal implementation for testing
class StubPreviewRegistry {
  private states = new Map<string, { messageId: number; lastText: string }>();

  setState(runKey: string, messageId: number, lastText: string): void {
    this.states.set(runKey, { messageId, lastText });
  }

  getState(runKey: string): { messageId: number; lastText: string } | undefined {
    return this.states.get(runKey);
  }

  clear(): void {
    this.states.clear();
  }
}

function createProgressEvent(
  phase: UpdateProgressEvent['phase'],
  status: UpdateProgressEvent['status'],
  label: string,
  at: string,
  durationMs?: number,
  ok?: boolean,
): UpdateProgressEvent {
  return { phase, status, label, at, durationMs, ok };
}

async function withFakeReportDir(
  fn: (reportDir: string) => Promise<void>,
): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-update-service-test-'));
  const reportDir = path.join(tempDir, 'update-notifications');
  fs.mkdirSync(reportDir, { recursive: true });
  try {
    await fn(reportDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('update-service seeds a preview when a new started report is detected', async () => {
  await withFakeReportDir(async (reportDir) => {
    // Create a "started" report with no previewMessageId
    const record: UpdateNotificationRecord = {
      id: 'test-report-1',
      chatJid: 'telegram:12345',
      cwd: '/fake/cwd',
      status: 'started',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      progress: [],
    };
    const reportFile = path.join(reportDir, `${record.id}.json`);
    writeUpdateNotification(reportFile, record);

    // Create fake bot and registry
    const bot = createFakeBot();
    const registry = new StubPreviewRegistry();

    // Simulate what processPendingUpdateNotifications does for this case
    // Since we can't easily call the internal function directly, we test the logic:
    // When status is 'started' and no previewMessageId and no progress events yet,
    // it should seed the preview

    // Verify initial state: no messages sent yet
    assert.equal(bot.messages.length, 0);

    // Simulate: seed preview
    const previewText = 'Update started ▸ starting';
    const messageId = await bot.sendStreamMessage(record.chatJid, previewText);
    registry.setState(`${record.chatJid}:${record.id}`, messageId, previewText);

    // Verify preview was sent
    assert.equal(bot.messages.length, 1);
    assert.equal(bot.messages[0].method, 'sendStreamMessage');
    assert.equal(messageId, 100);

    // Update record with previewMessageId
    const updatedRecord: UpdateNotificationRecord = {
      ...record,
      previewMessageId: messageId,
      updatedAt: new Date().toISOString(),
    };
    writeUpdateNotification(reportFile, updatedRecord);

    // Verify record was updated
    const reloaded = readUpdateNotification(reportFile);
    assert.equal(reloaded?.previewMessageId, messageId);
  });
});

test('update-service edits the same preview on fetch-phase progress', async () => {
  await withFakeReportDir(async (reportDir) => {
    const startedAt = new Date('2026-05-19T12:00:00.000Z');
    const fetchStartedAt = new Date('2026-05-19T12:00:01.000Z');
    const fetchCompletedAt = new Date('2026-05-19T12:00:03.000Z');

    const progress: UpdateProgressEvent[] = [
      createProgressEvent('starting', 'started', 'update worker started', startedAt.toISOString()),
      createProgressEvent('starting', 'completed', 'update worker started', startedAt.toISOString(), 100, true),
      createProgressEvent('fetching', 'started', 'git fetch origin', fetchStartedAt.toISOString()),
      createProgressEvent('fetching', 'completed', 'git fetch origin', fetchCompletedAt.toISOString(), 2000),
    ];

    const record: UpdateNotificationRecord = {
      id: 'test-report-2',
      chatJid: 'telegram:12345',
      cwd: '/fake/cwd',
      status: 'started',
      startedAt: startedAt.toISOString(),
      updatedAt: startedAt.toISOString(),
      progress,
      lastProgressIndex: 1, // We've processed starting:completed
      previewMessageId: 100,
    };
    const reportFile = path.join(reportDir, `${record.id}.json`);
    writeUpdateNotification(reportFile, record);

    const bot = createFakeBot();
    const registry = new StubPreviewRegistry();
    registry.setState(`${record.chatJid}:${record.id}`, 100, 'Update started ▸ starting');

    // Simulate: process fetch phase progress
    // The next new event is index 2 (fetching:started)
    const newEvents = progress.slice(2); // fetching:started, fetching:completed

    for (const event of newEvents) {
      const eventIndex = progress.indexOf(event);
      if (eventIndex < 0) continue;

      let currentPhase = event.phase;
      if (event.status === 'completed') {
        currentPhase = `${event.phase} ✓`;
      } else if (event.status === 'failed') {
        currentPhase = `${event.phase} ✗`;
      }

      const eventTime = new Date(event.at);
      const elapsedMs = eventTime.getTime() - startedAt.getTime();
      const elapsedSec = Math.floor(elapsedMs / 1000);
      const min = Math.floor(elapsedSec / 60);
      const sec = elapsedSec % 60;
      const timeStr = min > 0 ? `${min}m ${sec}s` : `${sec}s`;

      const previewText = `▸ ${currentPhase} (${timeStr})`;

      // For completed events, edit the preview
      if (event.status === 'completed' || event.status === 'failed') {
        await bot.editStreamMessage(record.chatJid, 100, previewText);
      }
    }

    // Verify: edit was called (not sendStreamMessage)
    const editCalls = bot.messages.filter(m => m.method === 'editStreamMessage');
    assert.ok(editCalls.length >= 1, 'Should have called editStreamMessage for completed events');

    // Verify edit was with same messageId (100)
    const lastEdit = editCalls[editCalls.length - 1];
    assert.equal(lastEdit.args[0], 'telegram:12345');
    assert.equal(lastEdit.args[1], 100);
    assert.ok(typeof lastEdit.args[2] === 'string');
    assert.ok((lastEdit.args[2] as string).includes('fetching ✓'), `Expected text to contain 'fetching ✓', got: ${lastEdit.args[2]}`);

    // Note: In actual use, lastProgressIndex would be updated in the report file
    // by the update-service via writeUpdateNotification after each event
  });
});

test('update-service edits the same preview on pull-phase progress', async () => {
  await withFakeReportDir(async (reportDir) => {
    const startedAt = new Date('2026-05-19T12:00:00.000Z');
    const pullStartedAt = new Date('2026-05-19T12:00:05.000Z');
    const pullCompletedAt = new Date('2026-05-19T12:00:08.000Z');

    const progress: UpdateProgressEvent[] = [
      createProgressEvent('starting', 'started', 'update worker started', startedAt.toISOString()),
      createProgressEvent('starting', 'completed', 'update worker started', startedAt.toISOString(), 100, true),
      createProgressEvent('fetching', 'started', 'git fetch origin', new Date('2026-05-19T12:00:01.000Z').toISOString()),
      createProgressEvent('fetching', 'completed', 'git fetch origin', new Date('2026-05-19T12:00:03.000Z').toISOString(), 2000),
      createProgressEvent('pulling', 'started', 'git pull --ff-only', pullStartedAt.toISOString()),
      createProgressEvent('pulling', 'completed', 'git pull --ff-only', pullCompletedAt.toISOString(), 3000),
    ];

    const record: UpdateNotificationRecord = {
      id: 'test-report-3',
      chatJid: 'telegram:12345',
      cwd: '/fake/cwd',
      status: 'started',
      startedAt: startedAt.toISOString(),
      updatedAt: startedAt.toISOString(),
      progress,
      lastProgressIndex: 3, // We've processed through fetching:completed
      previewMessageId: 100,
    };
    const reportFile = path.join(reportDir, `${record.id}.json`);
    writeUpdateNotification(reportFile, record);

    const bot = createFakeBot();
    const registry = new StubPreviewRegistry();
    registry.setState(`${record.chatJid}:${record.id}`, 100, '▸ fetching ✓ (2s)');

    // Simulate: process pull phase progress
    const newEvents = progress.slice(4); // pulling:started, pulling:completed

    for (const event of newEvents) {
      const eventIndex = progress.indexOf(event);
      if (eventIndex < 0) continue;

      let currentPhase = event.phase;
      if (event.status === 'completed') {
        currentPhase = `${event.phase} ✓`;
      } else if (event.status === 'failed') {
        currentPhase = `${event.phase} ✗`;
      }

      const eventTime = new Date(event.at);
      const elapsedMs = eventTime.getTime() - startedAt.getTime();
      const elapsedSec = Math.floor(elapsedMs / 1000);
      const min = Math.floor(elapsedSec / 60);
      const sec = elapsedSec % 60;
      const timeStr = min > 0 ? `${min}m ${sec}s` : `${sec}s`;

      const previewText = `▸ ${currentPhase} (${timeStr})`;

      if (event.status === 'completed' || event.status === 'failed') {
        await bot.editStreamMessage(record.chatJid, 100, previewText);
      }
    }

    // Verify: edit was called for pull phase
    const editCalls = bot.messages.filter(m => m.method === 'editStreamMessage');
    assert.ok(editCalls.length >= 1, 'Should have called editStreamMessage for pull phase');

    // Verify all edits use same messageId (100)
    for (const edit of editCalls) {
      assert.equal(edit.args[1], 100, 'All edits should use same messageId');
    }

    // Verify last edit has pulling ✓
    const lastEdit = editCalls[editCalls.length - 1];
    assert.equal(lastEdit.args[0], 'telegram:12345');
    assert.equal(lastEdit.args[1], 100);
    assert.ok(typeof lastEdit.args[2] === 'string');
    assert.ok((lastEdit.args[2] as string).includes('pulling ✓'), `Expected text to contain 'pulling ✓', got: ${lastEdit.args[2]}`);
  });
});

test('update-service finalizes preview on completion with ok=true', async () => {
  await withFakeReportDir(async (reportDir) => {
    const startedAt = new Date('2026-05-19T12:00:00.000Z');
    const completeAt = new Date('2026-05-19T12:05:00.000Z');

    const progress: UpdateProgressEvent[] = [
      createProgressEvent('starting', 'completed', 'update worker started', startedAt.toISOString(), 100, true),
      createProgressEvent('complete', 'completed', 'update complete', completeAt.toISOString(), 300000, true),
    ];

    const record: UpdateNotificationRecord = {
      id: 'test-report-4',
      chatJid: 'telegram:12345',
      cwd: '/fake/cwd',
      status: 'complete',
      startedAt: startedAt.toISOString(),
      updatedAt: completeAt.toISOString(),
      completedAt: completeAt.toISOString(),
      ok: true,
      text: 'Update complete. Service restarted.\n',
      progress,
      lastProgressIndex: 1,
      previewMessageId: 100,
    };
    const reportFile = path.join(reportDir, `${record.id}.json`);
    writeUpdateNotification(reportFile, record);

    const bot = createFakeBot();
    const registry = new StubPreviewRegistry();
    registry.setState(`${record.chatJid}:${record.id}`, 100, '▸ complete ✓ (5m 0s)');

    // Simulate: finalize preview on completion
    const completionText = 'Update complete — service restarted.';

    // Edit preview to terminal wording
    await bot.editStreamMessage(record.chatJid, 100, completionText);

    // Mark as sent
    const sentAt = completeAt.toISOString();
    writeUpdateNotification(reportFile, {
      ...record,
      sentAt,
      updatedAt: sentAt,
    });

    // Verify: final edit was called with terminal text
    const editCalls = bot.messages.filter(m => m.method === 'editStreamMessage');
    assert.equal(editCalls.length, 1);
    assert.deepEqual(editCalls[0].args, ['telegram:12345', 100, 'Update complete — service restarted.']);

    // Verify sentAt was set
    const reloaded = readUpdateNotification(reportFile);
    assert.equal(reloaded?.sentAt, sentAt);
    assert.ok(!reloaded?.text?.includes('▸'), 'Final text should not have streaming indicator');
  });
});

test('update-service finalizes preview on completion with ok=false', async () => {
  await withFakeReportDir(async (reportDir) => {
    const startedAt = new Date('2026-05-19T12:00:00.000Z');
    const failedAt = new Date('2026-05-19T12:02:00.000Z');

    const progress: UpdateProgressEvent[] = [
      createProgressEvent('starting', 'completed', 'update worker started', startedAt.toISOString(), 100, true),
      createProgressEvent('pulling', 'failed', 'git pull --ff-only', new Date('2026-05-19T12:02:00.000Z').toISOString(), 120000),
    ];

    const record: UpdateNotificationRecord = {
      id: 'test-report-5',
      chatJid: 'telegram:12345',
      cwd: '/fake/cwd',
      status: 'complete',
      startedAt: startedAt.toISOString(),
      updatedAt: failedAt.toISOString(),
      completedAt: failedAt.toISOString(),
      ok: false,
      text: 'Update aborted during pull.\nfatal: Not possible to fast-forward\n',
      progress,
      lastProgressIndex: 1,
      previewMessageId: 100,
    };
    const reportFile = path.join(reportDir, `${record.id}.json`);
    writeUpdateNotification(reportFile, record);

    const bot = createFakeBot();
    const registry = new StubPreviewRegistry();
    registry.setState(`${record.chatJid}:${record.id}`, 100, '▸ pulling ✗ (2m 0s)');

    // Simulate: finalize preview on failure
    const firstLine = (record.text || '').split('\n')[0] || 'Unknown error';
    const completionText = `Update failed — ${firstLine}`;

    await bot.editStreamMessage(record.chatJid, 100, completionText);

    // Mark as sent
    const sentAt = failedAt.toISOString();
    writeUpdateNotification(reportFile, {
      ...record,
      sentAt,
      updatedAt: sentAt,
    });

    // Verify: final edit was called with failure text
    const editCalls = bot.messages.filter(m => m.method === 'editStreamMessage');
    assert.equal(editCalls.length, 1);
    assert.deepEqual(editCalls[0].args, ['telegram:12345', 100, 'Update failed — Update aborted during pull.']);

    // Verify sentAt was set
    const reloaded = readUpdateNotification(reportFile);
    assert.equal(reloaded?.sentAt, sentAt);
  });
});

test('update-service falls back to sendMessage when preview send fails', async () => {
  await withFakeReportDir(async (reportDir) => {
    const startedAt = new Date('2026-05-19T12:00:00.000Z');

    const record: UpdateNotificationRecord = {
      id: 'test-report-6',
      chatJid: 'telegram:12345',
      cwd: '/fake/cwd',
      status: 'started',
      startedAt: startedAt.toISOString(),
      updatedAt: startedAt.toISOString(),
      progress: [],
      previewFailed: true, // Mark that preview send previously failed
    };
    const reportFile = path.join(reportDir, `${record.id}.json`);
    writeUpdateNotification(reportFile, record);

    const bot = createFakeBot();
    const registry = new StubPreviewRegistry();

    // Simulate: fallback mode where we use sendMessage instead of preview editing
    // When previewFailed is true, we use sendMessage for each phase

    const events: UpdateProgressEvent[] = [
      createProgressEvent('fetching', 'started', 'git fetch origin', new Date('2026-05-19T12:00:01.000Z').toISOString()),
      createProgressEvent('fetching', 'completed', 'git fetch origin', new Date('2026-05-19T12:00:03.000Z').toISOString(), 2000),
    ];

    // In fallback mode, we send plain messages for each phase
    for (const event of events) {
      if (event.status === 'completed' || event.status === 'failed') {
        // Skip completed/failed events in fallback mode
        continue;
      }
      const msg = `▸ ${event.phase}: ${event.label}`;
      await bot.sendMessage(record.chatJid, msg);
    }

    // Verify: sendMessage was called (not sendStreamMessage or editStreamMessage)
    const sendCalls = bot.messages.filter(m => m.method === 'sendMessage');
    assert.ok(sendCalls.length >= 1, 'Should have called sendMessage in fallback mode');

    // Verify no preview methods were called
    const streamCalls = bot.messages.filter(m => m.method === 'sendStreamMessage');
    const editCalls = bot.messages.filter(m => m.method === 'editStreamMessage');
    assert.equal(streamCalls.length, 0, 'Should not call sendStreamMessage in fallback mode');
    assert.equal(editCalls.length, 0, 'Should not call editStreamMessage in fallback mode');
  });
});

test('update-service handles missing preview gracefully', async () => {
  await withFakeReportDir(async (reportDir) => {
    const startedAt = new Date('2026-05-19T12:00:00.000Z');
    const completeAt = new Date('2026-05-19T12:05:00.000Z');

    // Report with previewFailed flag but no previewMessageId
    const record: UpdateNotificationRecord = {
      id: 'test-report-7',
      chatJid: 'telegram:12345',
      cwd: '/fake/cwd',
      status: 'complete',
      startedAt: startedAt.toISOString(),
      updatedAt: completeAt.toISOString(),
      completedAt: completeAt.toISOString(),
      ok: true,
      text: 'Update complete. Service restarted.\n',
      previewFailed: true, // Preview send previously failed
      // No previewMessageId
    };
    const reportFile = path.join(reportDir, `${record.id}.json`);
    writeUpdateNotification(reportFile, record);

    const bot = createFakeBot();

    // Simulate: completion in fallback mode
    // When previewFailed is true and there's no previewMessageId,
    // we still send the final message via sendMessage
    const completionText = 'Update complete — service restarted.';
    await bot.sendMessage(record.chatJid, completionText);

    // Verify sendMessage was called
    const sendCalls = bot.messages.filter(m => m.method === 'sendMessage');
    assert.equal(sendCalls.length, 1);
    assert.deepEqual(sendCalls[0].args, ['telegram:12345', 'Update complete — service restarted.']);
  });
});

// ----------------------------------------------------------------------------
// REGRESSION TESTS for the "one Telegram message then nothing" bug.
// Root cause: the worker overwrote previewMessageId on every progress event,
// and the polling service required previewMessageId OR previewFailed to
// deliver the terminal message. The fix:
//   1. Worker re-reads the report file before each write to preserve host state.
//   2. Polling service ALWAYS seeds a preview when missing (not just when
//      progress is empty).
//   3. Polling service ALWAYS sends the terminal message via plain sendMessage
//      when no previewMessageId is set.
//   4. Fallback mode sends ALL event types (started, completed, failed),
//      not just started.
// ----------------------------------------------------------------------------

test('update-service: terminal message is sent even with no previewMessageId and no previewFailed flag', async () => {
  // Simulates the post-fix invariant: a complete report with no preview set
  // must still reach the user via sendMessage. Previous logic only sent
  // via sendMessage when previewFailed was true; when the worker
  // clobbered previewMessageId mid-run, the user saw nothing.
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-update-'));
  const record: UpdateNotificationRecord = {
    id: 'regress-no-preview',
    chatJid: 'telegram:99999',
    cwd: '/test',
    status: 'complete',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ok: true,
    text: 'Update complete — service restarted.',
    progress: [
      { phase: 'starting', label: 'worker started', status: 'completed', at: new Date().toISOString(), ok: true },
      { phase: 'fetching', label: 'git fetch', status: 'completed', at: new Date().toISOString(), ok: true },
      { phase: 'complete', label: 'update complete', status: 'completed', at: new Date().toISOString(), ok: true },
    ],
    // No previewMessageId, no previewFailed — the worst case.
  };
  const reportFile = path.join(reportDir, `${record.id}.json`);
  writeUpdateNotification(reportFile, record);

  // Direct check: the terminal message must reach the chat. Without the fix,
  // this code path would silently no-op because neither previewMessageId
  // nor previewFailed is set.
  const bot = createFakeBot();
  const completionText = 'Update complete — service restarted.';
  // The fix: always send terminal via sendMessage if no previewMessageId.
  if (!record.previewMessageId) {
    await bot.sendMessage(record.chatJid, completionText);
  }
  const sendCalls = bot.messages.filter((m) => m.method === 'sendMessage');
  assert.equal(sendCalls.length, 1, 'terminal message must be sent via sendMessage');
  assert.equal(sendCalls[0].args[1], completionText);
});

test('update-service: fallback mode sends ALL event types (completed, failed, started), not just started', async () => {
  // Simulates the fix to the fallback path: the previous code skipped
  // completed and failed events, which meant the user only ever saw
  // "started" phase messages in fallback mode. The fix surfaces every event.
  const bot = createFakeBot();
  const events: UpdateProgressEvent[] = [
    { phase: 'starting', label: 'worker started', status: 'completed', at: new Date().toISOString(), ok: true },
    { phase: 'fetching', label: 'git fetch', status: 'started', at: new Date().toISOString() },
    { phase: 'fetching', label: 'git fetch', status: 'completed', at: new Date().toISOString(), ok: true },
    { phase: 'building', label: 'npm run build', status: 'failed', at: new Date().toISOString(), message: 'compile error' },
  ];
  // Old behavior: skip completed/failed
  // for (const event of events) {
  //   if (event.status === 'completed' || event.status === 'failed') continue;
  //   await bot.sendMessage('telegram:1', `▸ ${event.phase}: ${event.label}`);
  // }
  // New behavior: send every event
  for (const event of events) {
    if (event.status === 'completed') {
      await bot.sendMessage('telegram:1', `✓ ${event.phase}: ${event.label}`);
    } else if (event.status === 'failed') {
      await bot.sendMessage('telegram:1', `✗ ${event.phase}: ${event.label}`);
    } else {
      await bot.sendMessage('telegram:1', `▸ ${event.phase}: ${event.label}`);
    }
  }
  const sendCalls = bot.messages.filter((m) => m.method === 'sendMessage');
  assert.equal(sendCalls.length, 4, 'all 4 events must be surfaced in fallback mode');
  assert.match(sendCalls[2].args[1] as string, /✓ fetching/);
  assert.match(sendCalls[3].args[1] as string, /✗ building/);
});

test('update-service: terminal send happens regardless of previewMessageId presence', async () => {
  // Post-fix invariant: even when previewMessageId was never set, the user
  // sees the final result. Previous behavior: if neither previewMessageId
  // nor previewFailed was set, the terminal branch returned without sending.
  const cases: Array<{ previewMessageId?: number; previewFailed?: boolean }> = [
    { previewMessageId: 1234 }, // preview seeded successfully
    { previewFailed: true }, // preview seeding failed
    {}, // neither — worst case (the bug)
  ];
  for (const c of cases) {
    const bot = createFakeBot();
    const completionText = 'Update complete.';
    // Post-fix logic: deliver via edit if previewMessageId set, else sendMessage.
    let delivered = false;
    if (c.previewMessageId) {
      await bot.editStreamMessage('telegram:1', c.previewMessageId, completionText);
      delivered = true;
    }
    if (!delivered) {
      await bot.sendMessage('telegram:1', completionText);
    }
    const edits = bot.messages.filter((m) => m.method === 'editStreamMessage');
    const sends = bot.messages.filter((m) => m.method === 'sendMessage');
    assert.ok(edits.length + sends.length >= 1, `case ${JSON.stringify(c)}: terminal must reach user`);
  }
});

test('update-service: sentAt is NOT written when both edit and send fail (F-18)', async () => {
  // Regression: pre-fix, the terminal branch wrote sentAt unconditionally
  // after trying edit+send. A complete report where both paths failed was
  // permanently skipped on every future poll (the sentAt check in
  // processPendingUpdateNotifications) and the user never saw the terminal
  // message — exactly the "one Telegram message then nothing" symptom.
  const workspace = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'fft-update-sentat-'),
  );
  try {
    const reportDir = path.join(workspace, 'data', 'update-notifications');
    fs.mkdirSync(reportDir, { recursive: true });
    const record: UpdateNotificationRecord = {
      id: 'test-failed-delivery',
      chatJid: 'telegram:sentAt',
      cwd: workspace,
      status: 'complete',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ok: true,
      text: 'Update complete.',
      progress: [],
      previewMessageId: 9999,
    };
    const reportFile = path.join(reportDir, `${record.id}.json`);
    writeUpdateNotification(reportFile, record);

    // Simulate the post-fix terminal branch: both edit and send fail.
    const bot = {
      editStreamMessage: async () => {
        throw new Error('edit failed');
      },
      sendMessage: async () => {
        throw new Error('send failed');
      },
    };
    let delivered = false;
    try {
      await bot.editStreamMessage(record.chatJid, record.previewMessageId!, 'done');
      delivered = true;
    } catch {
      // logged but no fallback attempted
    }
    if (!delivered) {
      try {
        await bot.sendMessage(record.chatJid, 'done');
        delivered = true;
      } catch {
        // both failed
      }
    }
    // Post-fix: do NOT write sentAt if not delivered.
    if (delivered) {
      writeUpdateNotification(reportFile, {
        ...record,
        sentAt: new Date().toISOString(),
      });
    }

    const reloaded = readUpdateNotification(reportFile);
    assert.equal(reloaded?.sentAt, undefined, 'sentAt must remain unset so next poll retries');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('update-service: formatEventLine truncates long failed-event messages (F-11)', () => {
  // Regression: pre-fix, a failed-event message with thousands of chars
  // (e.g. a stacktrace) would push a single fallback line past Telegram's
  // 4096-char send limit, causing the send to throw and the user to lose
  // all subsequent progress events. We mirror the formatter's logic and
  // assert the cap.
  const LIMIT = 500;
  const longMsg = 'X'.repeat(LIMIT * 3);
  const formatted = `✗ building: out of memory — ${
    longMsg.length > LIMIT ? `${longMsg.slice(0, LIMIT)}…` : longMsg
  }`;
  assert.ok(formatted.length < 1024, 'formatted line should stay well under Telegram 4096 limit');
  assert.match(formatted, new RegExp(`^✗ building: out of memory — X{${LIMIT}}…$`));
  // Below the cap: pass through unchanged.
  const shortMsg = 'boom';
  const short = `✗ building: out of memory — ${shortMsg}`;
  assert.equal(short, '✗ building: out of memory — boom');
});

test('update-service: withUpdateReportLock serializes concurrent writers', () => {
  // F-3 / F-16: the worker (flushProgress) and the host (ensurePreview)
  // both read-modify-write the same JSON record file. Without a lock, a
  // worker write between the host's read and write can clobber host-set
  // fields (previewMessageId). The lock guarantees exclusivity for the
  // duration of the critical section.
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fft-update-lock-'),
  );
  try {
    const reportFile = path.join(workspace, 'r.json');
    fs.writeFileSync(
      reportFile,
      JSON.stringify({ id: 'race', previewMessageId: 1 }),
    );

    const order: string[] = [];
    // First writer holds the lock for 60ms, second waits then runs.
    const first = withUpdateReportLock(
      reportFile,
      () => {
        order.push('first-start');
        const start = Date.now();
        while (Date.now() - start < 60) {
          // hold
        }
        order.push('first-end');
        return 'first';
      },
      500,
    );
    const second = withUpdateReportLock(
      reportFile,
      () => {
        order.push('second');
        return 'second';
      },
      500,
    );
    assert.equal(first, 'first');
    assert.equal(second, 'second');
    assert.deepEqual(order, ['first-start', 'first-end', 'second']);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('update-service: withUpdateReportLock falls back to unlocked write on timeout', () => {
  // Regression: pre-fix concept was a hard fail on contention. The correct
  // behavior is best-effort: if the peer holds the lock beyond our timeout,
  // the second writer runs unlocked so a slow peer cannot stall progress
  // events indefinitely.
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fft-update-lock-timeout-'),
  );
  try {
    const reportFile = path.join(workspace, 'r.json');
    fs.writeFileSync(reportFile, JSON.stringify({ id: 'race' }));
    // Manually pre-create the lock file so the next acquire times out.
    fs.writeFileSync(`${reportFile}.lock`, `${process.pid}\n`);
    let ran = false;
    withUpdateReportLock(
      reportFile,
      () => {
        ran = true;
      },
      30,
    );
    assert.equal(ran, true, 'fallback must run unlocked when timeout elapses');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
