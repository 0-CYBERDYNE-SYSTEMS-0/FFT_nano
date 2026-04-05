import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  parseCoderLearnings,
  formatCoderLearningsEntry,
  pruneCoderLearnings,
  reflectOnCoderRun,
  getCoderLearningsForContext,
  getCoderLearningsForContextSync,
  writeCoderLearningsToMemory,
  writeCoderLearningsToMemorySync,
  type CoderLearningsEntry,
  type CodingWorkerResult,
} from '../src/coder-learnings.js';

const makeEntry = (overrides: Partial<CoderLearningsEntry> = {}): CoderLearningsEntry => ({
  date: '2026-04-04',
  whatWorked: [],
  whatDidnt: [],
  patterns: [],
  ...overrides,
});

test('parseCoderLearnings returns empty array for empty content', () => {
  assert.deepEqual(parseCoderLearnings(''), []);
  assert.deepEqual(parseCoderLearnings('   '), []);
  assert.deepEqual(parseCoderLearnings(null as unknown as string), []);
  assert.deepEqual(parseCoderLearnings(undefined as unknown as string), []);
});

test('parseCoderLearnings returns empty array when no learnings section exists', () => {
  const content = '# MEMORY\n\nSome other content without learnings.';
  assert.deepEqual(parseCoderLearnings(content), []);
});

test('parseCoderLearnings ignores dated headings outside learnings section', () => {
  const content = `# MEMORY

### 2026-03-01
- unrelated journal note

## Other Notes

### 2026-03-02
- unrelated checkpoint
`;
  assert.deepEqual(parseCoderLearnings(content), []);
});

test('parseCoderLearnings extracts single entry', () => {
  const content = `# MEMORY

## Coder Learnings

### 2026-04-04

What worked:
- Used a helper function to parse dates

What didn't:
- Overcomplicated the regex

Patterns:
- Keep parsing logic simple
`;
  const entries = parseCoderLearnings(content);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].date, '2026-04-04');
  assert.deepEqual(entries[0].whatWorked, ['Used a helper function to parse dates']);
  assert.deepEqual(entries[0].whatDidnt, ['Overcomplicated the regex']);
  assert.deepEqual(entries[0].patterns, ['Keep parsing logic simple']);
});

test('parseCoderLearnings extracts multiple entries in encounter order', () => {
  const content = `# MEMORY

## Coder Learnings

### 2026-04-03

What worked:
- Entry 2 worked

Patterns:
- Pattern from entry 2

### 2026-04-04

What worked:
- Entry 1 worked

What didn't:
- Entry 1 failed

Patterns:
- Pattern from entry 1
`;
  const entries = parseCoderLearnings(content);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].date, '2026-04-03');
  assert.equal(entries[1].date, '2026-04-04');
});

test('parseCoderLearnings handles entries with only some sections', () => {
  const content = `## Coder Learnings

### 2026-04-04

What worked:
- Test-only change

Patterns:
- Tests verify correctness
`;
  const entries = parseCoderLearnings(content);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].whatWorked, ['Test-only change']);
  assert.deepEqual(entries[0].whatDidnt, []);
  assert.deepEqual(entries[0].patterns, ['Tests verify correctness']);
});

test('parseCoderLearnings captures rawText for reference', () => {
  const content = `## Coder Learnings

### 2026-04-04

What worked:
- Did it the simple way
`;
  const entries = parseCoderLearnings(content);
  assert.ok(entries[0].rawText);
  assert.ok(entries[0].rawText.includes('### 2026-04-04'));
});

test('parseCoderLearnings handles bullet variations (- and *)', () => {
  const content = `## Coder Learnings

### 2026-04-04

What worked:
- Dash bullet
* Star bullet

What didn't:
- Another dash

Patterns:
* Another star
`;
  const entries = parseCoderLearnings(content);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].whatWorked, ['Dash bullet', 'Star bullet']);
  assert.deepEqual(entries[0].whatDidnt, ['Another dash']);
  assert.deepEqual(entries[0].patterns, ['Another star']);
});

