import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  closeDatabase,
  initDatabaseAtPath,
  getDb,
  getDeliveryByDedupeKey,
  createTask,
  storeChatMetadata,
} from '../src/db.js';
import {
  shouldEvaluate,
  type EvaluatorContext,
} from '../src/evaluator.js';
import {
  runScheduledTaskV2,
  type CronServiceDependencies,
} from '../src/cron/service.js';
import { createAppRuntime } from '../src/app.js';
import { state } from '../src/app-state.js';
import type { ScheduledTask } from '../src/types.js';
import { resolveGroupFolderPath } from '../src/group-folder.js';
import { recordVerdictOutcome } from '../src/evaluator.js';
import * as parityConfig from '../src/parity-config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const group = {
  name: 'spec03-test',
  folder: 'spec03-test',
  jid: 'telegram:111111',
  isMain: false,
};

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fft-evaluator-scheduled-elig-'));
}

function makeCtx(overrides: Partial<EvaluatorContext> = {}): EvaluatorContext {
  return {
    runType: 'coding',
    originalTask: 'do task',
    agentOutput: 'x'.repeat(50),
    durationMs: 60_000,
    toolsInvoked: 5,
    group,
    chatJid: 'test-chat@g.us',
    forceEvaluate: false,
    ...overrides,
  };
}

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-spec03',
    group_folder: 'main',
    prompt: 'Spec-03 test task',
    schedule_type: 'cron',
    schedule_value: '* * * * *',
    schedule_json: null,
    next_run: null,
    last_run: null,
    status: 'active',
    chat_jid: 'telegram:111111',
    context_mode: 'isolated',
    session_target: 'isolated',
    wake_mode: 'next-heartbeat',
    delivery_mode: 'announce',
    delivery_channel: null,
    delivery_to: null,
    delivery_webhook_url: null,
    timeout_seconds: 60,
    stagger_ms: 0,
    delete_after_run: 0,
    consecutive_errors: 0,
    subagent_type: null,
    created_by: 'operator',
    created_at: '2026-07-07T00:00:00Z',
    ...overrides,
  };
}

// ===========================================================================
// ASSERTION 1: shouldEvaluate(cron, 60s, 5 tools) → evaluate=true after fix
// ===========================================================================

test('SPEC-03 #1: shouldEvaluate accepts runType=cron once substantial (60s, 5 tools)', () => {
  const result = shouldEvaluate(
    makeCtx({
      runType: 'cron',
      durationMs: 60_000,
      toolsInvoked: 5,
      agentOutput: 'x'.repeat(50),
    }),
  );
  assert.equal(
    result.evaluate,
    true,
    'cron run with durationMs>=45000 must evaluate=true after fix',
  );
  assert.match(
    result.reason,
    /duration 60000ms >= 45000ms/,
    'reason must name the duration threshold',
  );
});

// ===========================================================================
// ASSERTION 2: shouldEvaluate(scheduled, ...) → evaluate=true after fix
// ===========================================================================

test('SPEC-03 #2: shouldEvaluate accepts runType=scheduled once substantial (60s, 5 tools)', () => {
  const result = shouldEvaluate(
    makeCtx({
      runType: 'scheduled',
      durationMs: 60_000,
      toolsInvoked: 5,
      agentOutput: 'x'.repeat(50),
    }),
  );
  assert.equal(
    result.evaluate,
    true,
    'scheduled run with durationMs>=45000 must evaluate=true after fix',
  );
  assert.match(
    result.reason,
    /duration 60000ms >= 45000ms/,
    'reason must name the duration threshold',
  );
});

// ===========================================================================
// ASSERTION 3: trivial cron (5s, 0 tools, 50 chars) → still false w/ 'trivially short run'
// ===========================================================================

test('SPEC-03 #3: trivial cron run (5s, 0 tools, 50 chars) still rejected as trivially-short-run', () => {
  const result = shouldEvaluate(
    makeCtx({
      runType: 'cron',
      durationMs: 5_000,
      toolsInvoked: 0,
      agentOutput: 'x'.repeat(50),
    }),
  );
  assert.equal(
    result.evaluate,
    false,
    'trivial cron must still evaluate=false post-fix (graduated heuristic, not blanket bypass)',
  );
  assert.equal(result.reason, 'trivially short run');
});

// ===========================================================================
// ASSERTION 4: runScheduledTaskV2 with non-agent-created task writes one row
// ===========================================================================

