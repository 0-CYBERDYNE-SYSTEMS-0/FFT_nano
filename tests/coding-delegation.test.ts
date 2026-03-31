import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isLiveImpactCodingTask,
  isSubstantialCodingTask,
  normalizeDelegationAlias,
  parseDelegationTrigger,
} from '../src/coding-delegation.js';

test('parses /coder execute trigger', () => {
  const parsed = parseDelegationTrigger('/coder fix auth');
  assert.equal(parsed.hint, 'force_delegate_execute');
  assert.equal(parsed.trigger, 'coder');
  assert.equal(parsed.instruction, 'fix auth');
});

test('parses /coding execute trigger', () => {
  const parsed = parseDelegationTrigger('/coding build an app');
  assert.equal(parsed.hint, 'force_delegate_execute');
  assert.equal(parsed.trigger, 'coding');
  assert.equal(parsed.instruction, 'build an app');
});

test('parses bot-suffixed /coding execute trigger', () => {
  const parsed = parseDelegationTrigger('/coding@TestBot build an app');
  assert.equal(parsed.hint, 'force_delegate_execute');
  assert.equal(parsed.trigger, 'coding');
  assert.equal(parsed.instruction, 'build an app');
});

test('parses /coder-plan trigger', () => {
  const parsed = parseDelegationTrigger('/coder-plan propose refactor');
  assert.equal(parsed.hint, 'force_delegate_plan');
  assert.equal(parsed.trigger, 'coder-plan');
  assert.equal(parsed.instruction, 'propose refactor');
});

test('parses exact alias phrase use coding agent', () => {
  const parsed = parseDelegationTrigger('use coding agent');
  assert.equal(parsed.hint, 'force_delegate_execute');
  assert.equal(parsed.trigger, 'alias');
  assert.equal(parsed.instruction, null);
});

test('parses exact alias phrase use your coding agent skill', () => {
  const parsed = parseDelegationTrigger('use your coding agent skill');
  assert.equal(parsed.hint, 'force_delegate_execute');
  assert.equal(parsed.trigger, 'alias');
  assert.equal(parsed.instruction, null);
});

test('normalizes alias phrase punctuation and spacing', () => {
  const normalized = normalizeDelegationAlias('Use   your coding agent skill!!!');
  assert.equal(normalized, 'use your coding agent skill');
  const parsed = parseDelegationTrigger('Use   your coding agent skill!!!');
  assert.equal(parsed.hint, 'force_delegate_execute');
  assert.equal(parsed.trigger, 'alias');
});

test('does not trigger delegation for natural language coding asks', () => {
  const parsed = parseDelegationTrigger(
    'implement auth middleware and run checks',
  );
  assert.equal(parsed.hint, 'none');
  assert.equal(parsed.trigger, 'none');
  assert.equal(parsed.instruction, null);
});

test('detects substantial natural-language coding asks', () => {
  assert.equal(
    isSubstantialCodingTask('make me a full app with auth and a dashboard'),
    true,
  );
  assert.equal(
    isSubstantialCodingTask('debug this TypeScript build failure and patch the code'),
    true,
  );
  assert.equal(
    isSubstantialCodingTask('automate a soil moisture alert that texts me when a bed goes dry'),
    true,
  );
  assert.equal(
    isSubstantialCodingTask('create a harvest report script that runs every morning'),
    true,
  );
});

test('does not classify ordinary chat as a substantial coding ask', () => {
  assert.equal(isSubstantialCodingTask('what is the weather today?'), false);
  assert.equal(isSubstantialCodingTask('hello there'), false);
});

test('detects live-impact coding asks that should not auto-execute', () => {
  assert.equal(
    isLiveImpactCodingTask('automate the greenhouse vents based on temperature'),
    true,
  );
  assert.equal(
    isLiveImpactCodingTask('restart the gateway service every night'),
    true,
  );
  assert.equal(
    isLiveImpactCodingTask('create a report about this weeks harvest totals'),
    false,
  );
});
