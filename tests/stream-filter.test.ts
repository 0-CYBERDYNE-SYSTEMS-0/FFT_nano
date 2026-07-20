import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STREAM_CURSOR,
  isSilenceMarker,
  holdbackSilenceMarker,
} from '../src/streaming/stream-filter.js';

test('STREAM_CURSOR constant value', () => {
  assert.equal(STREAM_CURSOR, ' ▉');
});

test('isSilenceMarker exact match NO_REPLY', () => {
  assert.equal(isSilenceMarker('NO_REPLY'), true);
});

test('isSilenceMarker exact match [SILENT]', () => {
  assert.equal(isSilenceMarker('[SILENT]'), true);
});

test('isSilenceMarker with surrounding whitespace', () => {
  assert.equal(isSilenceMarker('  NO_REPLY  '), true);
  assert.equal(isSilenceMarker('\t[SILENT]\n'), true);
});

test('isSilenceMarker negative cases', () => {
  assert.equal(isSilenceMarker('Hello'), false);
  assert.equal(isSilenceMarker('NO_REPLY!'), false);
  assert.equal(isSilenceMarker('no_reply'), false);
  assert.equal(isSilenceMarker(''), false);
});

test('holdbackSilenceMarker holds partial marker prefixes', () => {
  assert.equal(holdbackSilenceMarker('NO'), '');
  assert.equal(holdbackSilenceMarker('NO_RE'), '');
  assert.equal(holdbackSilenceMarker('NO_REPLY'), '');
  assert.equal(holdbackSilenceMarker('[SIL'), '');
});

test('holdbackSilenceMarker does not hold non-prefix text', () => {
  assert.equal(holdbackSilenceMarker('North'), 'North');
  assert.equal(
    holdbackSilenceMarker('The answer is NO'),
    'The answer is NO',
  );
  assert.equal(holdbackSilenceMarker('Hello world'), 'Hello world');
});

test('holdbackSilenceMarker passes empty text through', () => {
  assert.equal(holdbackSilenceMarker(''), '');
  assert.equal(holdbackSilenceMarker('  '), '  ');
});
