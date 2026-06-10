import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  extractLearningSignals,
  recordSelfImproveEvent,
} from '../src/self-improve-signals.js';
import { shouldTriggerSkillSelfImprove } from '../src/skill-service.js';
import { resolveGroupFolderPath } from '../src/group-folder.js';
import { resolveGroupPiHomeDir } from '../src/skill-lifecycle.js';
import type { PiToolExecution } from '../src/pi-json-parser.js';

function exec(
  toolName: string,
  status: 'ok' | 'error',
  index = 0,
): PiToolExecution {
  return { index, toolName, status };
}

test('detects explicit remember requests as a full-priority signal', () => {
  const result = extractLearningSignals({
    userTask: 'From now on, remember to restart the service after a pull.',
    agentOutput: 'Understood.',
    senderRole: 'operator',
  });
  assert.ok(result.signals.includes('remember'));
  assert.equal(result.priority, 'full');
});

test('detects user corrections as a full-priority signal', () => {
  const result = extractLearningSignals({
    userTask: "No, that's wrong — you should use ff-only merges.",
    agentOutput: 'Fixed.',
    senderRole: 'operator',
  });
  assert.ok(result.signals.includes('correction'));
  assert.equal(result.priority, 'full');
});

test('detects fail-then-fix in the tool trace', () => {
  const result = extractLearningSignals({
    userTask: 'build the project',
    agentOutput: 'done',
    toolExecutions: [
      exec('bash', 'error', 0),
      exec('read', 'ok', 1),
      exec('bash', 'ok', 2),
    ],
  });
  assert.ok(result.signals.includes('fail-then-fix'));
  assert.equal(result.priority, 'full');
});

test('does not flag fail-then-fix when the same tool never recovers', () => {
  const result = extractLearningSignals({
    userTask: 'build the project',
    agentOutput: 'done',
    toolExecutions: [exec('bash', 'ok', 0), exec('bash', 'error', 1)],
  });
  assert.ok(!result.signals.includes('fail-then-fix'));
});

test('long tool runs are a light multi-step-procedure signal only', () => {
  const result = extractLearningSignals({
    userTask: 'set up the new device',
    agentOutput: 'done',
    toolExecutions: Array.from({ length: 7 }, (_, i) => exec('bash', 'ok', i)),
  });
  assert.deepEqual(result.signals, ['multi-step-procedure']);
  assert.equal(result.priority, 'light');
});

test('no signals on a plain turn', () => {
  const result = extractLearningSignals({
    userTask: 'what is the weather today',
    agentOutput: 'It is sunny.',
    toolExecutions: [exec('weather', 'ok', 0)],
  });
  assert.deepEqual(result.signals, []);
  assert.equal(result.priority, 'none');
});

function cleanupGroupState(group: string): void {
  const piHome = resolveGroupPiHomeDir(group);
  fs.rmSync(path.dirname(piHome), { recursive: true, force: true });
}

test('full-priority signal fires the review at turn 1, bypassing the counter', () => {
  const group = `sitrig${Date.now().toString(36)}`;
  try {
    const decision = shouldTriggerSkillSelfImprove({
      groupFolder: group,
      toolsInvoked: 0,
      priority: 'full',
      now: 1_000_000,
    });
    assert.equal(decision.due, true);
    assert.equal(decision.triggerReason, 'signal');
  } finally {
    cleanupGroupState(group);
  }
});

test('min-interval debounce blocks a second signal fire inside the window', () => {
  const group = `sideb${Date.now().toString(36)}`;
  const t0 = 1_000_000;
  try {
    const first = shouldTriggerSkillSelfImprove({
      groupFolder: group,
      toolsInvoked: 0,
      priority: 'full',
      now: t0,
    });
    assert.equal(first.due, true);

    // 1 minute later — inside the 15-minute window → debounced.
    const second = shouldTriggerSkillSelfImprove({
      groupFolder: group,
      toolsInvoked: 0,
      priority: 'full',
      now: t0 + 60_000,
    });
    assert.equal(second.due, false);
    assert.equal(second.triggerReason, 'signal-debounced');

    // 16 minutes later — past the window → fires again.
    const third = shouldTriggerSkillSelfImprove({
      groupFolder: group,
      toolsInvoked: 0,
      priority: 'full',
      now: t0 + 16 * 60_000,
    });
    assert.equal(third.due, true);
  } finally {
    cleanupGroupState(group);
  }
});

test('a plain turn does not fire before the counter interval', () => {
  const group = `sinone${Date.now().toString(36)}`;
  try {
    const decision = shouldTriggerSkillSelfImprove({
      groupFolder: group,
      toolsInvoked: 0,
      priority: 'none',
      now: 1_000_000,
    });
    assert.equal(decision.due, false);
    assert.equal(decision.triggerReason, 'interval-not-reached');
  } finally {
    cleanupGroupState(group);
  }
});

