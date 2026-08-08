import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruneHeartbeatChecklists } from '../src/heartbeat-checklist.js';

test('pruneHeartbeatChecklists: keeps newest KEEP and current outPath', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-hb-checks-'));
  try {
    const keep = 3;
    const total = keep + 2; // 5 files, keep 3, prune 2 oldest
    for (let i = 0; i < total; i++) {
      fs.writeFileSync(
        path.join(tmp, `req-${String(i).padStart(4, '0')}.json`),
        '{}',
      );
    }
    const current = path.join(tmp, 'req-9999.json');
    fs.writeFileSync(current, '{}');

    pruneHeartbeatChecklists(tmp, current, keep);

    const remaining = fs.readdirSync(tmp).filter((f) => f.endsWith('.json'));
    assert.equal(remaining.length, keep + 1); // KEEP + the always-kept current
    assert.ok(remaining.includes('req-9999.json'), 'current outPath always present');
    // Newest KEEP names survive; oldest pruned.
    assert.ok(remaining.includes('req-0003.json'));
    assert.ok(remaining.includes('req-0004.json'));
    assert.equal(remaining.includes('req-0000.json'), false);
    assert.equal(remaining.includes('req-0001.json'), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('pruneHeartbeatChecklists: never throws on missing dir', () => {
  const tmp = path.join(os.tmpdir(), 'fft-hb-checks-missing-' + Date.now());
  assert.doesNotThrow(() => pruneHeartbeatChecklists(tmp, path.join(tmp, 'x.json'), 50));
});
