import test from 'node:test';
import assert from 'node:assert/strict';

import { splitInlineReasoning } from '../src/pi-json-parser.js';

test('passes through text with no reasoning tags', () => {
  const { visible, reasoning } = splitInlineReasoning('Corn is up 2% today.');
  assert.equal(visible, 'Corn is up 2% today.');
  assert.equal(reasoning, '');
});

test('strips a complete <think> block, keeps the answer', () => {
  const { visible, reasoning } = splitInlineReasoning(
    '<think>TD said good evening; reply briefly.</think>Evening! All quiet.',
  );
  assert.equal(visible, 'Evening! All quiet.');
  assert.equal(reasoning, 'TD said good evening; reply briefly.');
});

test('strips multiple blocks and collapses gaps', () => {
  const { visible, reasoning } = splitInlineReasoning(
    '<think>step one</think>Line A\n<think>step two</think>Line B',
  );
  assert.equal(visible, 'Line A\nLine B');
  assert.equal(reasoning, 'step one\nstep two');
});

test('drops everything after an unclosed (mid-stream) <think>', () => {
  const { visible, reasoning } = splitInlineReasoning(
    'Here is the table:<think>let me reconsider the columns',
  );
  assert.equal(visible, 'Here is the table:');
  assert.equal(reasoning, 'let me reconsider the columns');
});

test('handles the <thinking> variant', () => {
  const { visible } = splitInlineReasoning(
    '<thinking>private</thinking>Public answer.',
  );
  assert.equal(visible, 'Public answer.');
});

test('does not treat non-reasoning tags as reasoning', () => {
  const { visible, reasoning } = splitInlineReasoning(
    'Use <thinker> as a placeholder.',
  );
  assert.equal(visible, 'Use <thinker> as a placeholder.');
  assert.equal(reasoning, '');
});

test('no leak when a tag is split across streamed deltas', () => {
  // Simulate pi-runner accumulation: recompute from the full raw buffer
  // after each appended chunk. The visible text must never contain a tag.
  const deltas = ['<thi', 'nk>reaso', 'ning here</thi', 'nk>Final ', 'answer.'];
  let raw = '';
  let lastVisible = '';
  for (const d of deltas) {
    raw += d;
    const split = splitInlineReasoning(raw);
    lastVisible = split.visible;
    assert.ok(
      !/<\/?think/i.test(lastVisible),
      `visible leaked a tag at buffer "${raw}": "${lastVisible}"`,
    );
  }
  assert.equal(lastVisible, 'Final answer.');
});

test('empty visible when the whole message is reasoning', () => {
  const { visible, reasoning } = splitInlineReasoning(
    '<think>still working through it</think>',
  );
  assert.equal(visible, '');
  assert.equal(reasoning, 'still working through it');
});