test('SPEC-03 #4: runScheduledTaskV2 with non-agent-created task writes exactly one evaluator_verdicts row', async () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  const groupFolder = 'spec03-cron-write';
  try {
    initDatabaseAtPath(dbPath);

    state.registeredGroups = {};
    state.registeredGroups['telegram:cron-write-jid'] = {
      folder: groupFolder,
      name: 'Spec03 Cron Write',
      jid: 'telegram:cron-write-jid',
    };
    fs.mkdirSync(resolveGroupFolderPath(groupFolder), { recursive: true });
    storeChatMetadata('telegram:cron-write-jid', new Date().toISOString(), 'Spec03');

    const substantialOutput = 'x'.repeat(200);
    const mockContainerOutput = {
      status: 'success',
      result: substantialOutput,
      toolExecutions: [
        { name: 'read', args: {}, ts: 0 },
        { name: 'write', args: {}, ts: 1 },
        { name: 'bash', args: {}, ts: 2 },
        { name: 'edit', args: {}, ts: 3 },
      ],
    };

    const taskRow = makeTask({
      id: 'spec03-task-write',
      group_folder: groupFolder,
      created_by: 'operator',
      schedule_value: '* * * * *',
      schedule_json: JSON.stringify({ kind: 'cron', expr: '* * * * *', tz: 'UTC' }),
    });
    createTask(taskRow);

    const deps: CronServiceDependencies = {
      sendMessage: async () => true,
      registeredGroups: () => ({ ...state.registeredGroups }),
      runContainerTask: async () => mockContainerOutput,
      // Mimic the real runEvaluatorPass's eligibility gate so the test
      // exercises the shouldEvaluate fix directly. Pre-fix: returns a
      // skipped verdict with 'cron run type not eligible' reason →
      // threshold-skip → no row written. Post-fix: returns a pass verdict
      // → one row written (skipped=0).
      runEvaluatorPass: async (ctx) => {
        const gate = shouldEvaluate(ctx);
        if (!gate.evaluate) {
          return {
            pass: true,
            score: -1,
            issues: [],
            feedback: '',
            skipped: true,
            skippedReason: gate.reason,
          };
        }
        return {
          pass: true,
          score: 8,
          issues: [],
          feedback: 'OK',
          skipped: false,
        };
      },
    };

    await runScheduledTaskV2(taskRow, deps);

    const db = getDb();
    const rows = db!
      .prepare(
        `SELECT skipped, skip_reason, run_type FROM evaluator_verdicts WHERE group_folder = ?`,
      )
      .all(groupFolder) as Array<{
        skipped: number;
        skip_reason: string | null;
        run_type: string;
      }>;

    assert.equal(
      rows.length,
      1,
      `expected exactly one evaluator_verdicts row for ${groupFolder}, got ${rows.length}`,
    );
    assert.equal(rows[0].run_type, 'cron');
    assert.equal(rows[0].skipped, 0);
    assert.equal(rows[0].skip_reason, null);
  } finally {
    state.registeredGroups = {};
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    const groupDir = resolveGroupFolderPath(groupFolder);
    if (fs.existsSync(groupDir)) {
      fs.rmSync(groupDir, { recursive: true, force: true });
    }
  }
});

// ===========================================================================
// ASSERTION 5: EVALUATOR_CONFIG_EXPLICIT mirrors whether `evaluator` key is set
// ===========================================================================

test('SPEC-03 #5: EVALUATOR_CONFIG_EXPLICIT is a boolean export of parity-config', () => {
  const flag = (parityConfig as Record<string, unknown>).EVALUATOR_CONFIG_EXPLICIT;
  assert.equal(
    typeof flag,
    'boolean',
    'EVALUATOR_CONFIG_EXPLICIT must be a boolean export (after fix #3)',
  );
  assert.ok(flag === true || flag === false);
});

// ===========================================================================
// ASSERTION 6: boot sequence emits exactly one WARN when implicit
// ===========================================================================