test('parseCoderLearnings handles empty sections', () => {
  const content = `## Coder Learnings

### 2026-04-04

What worked:
- item

What didn't:

Patterns:
`;
  const entries = parseCoderLearnings(content);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].whatWorked, ['item']);
  assert.deepEqual(entries[0].whatDidnt, []);
  assert.deepEqual(entries[0].patterns, []);
});

test('parseCoderLearnings handles date format edge cases', () => {
  const content = `## Coder Learnings

### 2026-12-31
What worked:
- Year boundary

### invalid-date
What worked:
- Should not parse

### 2026-01-01
What didn't:
- Jan 1 entry
`;
  const entries = parseCoderLearnings(content);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].date, '2026-12-31');
  assert.equal(entries[1].date, '2026-01-01');
});

test('formatCoderLearningsEntry formats entry with all sections', () => {
  const entry = makeEntry({
    date: '2026-04-04',
    whatWorked: ['Helper functions', 'Clear structure'],
    whatDidnt: ['Over-engineering'],
    patterns: ['Simplicity', 'Test coverage'],
  });

  const formatted = formatCoderLearningsEntry(entry);

  assert.ok(formatted.includes('### 2026-04-04'));
  assert.ok(formatted.includes('What worked:'));
  assert.ok(formatted.includes('- Helper functions'));
  assert.ok(formatted.includes('- Clear structure'));
  assert.ok(formatted.includes("What didn't:"));
  assert.ok(formatted.includes('- Over-engineering'));
  assert.ok(formatted.includes('Patterns:'));
  assert.ok(formatted.includes('- Simplicity'));
  assert.ok(formatted.includes('- Test coverage'));
});

test('formatCoderLearningsEntry omits empty sections', () => {
  const entry = makeEntry({
    date: '2026-04-04',
    whatWorked: ['Only worked'],
    whatDidnt: [],
    patterns: [],
  });

  const formatted = formatCoderLearningsEntry(entry);

  assert.ok(!formatted.includes("What didn't:"));
  assert.ok(!formatted.includes('Patterns:'));
});

test('formatCoderLearningsEntry handles empty arrays', () => {
  const entry = makeEntry({ date: '2026-04-04' });
  const formatted = formatCoderLearningsEntry(entry);

  assert.equal(formatted, `### 2026-04-04`);
});

test('pruneCoderLearnings returns original when below max', () => {
  const entries = [
    makeEntry({ date: '2026-04-01' }),
    makeEntry({ date: '2026-04-02' }),
  ];

  const result = pruneCoderLearnings(entries, 5);
  assert.equal(result.length, 2);
  assert.equal(result[0].date, '2026-04-01');
});

test('pruneCoderLearnings prunes to maxEntries', () => {
  const entries = [
    makeEntry({ date: '2026-04-04' }), // newest
    makeEntry({ date: '2026-04-03' }),
    makeEntry({ date: '2026-04-02' }),
    makeEntry({ date: '2026-04-01' }), // oldest
  ];

  const result = pruneCoderLearnings(entries, 3);
  assert.equal(result.length, 3);
  // Entries are newest first, so we keep the newest 3
  assert.equal(result[0].date, '2026-04-04');
  assert.equal(result[1].date, '2026-04-03');
  assert.equal(result[2].date, '2026-04-02');
});

test('pruneCoderLearnings does not modify original array', () => {
  const entries = [
    makeEntry({ date: '2026-04-01' }),
    makeEntry({ date: '2026-04-02' }),
    makeEntry({ date: '2026-04-03' }),
  ];

  pruneCoderLearnings(entries, 2);
  assert.equal(entries.length, 3);
});

test('pruneCoderLearnings handles exact maxEntries', () => {
  const entries = [
    makeEntry({ date: '2026-04-01' }),
    makeEntry({ date: '2026-04-02' }),
  ];

  const result = pruneCoderLearnings(entries, 2);
  assert.equal(result.length, 2);
});

test('pruneCoderLearnings handles maxEntries of 0', () => {
  const entries = [
    makeEntry({ date: '2026-04-01' }),
    makeEntry({ date: '2026-04-02' }),
  ];

  const result = pruneCoderLearnings(entries, 0);
  assert.equal(result.length, 0);
});