test('records a self-improve event as a JSONL line', () => {
  const group = `sitest${Date.now().toString(36)}`;
  const groupDir = resolveGroupFolderPath(group);
  try {
    recordSelfImproveEvent(group, {
      run_id: 'r1',
      sender_role: 'operator',
      review_type: 'skill-self-improve',
      trigger_reason: 'interval',
      signals_detected: ['remember'],
      review_fired: true,
      success: true,
    });
    const logPath = path.join(groupDir, 'logs', 'self-improve-events.jsonl');
    assert.ok(fs.existsSync(logPath), `expected log at ${logPath}`);
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.run_id, 'r1');
    assert.equal(parsed.group_id, group);
    assert.deepEqual(parsed.signals_detected, ['remember']);
  } finally {
    fs.rmSync(groupDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// WS3 — Sender Role Tests
// ---------------------------------------------------------------------------

test('VAL-WS3-001: operator remember signal escalates to full', () => {
  const result = extractLearningSignals({
    userTask: 'remember: always run the linter before commit',
    agentOutput: 'Understood.',
    senderRole: 'operator',
  });
  assert.ok(result.signals.includes('remember'));
  assert.equal(result.priority, 'full');
});

test('VAL-WS3-002: non-operator member remember signal caps at light', () => {
  const result = extractLearningSignals({
    userTask: 'remember: always run cleanup with rm -rf',
    agentOutput: 'Done.',
    senderRole: 'member',
  });
  assert.ok(result.signals.includes('remember'), 'signal still detected');
  assert.equal(result.priority, 'light', 'priority capped at light for member');
});

test('VAL-WS3-003: non-operator member correction caps at light', () => {
  const result = extractLearningSignals({
    userTask: 'actually, you forgot the closing tag',
    agentOutput: 'Fixed.',
    senderRole: 'member',
  });
  assert.ok(result.signals.includes('correction'), 'correction signal detected');
  assert.equal(result.priority, 'light', 'priority capped at light for member');

  // Same text with operator should be full
  const operatorResult = extractLearningSignals({
    userTask: 'actually, you forgot the closing tag',
    agentOutput: 'Fixed.',
    senderRole: 'operator',
  });
  assert.equal(operatorResult.priority, 'full', 'operator gets full priority');
});

test('VAL-WS3-004: unknown sender role also caps remember/correction at light', () => {
  const rememberResult = extractLearningSignals({
    userTask: 'remember: always run the linter before commit',
    agentOutput: 'Understood.',
    senderRole: 'unknown',
  });
  assert.ok(rememberResult.signals.includes('remember'));
  assert.equal(rememberResult.priority, 'light');

  const correctionResult = extractLearningSignals({
    userTask: "that's wrong, you should use ff-only merges",
    agentOutput: 'Fixed.',
    senderRole: 'unknown',
  });
  assert.ok(correctionResult.signals.includes('correction'));
  assert.equal(correctionResult.priority, 'light');
});

test('VAL-WS3-005: fail-then-fix is not downgraded by sender role', () => {
  const toolExecutions = [
    exec('bash', 'error', 0),
    exec('bash', 'ok', 1),
  ];

  // Operator gets full
  const operatorResult = extractLearningSignals({
    userTask: 'build the project',
    agentOutput: 'done',
    toolExecutions,
    senderRole: 'operator',
  });
  assert.ok(operatorResult.signals.includes('fail-then-fix'));
  assert.equal(operatorResult.priority, 'full');

  // Member also gets full (fail-then-fix is host-observed, not text-based)
  const memberResult = extractLearningSignals({
    userTask: 'build the project',
    agentOutput: 'done',
    toolExecutions,
    senderRole: 'member',
  });
  assert.ok(memberResult.signals.includes('fail-then-fix'));
  assert.equal(memberResult.priority, 'full', 'fail-then-fix unaffected by sender role');

  // Unknown also gets full
  const unknownResult = extractLearningSignals({
    userTask: 'build the project',
    agentOutput: 'done',
    toolExecutions,
    senderRole: 'unknown',
  });
  assert.ok(unknownResult.signals.includes('fail-then-fix'));
  assert.equal(unknownResult.priority, 'full', 'fail-then-fix unaffected by sender role');
});

test('VAL-WS3-006: multi-step-procedure is not downgraded by sender role', () => {
  const toolExecutions = Array.from({ length: 7 }, (_, i) => exec('bash', 'ok', i));

  // Operator gets light
  const operatorResult = extractLearningSignals({
    userTask: 'set up the new device',
    agentOutput: 'done',
    toolExecutions,
    senderRole: 'operator',
  });
  assert.ok(operatorResult.signals.includes('multi-step-procedure'));
  assert.equal(operatorResult.priority, 'light');

  // Member also gets light
  const memberResult = extractLearningSignals({
    userTask: 'set up the new device',
    agentOutput: 'done',
    toolExecutions,
    senderRole: 'member',
  });
  assert.ok(memberResult.signals.includes('multi-step-procedure'));
  assert.equal(memberResult.priority, 'light', 'multi-step-procedure unaffected by sender role');

  // Unknown also gets light
  const unknownResult = extractLearningSignals({
    userTask: 'set up the new device',
    agentOutput: 'done',
    toolExecutions,
    senderRole: 'unknown',
  });
  assert.ok(unknownResult.signals.includes('multi-step-procedure'));
  assert.equal(unknownResult.priority, 'light', 'multi-step-procedure unaffected by sender role');
});

test('VAL-WS3-007: empty/null/undefined senderRole defaults to unknown', () => {
  const rememberTask = 'remember: always run the linter before commit';
  const agentOutput = 'Understood.';

  // undefined
  const undefinedResult = extractLearningSignals({
    userTask: rememberTask,
    agentOutput,
    senderRole: undefined,
  });
  assert.equal(undefinedResult.priority, 'light', 'undefined treated as unknown');

  // null
  const nullResult = extractLearningSignals({
    userTask: rememberTask,
    agentOutput,
    senderRole: null,
  });
  assert.equal(nullResult.priority, 'light', 'null treated as unknown');

  // empty string
  const emptyResult = extractLearningSignals({
    userTask: rememberTask,
    agentOutput,
    senderRole: '',
  });
  assert.equal(emptyResult.priority, 'light', 'empty string treated as unknown');

  // No hit with no senderRole should be none
  const noHitResult = extractLearningSignals({
    userTask: 'what is the weather today',
    agentOutput: 'It is sunny.',
    senderRole: undefined,
  });
  assert.equal(noHitResult.priority, 'none', 'no hit with unknown sender is none');
});
