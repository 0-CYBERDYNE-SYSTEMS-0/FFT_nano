import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeDelegationAlias,
  parseDelegationTrigger,
} from '../src/coding-delegation.js';

test('parses /coder execute trigger', () => {
  const parsed = parseDelegationTrigger('/coder fix auth');
  assert.equal(parsed.hint, 'force_delegate_execute');
  assert.equal(parsed.trigger, 'coder');
  assert.equal(parsed.instruction, 'fix auth');
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