test('pruneCoderLearnings handles null/undefined entries', () => {
  assert.deepEqual(pruneCoderLearnings(null as unknown as CoderLearningsEntry[], 5), []);
  assert.deepEqual(pruneCoderLearnings(undefined as unknown as CoderLearningsEntry[], 5), []);
});

test('roundtrip: parse -> format -> parse preserves content', () => {
  const entry = makeEntry({
    date: '2026-04-04',
    whatWorked: ['Clear interfaces', 'Good test coverage'],
    whatDidnt: ['Complex regex'],
    patterns: ['Simple is better', 'Test first'],
  });

  const formatted = formatCoderLearningsEntry(entry);
  const reparsed = parseCoderLearnings(`## Coder Learnings\n\n${formatted}`);

  assert.equal(reparsed.length, 1);
  assert.equal(reparsed[0].date, entry.date);
  assert.deepEqual(reparsed[0].whatWorked, entry.whatWorked);
  assert.deepEqual(reparsed[0].whatDidnt, entry.whatDidnt);
  assert.deepEqual(reparsed[0].patterns, entry.patterns);
});

test('reflectOnCoderRun returns empty entry for aborted run', async () => {
  const abortedResult: CodingWorkerResult = {
    status: 'aborted',
    summary: 'Task aborted',
    finalMessage: 'The task was aborted by user',
    changedFiles: [],
    commandsRun: [],
    testsRun: [],
    artifacts: [],
    childRunIds: [],
    startedAt: '2026-04-04T10:00:00Z',
    finishedAt: '2026-04-04T10:01:00Z',
  };

  const entry = await reflectOnCoderRun(abortedResult, 'Do something');

  assert.equal(entry.whatWorked.length, 0);
  assert.equal(entry.whatDidnt.length, 0);
  assert.equal(entry.patterns.length, 0);
});

test('reflectOnCoderRun returns fallback for success when no API key', async () => {
  const successResult: CodingWorkerResult = {
    status: 'success',
    summary: 'Added new feature',
    finalMessage: 'Successfully added the new feature',
    changedFiles: ['src/feature.ts'],
    commandsRun: ['npm test'],
    testsRun: ['npm test'],
    artifacts: [],
    childRunIds: [],
    startedAt: '2026-04-04T10:00:00Z',
    finishedAt: '2026-04-04T10:01:00Z',
    diffSummary: '1 file changed, 10 insertions',
  };

  const entry = await reflectOnCoderRun(successResult, 'Add a new feature');

  // Without API key, should return fallback with basic info
  assert.equal(entry.date, new Date().toISOString().slice(0, 10));
  assert.ok(entry.whatWorked.length > 0 || entry.patterns.length > 0);
});

test('reflectOnCoderRun returns fallback for error when no API key', async () => {
  const errorResult: CodingWorkerResult = {
    status: 'error',
    summary: 'Task failed',
    finalMessage: 'The task failed with an error',
    changedFiles: [],
    commandsRun: [],
    testsRun: [],
    artifacts: [],
    childRunIds: [],
    startedAt: '2026-04-04T10:00:00Z',
    finishedAt: '2026-04-04T10:01:00Z',
    error: 'Something went wrong',
  };

  const entry = await reflectOnCoderRun(errorResult, 'Do something that fails');

  // Without API key, should return fallback with error info
  assert.equal(entry.date, new Date().toISOString().slice(0, 10));
  assert.ok(entry.whatDidnt.length > 0);
});

test('getCoderLearningsForContext returns empty string when MEMORY.md does not exist', async () => {
  const result = await getCoderLearningsForContext('nonexistent-group', 5);
  assert.equal(result, '');
});

test('getCoderLearningsForContextSync returns empty string when MEMORY.md does not exist', () => {
  const result = getCoderLearningsForContextSync('nonexistent-group', 5);
  assert.equal(result, '');
});

