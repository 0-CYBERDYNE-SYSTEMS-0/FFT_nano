import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalizeForDetection,
  isDestructiveCommand,
} from '../src/bash-guard.js';

test('plain destructive commands are still detected', () => {
  assert.equal(isDestructiveCommand('rm -rf /tmp/x').destructive, true);
  assert.equal(isDestructiveCommand('git reset --hard').destructive, true);
  assert.equal(isDestructiveCommand('git push --force').destructive, true);
});

test('safe commands are not flagged', () => {
  assert.equal(isDestructiveCommand('ls -la').destructive, false);
  assert.equal(isDestructiveCommand('npm run build').destructive, false);
  assert.equal(isDestructiveCommand('').destructive, false);
});

test('canonicalization neutralizes backslash-escape bypass', () => {
  // A leading backslash escapes any shell alias and runs the real binary.
  assert.equal(canonicalizeForDetection('\\rm -rf /'), 'rm -rf /');
  assert.equal(isDestructiveCommand('\\rm -rf /').destructive, true);
  // Mid-word escape.
  assert.equal(isDestructiveCommand('r\\m -rf /data').destructive, true);
});

test('canonicalization neutralizes quote-splitting bypass', () => {
  assert.equal(isDestructiveCommand('r"m" -rf /data').destructive, true);
  assert.equal(isDestructiveCommand("'rm' -rf /data").destructive, true);
});

test('canonicalization neutralizes irregular whitespace and continuations', () => {
  assert.equal(isDestructiveCommand('rm    -rf    /data').destructive, true);
  assert.equal(isDestructiveCommand('rm \\\n -rf /data').destructive, true);
});