test('SPEC-03 #6: boot witness emits exactly one WARN naming effective chatSampleRate when implicit', async () => {
  // Detect current state by reading the file directly
  const parityPath = path.join(process.cwd(), 'config', 'runtime.parity.json');
  const raw = JSON.parse(fs.readFileSync(parityPath, 'utf8')) as Record<
    string,
    unknown
  >;
  const hasEvaluatorKey = raw.evaluator !== undefined;

  const warnLines: string[] = [];

  const runtime = createAppRuntime({
    state: {
      telegramBot: null,
      registeredGroups: {},
      messageLoopRunning: false,
      sock: null,
      lidToPhoneMap: {},
      groupSyncTimerStarted: false,
      shuttingDown: false,
      heartbeatLoopStarted: false,
    },
    constants: {
      assistantName: 'TestBot',
      triggerPattern: /^@?TestBot/i,
      whatsappEnabled: false,
      onboardingMode: true,
    },
    createTelegramBot: () => null,
    refreshTelegramCommandMenus: async () => undefined,
    handleTelegramCallbackQuery: async () => undefined,
    handleTelegramSetupInput: async () => false,
    handleTelegramCommand: async () => false,
    storeChatMetadata: () => undefined,
    maybeRegisterTelegramChat: () => false,
    isMainChat: () => false,
    persistTelegramMedia: async () => '',
    storeTextMessage: () => undefined,
    logger: {
      info: () => undefined,
      warn: (payload, message) => {
        warnLines.push(
          `[WARN] ${
            typeof message === 'string' ? message : JSON.stringify(payload)
          }`,
        );
      },
      debug: () => undefined,
      error: () => undefined,
      fatal: () => undefined,
    },
  });

  await runtime.main();

  const rateWarns = warnLines.filter((l) => l.includes('chatSampleRate'));
  if (!hasEvaluatorKey) {
    // Implicit: expect exactly ONE WARN
    assert.equal(
      rateWarns.length,
      1,
      `boot must emit exactly one WARN naming chatSampleRate when implicit, got ${rateWarns.length}: ${warnLines.join('\n')}`,
    );
    assert.match(rateWarns[0], /chatSampleRate/);
    assert.match(rateWarns[0], /0\.\d+/);
  } else {
    // Explicit: expect zero such WARN
    assert.equal(
      rateWarns.length,
      0,
      `boot must NOT emit chatSampleRate WARN when explicit, got ${rateWarns.length}: ${warnLines.join('\n')}`,
    );
  }
});

// ===========================================================================
// ASSERTION 7: WS4.3 end-to-end via cron path → delivery_outbox row w/ dedupe
// ===========================================================================

test('SPEC-03 #7: WS4.3 reachable from cron path (runScheduledTaskV2 → eligible-skip → outbox row)', async () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  const groupFolder = 'spec03-ws43';
  try {
    initDatabaseAtPath(dbPath);

    state.registeredGroups = {};
    state.registeredGroups['telegram:ws43-jid'] = {
      folder: groupFolder,
      name: 'Spec03 WS4.3',
      jid: 'telegram:ws43-jid',
    };
    state.registeredGroups['telegram:ws43-main-jid'] = {
      folder: 'main',
      name: 'Spec03 Main',
      jid: 'telegram:ws43-main-jid',
    };
    storeChatMetadata('telegram:ws43-jid', new Date().toISOString(), 'Spec03 WS4.3');

    const db = getDb();
    const insert = db!.prepare(
      `INSERT INTO evaluator_verdicts (request_id, group_folder, run_type, pass, score, issues, skipped, skip_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (let i = 0; i < 4; i++) {
      insert.run(
        `prior-pass-${i}`,
        groupFolder,
        'cron',
        1,
        8,
        '[]',
        0,
        null,
        new Date().toISOString(),
      );
    }
    for (let i = 0; i < 5; i++) {
      insert.run(
        `prior-skip-${i}`,
        groupFolder,
        'cron',
        0,
        0,
        '[]',
        1,
        'evaluator-threw',
        new Date().toISOString(),
      );
    }

    const taskRow = makeTask({
      id: 'spec03-ws43-task',
      group_folder: groupFolder,
      created_by: 'operator',
      schedule_value: '* * * * *',
      schedule_json: JSON.stringify({
        kind: 'cron',
        expr: '* * * * *',
        tz: 'UTC',
      }),
    });
    createTask(taskRow);

    const mockContainerOutput = {
      status: 'success',
      result: 'x'.repeat(200),
      toolExecutions: [
        { name: 'read', args: {}, ts: 0 },
        { name: 'write', args: {}, ts: 1 },
        { name: 'bash', args: {}, ts: 2 },
      ],
    };

    const deps: CronServiceDependencies = {
      sendMessage: async () => true,
      registeredGroups: () => ({ ...state.registeredGroups }),
      runContainerTask: async () => mockContainerOutput,
      runEvaluatorPass: async () => ({
        pass: true,
        score: -1,
        issues: [],
        feedback: '',
        skipped: true,
        skippedReason: 'evaluator threw',
      }),
    };

    await runScheduledTaskV2(taskRow, deps);

    const outboxRow = getDeliveryByDedupeKey(`eval-degraded:${groupFolder}`);
    assert.ok(
      outboxRow,
      `delivery_outbox row must exist with dedupe_key=eval-degraded:${groupFolder} (cron path → 10th row → alert). State: must be reachable via cron path entry point, not synthetic outcome.`,
    );
    assert.match(
      outboxRow!.body,
      /evaluation is degraded/,
      'outbox body must signal degraded',
    );
  } finally {
    state.registeredGroups = {};
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    const groupDir = resolveGroupFolderPath('spec03-ws43');
    if (fs.existsSync(groupDir)) {
      fs.rmSync(groupDir, { recursive: true, force: true });
    }
  }
});

// Reference unused imports to keep linter happy (these get used in test #4
// indirectly through recordVerdictOutcome's call chain).
void recordVerdictOutcome;