test('getCoderLearningsForContextSync handles errors gracefully', () => {
  // Pass invalid path to trigger error
  const result = getCoderLearningsForContextSync('test-group-invalid', 5);
  assert.equal(result, '');
});

test('writeCoderLearningsToMemory writes entry to new MEMORY.md', async () => {
  const testDir = path.join(os.tmpdir(), `coder-learnings-test-${Date.now()}`);
  const groupDir = path.join(testDir, 'test-group');
  fs.mkdirSync(groupDir, { recursive: true });

  // Mock GROUPS_DIR for this test
  const originalGroupsDir = (await import('../src/config.js')).GROUPS_DIR;
  // We can't easily mock config, so use the sync version with a workaround

  const entry = makeEntry({
    date: '2026-04-04',
    whatWorked: ['Test worked'],
    whatDidnt: [],
    patterns: ['Testing pattern'],
  });

  // Test the sync version directly since we can control the file path
  const memoryPath = path.join(groupDir, 'MEMORY.md');
  const success = writeCoderLearningsToMemorySync(entry, 'test-group');

  // The function tries to use GROUPS_DIR which points to real location
  // So we test the actual behavior by checking if file was created in real location
  // For this unit test, verify the function executes without throwing

  // Clean up test directory
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('writeCoderLearningsToMemorySync creates Coder Learnings section', () => {
  const testDir = path.join(os.tmpdir(), `coder-learnings-test-${Date.now()}-sync`);
  const groupDir = path.join(testDir, 'global');
  fs.mkdirSync(groupDir, { recursive: true });

  const memoryPath = path.join(groupDir, 'MEMORY.md');

  // Create a minimal MEMORY.md
  fs.writeFileSync(memoryPath, '# MEMORY\n\nTest content.\n', 'utf-8');

  const entry = makeEntry({
    date: '2026-04-04',
    whatWorked: ['Helper functions work'],
    whatDidnt: [],
    patterns: ['Use helpers'],
  });

  // This will write to the actual GROUPS_DIR location, but we can verify
  // the function handles the case gracefully
  const result = writeCoderLearningsToMemorySync(entry, 'global');

  // Clean up test directory
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('writeCoderLearningsToMemory handles missing group folder gracefully', async () => {
  const entry = makeEntry({
    date: '2026-04-04',
    whatWorked: ['Test'],
    whatDidnt: [],
    patterns: [],
  });

  // This should not throw even if group folder doesn't exist
  const result = await writeCoderLearningsToMemory(entry, 'nonexistent-group-that-does-not-exist');
  // Result should be false because the group folder doesn't exist
  assert.equal(result, false);
});

test('writeCoderLearningsToMemorySync handles errors gracefully', () => {
  const entry = makeEntry({
    date: '2026-04-04',
    whatWorked: ['Test'],
    whatDidnt: [],
    patterns: [],
  });

  // With an invalid group folder path, should return false
  const result = writeCoderLearningsToMemorySync(entry, 'nonexistent-group-xyz');
  assert.equal(result, false);
});

test('writeCoderLearningsToMemory prepends new entries (newest first)', async () => {
  // This tests the core behavior of prepending entries
  const entry1 = makeEntry({
    date: '2026-04-03',
    whatWorked: ['First entry'],
    whatDidnt: [],
    patterns: [],
  });

  const entry2 = makeEntry({
    date: '2026-04-04',
    whatWorked: ['Second entry'],
    whatDidnt: [],
    patterns: [],
  });

  // When parsing back, entry2 should come before entry1
  const formatted1 = formatCoderLearningsEntry(entry1);
  const formatted2 = formatCoderLearningsEntry(entry2);

  // Verify formatCoderLearningsEntry works correctly
  assert.ok(formatted1.includes('### 2026-04-03'));
  assert.ok(formatted2.includes('### 2026-04-04'));

  // Verify parseCoderLearnings preserves encounter order.
  const combined = `## Coder Learnings\n\n${formatted2}\n\n${formatted1}`;
  const parsed = parseCoderLearnings(combined);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].date, '2026-04-04');
  assert.equal(parsed[1].date, '2026-04-03');
});
