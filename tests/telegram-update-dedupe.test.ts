import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createUpdateIdTracker,
  shouldRunCommandOnEdit,
} from '../src/telegram.js';

test('createUpdateIdTracker: repeat returns true second time', () => {
  const tracker = createUpdateIdTracker(1000);
  tracker.mark(7);
  tracker.mark(8);
  assert.equal(tracker.has(7), true);
  assert.equal(tracker.has(8), true);
  assert.equal(tracker.has(9), false);
});

test('createUpdateIdTracker: eviction past cap', () => {
  const cap = 3;
  const tracker = createUpdateIdTracker(cap);
  for (let i = 0; i < cap + 2; i++) {
    tracker.mark(i);
  }
  // Oldest entries (0, 1) evicted once queue exceeds cap.
  assert.equal(tracker.has(0), false);
  assert.equal(tracker.has(1), false);
  assert.equal(tracker.has(2), true);
  assert.equal(tracker.has(3), true);
  assert.equal(tracker.has(4), true);
});

test('shouldRunCommandOnEdit: false for edited command', () => {
  assert.equal(
    shouldRunCommandOnEdit({ isEdited: true, isCommand: true }),
    false,
  );
});

test('shouldRunCommandOnEdit: true for non-edited command', () => {
  assert.equal(
    shouldRunCommandOnEdit({ isEdited: false, isCommand: true }),
    true,
  );
});

test('shouldRunCommandOnEdit: true for edited non-command', () => {
  assert.equal(
    shouldRunCommandOnEdit({ isEdited: true, isCommand: false }),
    true,
  );
});
