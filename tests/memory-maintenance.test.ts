import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  appendCompactionSummaryToMemory,
  migrateCompactionSectionsFromSoul,
  resolveCompactionMemoryRelativePath,
} from '../src/memory-maintenance.js';
import { TIMEZONE } from '../src/config.js';
import { formatLocalDate } from '../src/time-context.js';

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

test('appendCompactionSummaryToMemory writes to daily staging note', () => {
  const folder = `test-memory-maint-${Date.now()}`;
  const groupRoot = path.join(process.cwd(), 'groups', folder);
  try {
    const timestampIso = '2026-02-15T02:00:00.000Z';
    appendCompactionSummaryToMemory(
      folder,
      'Summary content',
      timestampIso,
    );
    const memoryPath = path.join(
      groupRoot,
      'memory',
      `${formatLocalDate(new Date(timestampIso), TIMEZONE)}.md`,
    );
    const content = fs.readFileSync(memoryPath, 'utf8');
    assert.equal(content.includes(`## Session Compaction ${timestampIso}`), true);
    assert.equal(content.includes('Summary content'), true);
  } finally {
    fs.rmSync(groupRoot, { recursive: true, force: true });
  }
});

test('appendCompactionSummaryToMemory uses local timezone date key to match prompt reader', () => {
  const folder = `test-memory-maint-local-${Date.now()}`;
  const groupRoot = path.join(process.cwd(), 'groups', folder);
  try {
    const timestampIso = '2026-04-03T02:15:30.000Z';
    const expectedDateKey = formatLocalDate(new Date(timestampIso), TIMEZONE);
    appendCompactionSummaryToMemory(
      folder,
      'Late evening summary',
      timestampIso,
    );
    const memoryPath = path.join(groupRoot, 'memory', `${expectedDateKey}.md`);
    assert.equal(fs.existsSync(memoryPath), true);
    const content = fs.readFileSync(memoryPath, 'utf8');
    assert.equal(
      content.includes(`## Session Compaction ${timestampIso}`),
      true,
    );
    assert.equal(content.includes('Late evening summary'), true);
  } finally {
    fs.rmSync(groupRoot, { recursive: true, force: true });
  }
});

test('resolveCompactionMemoryRelativePath matches the actual save location', () => {
  const timestampIso = '2026-04-03T02:15:30.000Z';
  const relPath = resolveCompactionMemoryRelativePath(timestampIso);
  const expectedRelPath = `memory/${formatLocalDate(new Date(timestampIso), TIMEZONE)}.md`;
  assert.equal(relPath, expectedRelPath);
});

// ---------------------------------------------------------------------------
// VAL-TIME-013: Compaction path generation succeeds with invalid TZ
// ---------------------------------------------------------------------------

test('appendCompactionSummaryToMemory succeeds with invalid process.env.TZ (VAL-TIME-013)', () => {
  const priorTz = process.env.TZ;
  process.env.TZ = 'Totally/Fake/Zone';

  const folder = `test-memory-maint-invalid-tz-${Date.now()}`;
  const groupRoot = path.join(process.cwd(), 'groups', folder);
  try {
    // Should NOT throw even with invalid TZ
    appendCompactionSummaryToMemory(
      folder,
      'Compaction with bad timezone',
      '2026-04-03T02:15:30.000Z',
    );

    // File should have been written (using UTC fallback)
    const memoryDir = path.join(groupRoot, 'memory');
    const files = fs.readdirSync(memoryDir);
    assert.ok(files.length > 0, 'Expected at least one daily memory file to be written');

    const content = fs.readFileSync(
      path.join(memoryDir, files[0]),
      'utf8',
    );
    assert.equal(
      content.includes('## Session Compaction 2026-04-03T02:15:30.000Z'),
      true,
    );
    assert.equal(content.includes('Compaction with bad timezone'), true);
  } finally {
    if (priorTz === undefined) delete process.env.TZ;
    else process.env.TZ = priorTz;
    fs.rmSync(groupRoot, { recursive: true, force: true });
  }
});

test('resolveCompactionMemoryRelativePath returns valid path with invalid TZ (VAL-TIME-013)', () => {
  const priorTz = process.env.TZ;
  process.env.TZ = 'Invalid/Timezone';
  try {
    const relPath = resolveCompactionMemoryRelativePath('2026-04-03T02:15:30.000Z');
    // Should return a valid memory/YYYY-MM-DD.md path (not throw)
    assert.match(relPath, /^memory\/\d{4}-\d{2}-\d{2}\.md$/);
  } finally {
    if (priorTz === undefined) delete process.env.TZ;
    else process.env.TZ = priorTz;
  }
});
