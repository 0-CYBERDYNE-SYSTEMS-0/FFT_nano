import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBootPreflight } from '../src/boot-preflight.js';

test('runBootPreflight: all checkers pass -> ok true, no failures', () => {
  const result = runBootPreflight([
    () => {
      /* healthy */
    },
    () => {
      /* healthy */
    },
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test('runBootPreflight: one checker throws -> ok false and message contains module name', () => {
  const result = runBootPreflight([
    () => {
      throw new Error('better-sqlite3 preflight failed: ABI mismatch');
    },
    () => {
      /* healthy */
    },
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /better-sqlite3/);
});

test('runBootPreflight: default checker module names surface on failure', () => {
  const result = runBootPreflight([
    () => {
      throw new Error('pino preflight failed: cannot find module');
    },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.failures[0], /pino/);
});
