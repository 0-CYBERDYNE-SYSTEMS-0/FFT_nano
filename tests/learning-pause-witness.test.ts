import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  runLearningPauseBootWitness,
  computeLearningPauseAgeDays,
} from '../src/app.js';
import { buildLearningPauseHeartbeatContext } from '../src/heartbeat-service.js';
import {
  recordSelfImproveEvent,
  initSelfImproveWitness,
  resetConsecutivePausedNoops,
} from '../src/self-improve-signals.js';
import {
  closeDatabase,
  getDeliveryByDedupeKey,
  initDatabaseAtPath,
} from '../src/db.js';
import { createOutboxDeliverer } from '../src/outbox.js';
import { resolveGroupFolderPath } from '../src/group-folder.js';

async function withTempDb(fn: () => void | Promise<void>): Promise<void> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-pause-witness-'));
  initDatabaseAtPath(path.join(tmpRoot, 'messages.db'));
  try {
    await fn();
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Witness #1 — boot witness
// ---------------------------------------------------------------------------

test.describe('SPEC-02 witness #1: boot witness', () => {
  test('learningPaused=true enqueues exactly one outbox row keyed by today; a second boot the same day does not double-post', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-boot-witness-'));
    const dbPath = path.join(tmpRoot, 'messages.db');
    try {
      initDatabaseAtPath(dbPath);
      const sends: Array<{ dest: string; body: string }> = [];
      const outbox = createOutboxDeliverer({
        sendMessage: async (dest, body) => {
          sends.push({ dest, body });
          return true;
        },
      });
      const now = new Date('2026-07-07T12:00:00Z');
      const deps = {
        state: {
          learningPaused: true,
          learningPausedAt: '2026-06-21T00:00:00Z',
        },
        outbox,
        findMainChatJid: () => 'telegram:main',
        now,
      };

      await runLearningPauseBootWitness(deps);
      assert.equal(sends.length, 1);
      const dedupeKey = 'learning-paused-boot:2026-07-07';
      const row = getDeliveryByDedupeKey(dedupeKey);
      assert.ok(row, 'expected one delivery_outbox row for the boot notice');
      assert.equal(row?.status, 'delivered');
      assert.match(row?.body || '', /paused/i);
      assert.match(row?.body || '', /16 days/);

      // Simulated crash-loop restart the same day must not double-post.
      await runLearningPauseBootWitness(deps);
      assert.equal(sends.length, 1, 'boot witness must not double-post same-day');
    } finally {
      closeDatabase();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('learningPaused=false produces no outbox row', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-boot-witness-'));
    const dbPath = path.join(tmpRoot, 'messages.db');
    try {
      initDatabaseAtPath(dbPath);
      const sends: Array<{ dest: string; body: string }> = [];
      const outbox = createOutboxDeliverer({
        sendMessage: async (dest, body) => {
          sends.push({ dest, body });
          return true;
        },
      });
      await runLearningPauseBootWitness({
        state: { learningPaused: false, learningPausedAt: null },
        outbox,
        findMainChatJid: () => 'telegram:main',
      });
      assert.equal(sends.length, 0);
    } finally {
      closeDatabase();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('computeLearningPauseAgeDays returns null for unset/invalid timestamps', () => {
    assert.equal(computeLearningPauseAgeDays(null), null);
    assert.equal(computeLearningPauseAgeDays('not-a-date'), null);
    const now = new Date('2026-07-07T00:00:00Z');
    assert.equal(
      computeLearningPauseAgeDays('2026-07-01T00:00:00Z', now),
      6,
    );
  });
});

// ---------------------------------------------------------------------------
// Witness #2 — heartbeat context builder
// ---------------------------------------------------------------------------

test.describe('SPEC-02 witness #2: heartbeat pause context', () => {
  test('paused 4 days with default 3-day threshold: context line present, alert set', () => {
    const now = new Date('2026-07-07T00:00:00Z');
    const ctx = buildLearningPauseHeartbeatContext({
      learningPaused: true,
      learningPausedAt: '2026-07-03T00:00:00Z', // 4 days ago
      alertThresholdDays: 3,
      now,
    });
    assert.match(ctx.contextLine || '', /LEARNING: PAUSED/);
    assert.equal(ctx.ageDays, 4);
    assert.equal(ctx.alert, true);
  });

  test('paused 1 day with default 3-day threshold: context line present, no alert', () => {
    const now = new Date('2026-07-07T00:00:00Z');
    const ctx = buildLearningPauseHeartbeatContext({
      learningPaused: true,
      learningPausedAt: '2026-07-06T00:00:00Z', // 1 day ago
      alertThresholdDays: 3,
      now,
    });
    assert.match(ctx.contextLine || '', /LEARNING: PAUSED/);
    assert.equal(ctx.ageDays, 1);
    assert.equal(ctx.alert, false);
  });

  test('alertThresholdDays=0 disables escalation regardless of age', () => {
    const now = new Date('2026-07-07T00:00:00Z');
    const ctx = buildLearningPauseHeartbeatContext({
      learningPaused: true,
      learningPausedAt: '2026-06-01T00:00:00Z', // well past any threshold
      alertThresholdDays: 0,
      now,
    });
    assert.match(ctx.contextLine || '', /LEARNING: PAUSED/);
    assert.equal(ctx.alert, false);
  });

  test('learningPaused=false: no context line, no alert', () => {
    const ctx = buildLearningPauseHeartbeatContext({
      learningPaused: false,
      learningPausedAt: '2026-06-01T00:00:00Z',
      alertThresholdDays: 3,
    });
    assert.equal(ctx.contextLine, null);
    assert.equal(ctx.alert, false);
    assert.equal(ctx.ageDays, null);
  });
});

// ---------------------------------------------------------------------------
// Witness #3 — self-improve drop counter
// ---------------------------------------------------------------------------

test.describe('SPEC-02 witness #3: consecutive learning-paused drop counter', () => {
  function makeGroup(suffix: string): string {
    return `pause-witness-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  async function feedPausedNoops(
    groupFolder: string,
    count: number,
  ): Promise<void> {
    for (let i = 0; i < count; i++) {
      await recordSelfImproveEvent(groupFolder, {
        run_id: `run-${i}`,
        authorityId: `auth-${i}`,
        sender_role: 'member',
        review_type: 'skill-self-improve',
        trigger_reason: 'learning-paused',
        signals_detected: ['remember'],
        review_fired: false,
        noop_reason: 'learning-paused',
        success: true,
      });
    }
  }

  test('9 consecutive paused noops produce zero notice rows', async () => {
    await withTempDb(async () => {
      const groupFolder = makeGroup('nine');
      const groupDir = resolveGroupFolderPath(groupFolder);
      resetConsecutivePausedNoops(groupFolder);
      const outbox = createOutboxDeliverer({
        sendMessage: async () => true,
      });
      initSelfImproveWitness({ outbox, findMainChatJid: () => 'telegram:main' });
      try {
        await feedPausedNoops(groupFolder, 9);
        assert.equal(
          getDeliveryByDedupeKey(`learning-paused-drops:${groupFolder}:10`),
          undefined,
        );
      } finally {
        initSelfImproveWitness(null);
        resetConsecutivePausedNoops(groupFolder);
        fs.rmSync(groupDir, { recursive: true, force: true });
      }
    });
  });

  test('10 consecutive paused noops produce exactly one notice row with the drop count', async () => {
    await withTempDb(async () => {
      const groupFolder = makeGroup('ten');
      const groupDir = resolveGroupFolderPath(groupFolder);
      resetConsecutivePausedNoops(groupFolder);
      const outbox = createOutboxDeliverer({
        sendMessage: async () => true,
      });
      initSelfImproveWitness({ outbox, findMainChatJid: () => 'telegram:main' });
      try {
        await feedPausedNoops(groupFolder, 10);
        const row = getDeliveryByDedupeKey(
          `learning-paused-drops:${groupFolder}:10`,
        );
        assert.ok(row, 'expected a notice row at count 10');
        assert.equal(row?.status, 'delivered');
        assert.match(row?.body || '', /10 learning signals dropped/);
        assert.match(row?.body || '', /remember/);
      } finally {
        initSelfImproveWitness(null);
        resetConsecutivePausedNoops(groupFolder);
        fs.rmSync(groupDir, { recursive: true, force: true });
      }
    });
  });

  test('20 consecutive paused noops produce exactly two notice rows (at 10 and 20)', async () => {
    await withTempDb(async () => {
      const groupFolder = makeGroup('twenty');
      const groupDir = resolveGroupFolderPath(groupFolder);
      resetConsecutivePausedNoops(groupFolder);
      const outbox = createOutboxDeliverer({
        sendMessage: async () => true,
      });
      initSelfImproveWitness({ outbox, findMainChatJid: () => 'telegram:main' });
      try {
        await feedPausedNoops(groupFolder, 20);
        assert.ok(
          getDeliveryByDedupeKey(`learning-paused-drops:${groupFolder}:10`),
        );
        assert.ok(
          getDeliveryByDedupeKey(`learning-paused-drops:${groupFolder}:20`),
        );
        assert.equal(
          getDeliveryByDedupeKey(`learning-paused-drops:${groupFolder}:15`),
          undefined,
        );
      } finally {
        initSelfImproveWitness(null);
        resetConsecutivePausedNoops(groupFolder);
        fs.rmSync(groupDir, { recursive: true, force: true });
      }
    });
  });

  test('a non-paused event resets the consecutive counter', async () => {
    await withTempDb(async () => {
      const groupFolder = makeGroup('reset');
      const groupDir = resolveGroupFolderPath(groupFolder);
      resetConsecutivePausedNoops(groupFolder);
      const outbox = createOutboxDeliverer({
        sendMessage: async () => true,
      });
      initSelfImproveWitness({ outbox, findMainChatJid: () => 'telegram:main' });
      try {
        await feedPausedNoops(groupFolder, 9);
        await recordSelfImproveEvent(groupFolder, {
          run_id: 'run-reset',
          authorityId: 'auth-reset',
          sender_role: 'operator',
          review_type: 'skill-self-improve',
          trigger_reason: 'signal:remember',
          signals_detected: ['remember'],
          review_fired: true,
          success: true,
        });
        await feedPausedNoops(groupFolder, 9);
        assert.equal(
          getDeliveryByDedupeKey(`learning-paused-drops:${groupFolder}:10`),
          undefined,
          'counter should have reset, so 9+9 paused noops must not reach 10',
        );
      } finally {
        initSelfImproveWitness(null);
        resetConsecutivePausedNoops(groupFolder);
        fs.rmSync(groupDir, { recursive: true, force: true });
      }
    });
  });

  test('no witnessDeps configured (initSelfImproveWitness(null)) is a silent no-op, not a throw', async () => {
    const groupFolder = makeGroup('nodeps');
    const groupDir = resolveGroupFolderPath(groupFolder);
    resetConsecutivePausedNoops(groupFolder);
    initSelfImproveWitness(null);
    try {
      await assert.doesNotReject(() => feedPausedNoops(groupFolder, 10));
    } finally {
      resetConsecutivePausedNoops(groupFolder);
      fs.rmSync(groupDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-witness: learningPaused=false produces no output from any witness
// ---------------------------------------------------------------------------

test('SPEC-02 acceptance: learningPaused=false yields zero output across all three witnesses', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-pause-off-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  const groupFolder = `pause-witness-off-${Date.now()}`;
  const groupDir = resolveGroupFolderPath(groupFolder);
  try {
    initDatabaseAtPath(dbPath);
    const sends: Array<{ dest: string; body: string }> = [];
    const outbox = createOutboxDeliverer({
      sendMessage: async (dest, body) => {
        sends.push({ dest, body });
        return true;
      },
    });

    // Witness #1: boot
    await runLearningPauseBootWitness({
      state: { learningPaused: false, learningPausedAt: null },
      outbox,
      findMainChatJid: () => 'telegram:main',
    });

    // Witness #2: heartbeat context
    const ctx = buildLearningPauseHeartbeatContext({
      learningPaused: false,
      learningPausedAt: null,
      alertThresholdDays: 3,
    });
    assert.equal(ctx.contextLine, null);
    assert.equal(ctx.alert, false);

    // Witness #3: drop counter (no noop_reason='learning-paused' events fire
    // when learning is active, so recordSelfImproveEvent never increments).
    resetConsecutivePausedNoops(groupFolder);
    initSelfImproveWitness({ outbox, findMainChatJid: () => 'telegram:main' });
    for (let i = 0; i < 15; i++) {
      await recordSelfImproveEvent(groupFolder, {
        run_id: `run-${i}`,
        authorityId: `auth-${i}`,
        sender_role: 'operator',
        review_type: 'skill-self-improve',
        trigger_reason: 'signal:remember',
        signals_detected: ['remember'],
        review_fired: true,
        success: true,
      });
    }

    assert.equal(sends.length, 0, 'no witness should have sent anything');
  } finally {
    initSelfImproveWitness(null);
    resetConsecutivePausedNoops(groupFolder);
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(groupDir, { recursive: true, force: true });
  }
});
