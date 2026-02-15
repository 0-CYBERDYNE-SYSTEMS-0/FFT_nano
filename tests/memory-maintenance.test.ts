import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  appendCompactionSummaryToMemory,
  migrateCompactionSectionsFromSoul,
} from '../src/memory-maintenance.js';

test('migrateCompactionSectionsFromSoul moves compaction blocks once and is idempotent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-memory-maint-'));
  const soulPath = path.join(root, 'SOUL.md');
  const memoryPath = path.join(root, 'MEMORY.md');
  try {
    fs.writeFileSync(
      soulPath,
      [
        '# SOUL',
        '',
        '## Identity',
        'Stable behavior.',
        '',
        '## Session Compaction 2026-02-15T00:00:00.000Z',
        '',
        '- Summary: hello',
        '',
        '## Session Compaction 2026-02-15T01:00:00.000Z',
        '',
        '- Summary: world',
        '',
        '## Policies',
        '- Keep deterministic.',
        '',
      ].join('\n'),
    );

    const first = migrateCompactionSectionsFromSoul(soulPath, memoryPath);
    assert.equal(first.movedSections, 2);
    assert.equal(first.changed, true);

    const soulAfter = fs.readFileSync(soulPath, 'utf8');
    const memoryAfter = fs.readFileSync(memoryPath, 'utf8');
    assert.equal(/Session Compaction/.test(soulAfter), false);
    assert.equal(memoryAfter.includes('Session Compaction 2026-02-15T00:00:00.000Z'), true);
    assert.equal(memoryAfter.includes('Session Compaction 2026-02-15T01:00:00.000Z'), true);

    const second = migrateCompactionSectionsFromSoul(soulPath, memoryPath);
    assert.equal(second.movedSections, 0);
    assert.equal(second.changed, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('appendCompactionSummaryToMemory writes to MEMORY.md', () => {
  const folder = `test-memory-maint-${Date.now()}`;
  const groupRoot = path.join(process.cwd(), 'groups', folder);
  try {
    appendCompactionSummaryToMemory(
      folder,
      'Summary content',
      '2026-02-15T02:00:00.000Z',
    );
    const memoryPath = path.join(groupRoot, 'MEMORY.md');
    const content = fs.readFileSync(memoryPath, 'utf8');
    assert.equal(content.includes('## Session Compaction 2026-02-15T02:00:00.000Z'), true);
    assert.equal(content.includes('Summary content'), true);
  } finally {
    fs.rmSync(groupRoot, { recursive: true, force: true });
  }
});
