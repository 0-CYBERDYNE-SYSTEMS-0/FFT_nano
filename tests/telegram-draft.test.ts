import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveTelegramDraftId,
  normalizeTelegramDraftText,
} from '../src/pi-runner.js';

test('deriveTelegramDraftId is stable and positive', () => {
  const a = deriveTelegramDraftId('telegram:1:req-1');
  const b = deriveTelegramDraftId('telegram:1:req-1');
  const c = deriveTelegramDraftId('telegram:1:req-2');
  assert.equal(a, b);
  assert.equal(Number.isInteger(a), true);
  assert.equal(a > 0, true);
  assert.notEqual(a, c);
});

test('normalizeTelegramDraftText keeps text within 4096 chars', () => {
  const long = 'x'.repeat(5000);
  const normalized = normalizeTelegramDraftText(long);
  assert.equal(normalized.length, 4096);
  assert.equal(normalized.startsWith('...'), true);
});

test('normalizeTelegramDraftText returns placeholder for empty text', () => {
  assert.equal(normalizeTelegramDraftText(''), '.');
});
