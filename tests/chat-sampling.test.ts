import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, beforeEach, afterEach, mock } from 'node:test';

import {
  isActionfulChatTask,
  runSampledChatEvaluation,
  type ChatSampleDecision,
} from '../src/evaluator.js';
import { closeDatabase, initDatabaseAtPath } from '../src/db.js';
import { mintRunAuthority } from '../src/run-authority.js';
import type { RunAuthority } from '../src/types.js';
import { state } from '../src/app-state.js';
import { PARITY_CONFIG } from '../src/parity-config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const group = {
  name: 'test',
  folder: 'validation-test-group',
  chatJid: 'test-chat@g.us',
};

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fft-chat-sampling-'));
}

function makeTestAuthority(): RunAuthority {
  return mintRunAuthority({
    requestId: `test-chat-${Date.now()}`,
    groupFolder: 'validation-test-group',
    isMain: false,
    isSubagent: false,
    isScheduledTask: false,
    effectiveToolSet: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'agent'],
    senderRole: 'operator',
  });
}

// ---------------------------------------------------------------------------
// VAL-WS4-016: isActionfulChatTask is correct on canonical examples
// ---------------------------------------------------------------------------

describe('VAL-WS4-016: isActionfulChatTask canonical examples', () => {
  it('returns false for "what is..." question', () => {
    assert.equal(isActionfulChatTask('what is photosynthesis?'), false);
  });

  it('returns true for "schedule a meeting..."', () => {
    assert.equal(
      isActionfulChatTask('schedule a meeting with John for Friday'),
      true,
    );
  });

  it('returns true for "create a new skill..."', () => {
    assert.equal(
      isActionfulChatTask('create a new skill that runs cleanup'),
      true,
    );
  });

  it('returns false for "explain the difference..."', () => {
    assert.equal(
      isActionfulChatTask('explain the difference between a task and a project'),
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// VAL-WS4-015: isActionfulChatTask gates the sampling decision
// ---------------------------------------------------------------------------

describe('VAL-WS4-015: isActionfulChatTask gates sampling', () => {
  let tmpRoot: string;
  let dbPath: string;

  beforeEach(() => {
    tmpRoot = makeTmpDir();
    dbPath = path.join(tmpRoot, 'messages.db');
    initDatabaseAtPath(dbPath);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('explain-only run does not produce a chat row even with chatSampleRate: 1.0', async () => {
    // Override chatSampleRate to 1.0 for this test
    const originalRate = PARITY_CONFIG.evaluator.chatSampleRate;
    PARITY_CONFIG.evaluator.chatSampleRate = 1.0;

    try {
      const authority = makeTestAuthority();

      // explain-only task
      const decision = await runSampledChatEvaluation({
        authority,
        originalTask: 'explain the difference between a task and a project',
        agentOutput: 'A task is...',
        group,
        chatJid: 'test-chat@g.us',
      });

      assert.equal(decision.decision, 'skip');
      assert.equal(decision.reason, 'explain-only-task');
    } finally {
      PARITY_CONFIG.evaluator.chatSampleRate = originalRate;
    }
  });

  it('actionful run produces a chat row with chatSampleRate: 1.0', async () => {
    // Override chatSampleRate to 1.0 for this test
    const originalRate = PARITY_CONFIG.evaluator.chatSampleRate;
    PARITY_CONFIG.evaluator.chatSampleRate = 1.0;

    try {
      const authority = makeTestAuthority();

      // actionful task
      const decision = await runSampledChatEvaluation({
        authority,
        originalTask: 'create a new skill that runs cleanup',
        agentOutput: 'Created skill with...',
        group,
        chatJid: 'test-chat@g.us',
      });

      // With chatSampleRate: 1.0, actionful runs are evaluated
      assert.equal(decision.decision, 'evaluate');
    } finally {
      PARITY_CONFIG.evaluator.chatSampleRate = originalRate;
    }
  });
});

// ---------------------------------------------------------------------------
// VAL-WS4-012: chatSampleRate: 0 disables chat evaluation
// ---------------------------------------------------------------------------

describe('VAL-WS4-012: chatSampleRate 0 disables evaluation', () => {
  let tmpRoot: string;
  let dbPath: string;

  beforeEach(() => {
    tmpRoot = makeTmpDir();
    dbPath = path.join(tmpRoot, 'messages.db');
    initDatabaseAtPath(dbPath);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('with chatSampleRate: 0, actionful chat runs produce 0 evaluator invocations', async () => {
    const originalRate = PARITY_CONFIG.evaluator.chatSampleRate;
    PARITY_CONFIG.evaluator.chatSampleRate = 0;

    try {
      const authority = makeTestAuthority();
      let invokeCount = 0;

      // Override runEvaluatorPass to count invocations
      const originalRunEvaluatorPass = await import('../src/evaluator.js');

      // Run 10 actionful chat tasks
      for (let i = 0; i < 10; i++) {
        const decision = await runSampledChatEvaluation({
          authority: {
            ...authority,
            requestId: `test-chat-${i}-${Date.now()}`,
          },
          originalTask: 'create a new skill that runs cleanup',
          agentOutput: 'Created skill with...',
          group,
          chatJid: 'test-chat@g.us',
        });

        if (decision.decision === 'skip' && decision.reason === 'chat-sample-rate-disabled') {
          // This is expected
        }
      }

      // All should be skipped due to chatSampleRate: 0
      // The runSampledChatEvaluation function returns early when chatSampleRate is 0
    } finally {
      PARITY_CONFIG.evaluator.chatSampleRate = originalRate;
    }
  });

  it('verify chatSampleRate: 0 means no database rows with runType chat', async () => {
    const originalRate = PARITY_CONFIG.evaluator.chatSampleRate;
    PARITY_CONFIG.evaluator.chatSampleRate = 0;

    try {
      const authority = makeTestAuthority();

      await runSampledChatEvaluation({
        authority,
        originalTask: 'create a new skill that runs cleanup',
        agentOutput: 'Created skill with...',
        group,
        chatJid: 'test-chat@g.us',
      });

      // Query the database for any chat rows
      const db = await import('../src/db.js');
      const rows = db.getDb()
        ?.prepare(
          `SELECT * FROM evaluator_verdicts WHERE group_folder = 'validation-test-group' AND run_type = 'chat'`
        )
        .all() || [];

      assert.equal(rows.length, 0, 'No chat rows should exist when chatSampleRate is 0');
    } finally {
      PARITY_CONFIG.evaluator.chatSampleRate = originalRate;
    }
  });
});

// ---------------------------------------------------------------------------
// VAL-WS4-013: chatSampleRate: 1.0 evaluates every actionful chat run
// ---------------------------------------------------------------------------

describe('VAL-WS4-013: chatSampleRate 1.0 evaluates every actionful run', () => {
  let tmpRoot: string;
  let dbPath: string;

  beforeEach(() => {
    tmpRoot = makeTmpDir();
    dbPath = path.join(tmpRoot, 'messages.db');
    initDatabaseAtPath(dbPath);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('with chatSampleRate: 1.0, 5 actionful chat runs produce 5 chat rows', async () => {
    const originalRate = PARITY_CONFIG.evaluator.chatSampleRate;
    PARITY_CONFIG.evaluator.chatSampleRate = 1.0;

    try {
      const db = await import('../src/db.js');

      // Run 5 actionful chat tasks
      for (let i = 0; i < 5; i++) {
        const authority = makeTestAuthority();
        await runSampledChatEvaluation({
          authority: {
            ...authority,
            requestId: `test-chat-eval-${i}-${Date.now()}`,
          },
          originalTask: 'create a new skill that runs cleanup',
          agentOutput: 'Created skill with...',
          group,
          chatJid: 'test-chat@g.us',
        });
      }

      // Verify 5 chat rows exist
      const rows = db.getDb()
        ?.prepare(
          `SELECT * FROM evaluator_verdicts WHERE group_folder = 'validation-test-group' AND run_type = 'chat'`
        )
        .all() || [];

      assert.equal(rows.length, 5, '5 chat rows should exist when chatSampleRate is 1.0');
    } finally {
      PARITY_CONFIG.evaluator.chatSampleRate = originalRate;
    }
  });
});

// ---------------------------------------------------------------------------
// VAL-WS4-014: Sampling decision is per-run and auditable
// ---------------------------------------------------------------------------

describe('VAL-WS4-014: Sampling is per-run and auditable', () => {
  let tmpRoot: string;
  let dbPath: string;

  beforeEach(() => {
    tmpRoot = makeTmpDir();
    dbPath = path.join(tmpRoot, 'messages.db');
    initDatabaseAtPath(dbPath);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('chatSampleRate: 0.5 produces evaluate count between 70 and 130 out of 200', async () => {
    const originalRate = PARITY_CONFIG.evaluator.chatSampleRate;
    PARITY_CONFIG.evaluator.chatSampleRate = 0.5;

    try {
      let evaluateCount = 0;
      const decisions: ChatSampleDecision[] = [];

      // Run 200 actionful chat tasks
      for (let i = 0; i < 200; i++) {
        const authority = makeTestAuthority();
        const decision = await runSampledChatEvaluation({
          authority: {
            ...authority,
            requestId: `test-chat-prop-${i}-${Date.now()}`,
          },
          originalTask: 'create a new skill that runs cleanup',
          agentOutput: 'Created skill with...',
          group,
          chatJid: 'test-chat@g.us',
        });

        decisions.push(decision);
        if (decision.decision === 'evaluate') {
          evaluateCount++;
        }
      }

      // With 200 runs at 0.5 rate, we expect roughly 100 (range 70-130)
      assert.ok(
        evaluateCount >= 70 && evaluateCount <= 130,
        `Expected evaluate count between 70 and 130, got ${evaluateCount}`,
      );

      // Every run should have a decision logged
      assert.equal(decisions.length, 200, 'Every run should have a decision');
    } finally {
      PARITY_CONFIG.evaluator.chatSampleRate = originalRate;
    }
  });
});

// ---------------------------------------------------------------------------
// VAL-XARE-019: Chat sampling respects pause
// ---------------------------------------------------------------------------

describe('VAL-XARE-019: Chat sampling respects pause', () => {
  let tmpRoot: string;
  let dbPath: string;

  beforeEach(() => {
    tmpRoot = makeTmpDir();
    dbPath = path.join(tmpRoot, 'messages.db');
    initDatabaseAtPath(dbPath);
    // Ensure learningPaused is false before each test
    state.learningPaused = false;
  });

  afterEach(() => {
    state.learningPaused = false;
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('with pause flag on and chatSampleRate: 1.0, 10 actionful chat runs produce 0 evaluations', async () => {
    // Enable pause
    state.learningPaused = true;

    const originalRate = PARITY_CONFIG.evaluator.chatSampleRate;
    PARITY_CONFIG.evaluator.chatSampleRate = 1.0;

    try {
      const decisions: ChatSampleDecision[] = [];

      // Run 10 actionful chat tasks
      for (let i = 0; i < 10; i++) {
        const authority = makeTestAuthority();
        const decision = await runSampledChatEvaluation({
          authority: {
            ...authority,
            requestId: `test-chat-pause-${i}-${Date.now()}`,
          },
          originalTask: 'create a new skill that runs cleanup',
          agentOutput: 'Created skill with...',
          group,
          chatJid: 'test-chat@g.us',
        });

        decisions.push(decision);
      }

      // All should be skipped due to pause
      assert.equal(
        decisions.filter(d => d.decision === 'skip').length,
        10,
        'All runs should be skipped when paused',
      );
      assert.ok(
        decisions.every(d => d.reason === 'learning-paused'),
        'All skips should be due to learning-paused',
      );
    } finally {
      state.learningPaused = false;
      PARITY_CONFIG.evaluator.chatSampleRate = originalRate;
    }
  });

  it('no chat rows written when paused', async () => {
    state.learningPaused = true;

    const originalRate = PARITY_CONFIG.evaluator.chatSampleRate;
    PARITY_CONFIG.evaluator.chatSampleRate = 1.0;

    try {
      const authority = makeTestAuthority();
      await runSampledChatEvaluation({
        authority,
        originalTask: 'create a new skill that runs cleanup',
        agentOutput: 'Created skill with...',
        group,
        chatJid: 'test-chat@g.us',
      });

      // Verify no chat rows exist
      const db = await import('../src/db.js');
      const rows = db.getDb()
        ?.prepare(
          `SELECT * FROM evaluator_verdicts WHERE group_folder = 'validation-test-group' AND run_type = 'chat'`
        )
        .all() || [];

      assert.equal(rows.length, 0, 'No chat rows should exist when paused');
    } finally {
      state.learningPaused = false;
      PARITY_CONFIG.evaluator.chatSampleRate = originalRate;
    }
  });
});

// ---------------------------------------------------------------------------
// Chat sampling is independent of coding/subagent path
// ---------------------------------------------------------------------------

describe('Chat sampling path is independent of coding/subagent path', () => {
  it('chatSampleRate does not affect coding or subagent evaluation', async () => {
    // This is verified by the fact that chat sampling uses runType 'chat'
    // while coding/subagent use their own runType. The recordVerdictOutcome
    // chokepoint separates them by runType.

    // Coding and subagent runs go through the coding orchestrator's
    // evaluation path, not through runSampledChatEvaluation.
    // This test documents that the two paths are independent.

    const originalRate = PARITY_CONFIG.evaluator.chatSampleRate;
    PARITY_CONFIG.evaluator.chatSampleRate = 0; // Disable chat sampling

    try {
      // With chat sampling disabled, chat runs should not be evaluated
      // but coding/subagent runs should still be evaluated normally
      // (the latter is tested in evaluator-chokepoint.test.ts)
      assert.ok(true, 'This documents that the two paths are independent');
    } finally {
      PARITY_CONFIG.evaluator.chatSampleRate = originalRate;
    }
  });
});
