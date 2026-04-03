import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cycleVerboseMode,
  describeVerboseMode,
  getEffectiveVerboseMode,
  normalizeVerboseMode,
  parseVerboseDirective,
} from '../src/verbose-mode.js';

test('normalizeVerboseMode accepts canonical values and aliases', () => {
  assert.equal(normalizeVerboseMode('new'), 'new');
  assert.equal(normalizeVerboseMode('on'), 'all');
  assert.equal(normalizeVerboseMode('ALL'), 'all');
  assert.equal(normalizeVerboseMode('full'), 'verbose');
  assert.equal(normalizeVerboseMode('0'), 'off');
  assert.equal(normalizeVerboseMode('weird'), undefined);
});

test('parseVerboseDirective handles cycle and explicit set forms', () => {
  assert.deepEqual(parseVerboseDirective('/verbose'), {
    kind: 'cycle',
    prompt: '/verbose',
  });
  assert.deepEqual(parseVerboseDirective('/verbose verbose'), {
    kind: 'set',
    prompt: '/verbose verbose',
    mode: 'verbose',
  });
});

test('cycleVerboseMode matches the configured cycle ordering', () => {
  assert.equal(cycleVerboseMode(undefined), 'verbose');
  assert.equal(cycleVerboseMode('off'), 'new');
  assert.equal(cycleVerboseMode('new'), 'all');
  assert.equal(cycleVerboseMode('all'), 'verbose');
  assert.equal(cycleVerboseMode('verbose'), 'off');
});

test('getEffectiveVerboseMode defaults unset chats to off', () => {
  assert.equal(getEffectiveVerboseMode(undefined), 'off');
  assert.equal(getEffectiveVerboseMode('new'), 'new');
});

test('parseVerboseDirective accepts bot-suffixed command tokens', () => {
  assert.deepEqual(parseVerboseDirective('/verbose@TestBot on'), {
    kind: 'set',
    prompt: '/verbose@TestBot on',
    mode: 'all',
  });
});

test('parseVerboseDirective rejects invalid command mode values', () => {
  assert.deepEqual(parseVerboseDirective('/verbose noisy'), {
    kind: 'invalid',
    prompt: '/verbose noisy',
    value: 'noisy',
  });
});

test('parseVerboseDirective rejects inline prompt payloads', () => {
  assert.deepEqual(parseVerboseDirective('/verbose all fix the build'), {
    kind: 'invalid',
    prompt: '/verbose all fix the build',
    value: 'all fix the build',
  });
});

test('describeVerboseMode returns operator-facing status copy', () => {
  assert.match(describeVerboseMode('off'), /silent mode/i);
  assert.match(describeVerboseMode('new'), /minimal tool updates/i);
  assert.match(describeVerboseMode('all'), /separate progress message/i);
  assert.match(describeVerboseMode('verbose'), /args, errors, and output/i);
});
