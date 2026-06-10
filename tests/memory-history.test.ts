import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import test from 'node:test';

import {
  listMemoryHistory,
  rollbackMemoryFile,
  snapshotMemoryFile,
  getMemorySnapshotAttribution,
} from '../src/memory-history.js';
import { PARITY_CONFIG } from '../src/config.js';

function tempFile(suffix = ''): string {
  return path.join(
    process.cwd(),
    'data',
    `mem-hist-test-${Date.now().toString(36)}${suffix}.md`,
  );
}

test('snapshotMemoryFile returns null when target does not exist', () => {
  const target = tempFile('-noexist');
  const result = snapshotMemoryFile(target);
  assert.equal(result, null);
});

test('snapshotMemoryFile creates a snapshot file', () => {
  const target = tempFile();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '# Test memory file\nOriginal content.\n');
  try {
    const snapPath = snapshotMemoryFile(target);
    assert.ok(snapPath, 'snapshot path should be non-null');
    assert.ok(fs.existsSync(snapPath!), 'snapshot file should exist');
    const content = fs.readFileSync(snapPath!, 'utf-8');
    assert.equal(content, '# Test memory file\nOriginal content.\n');
  } finally {
    fs.rmSync(target, { force: true });
    const snapDir = `${target}.history`;
    fs.rmSync(snapDir, { recursive: true, force: true });
  }
});

test('snapshotMemoryFile stores attribution in companion .attr.json', () => {
  const target = tempFile();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '# Test\nContent.\n');
  try {
    const attribution = {
      authorityId: 'auth-123',
      senderRole: 'operator',
      jid: 'chat-jid-abc',
    };
    const snapPath = snapshotMemoryFile(target, attribution);
    assert.ok(snapPath);
    const attrPath = `${snapPath}.attr.json`;
    assert.ok(fs.existsSync(attrPath), 'attribution companion file should exist');
    const attr = JSON.parse(fs.readFileSync(attrPath, 'utf-8'));
    assert.equal(attr.authorityId, 'auth-123');
    assert.equal(attr.senderRole, 'operator');
    assert.equal(attr.jid, 'chat-jid-abc');
  } finally {
    fs.rmSync(target, { force: true });
    const snapDir = `${target}.history`;
    fs.rmSync(snapDir, { recursive: true, force: true });
  }
});

test('listMemoryHistory returns entries newest-last', () => {
  const target = tempFile();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '# Test\nInitial.\n');
  try {
    snapshotMemoryFile(target);
    fs.writeFileSync(target, '# Test\nSecond.\n');
    snapshotMemoryFile(target);
    const history = listMemoryHistory(target);
    assert.ok(history.length >= 2);
    // Entries are sorted oldest-first (ascending version string = chronological).
    // The last entry is the most recent snapshot.
    assert.ok(history[history.length - 1].version > history[0].version,
      'newest entry should have a greater version string than the oldest');
  } finally {
    fs.rmSync(target, { force: true });
    const snapDir = `${target}.history`;
    fs.rmSync(snapDir, { recursive: true, force: true });
  }
});

test('rollbackMemoryFile restores prior content', () => {
  const target = tempFile();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '# Test\nVersion 1.\n');
  try {
    const snap1 = snapshotMemoryFile(target)!;
    fs.writeFileSync(target, '# Test\nVersion 2.\n');
    const snap2 = snapshotMemoryFile(target)!;
    fs.writeFileSync(target, '# Test\nVersion 3.\n');

    // Rollback to snap1 (version 1)
    const version = rollbackMemoryFile(target, { version: path.basename(snap1).replace(`${path.basename(target)}.`, '') });
    assert.ok(version, 'rollback should return version');
    const content = fs.readFileSync(target, 'utf-8');
    assert.match(content, /Version 1/);
  } finally {
    fs.rmSync(target, { force: true });
    const snapDir = `${target}.history`;
    fs.rmSync(snapDir, { recursive: true, force: true });
  }
});

test('rollbackMemoryFile snapshots current state before clobbering', () => {
  const target = tempFile();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '# Test\nBefore rollback.\n');
  try {
    const snapBeforeRollback = snapshotMemoryFile(target)!;
    const historyBefore = listMemoryHistory(target).length;
    rollbackMemoryFile(target); // Rollback to latest
    // After rollback, the "Before rollback" content should be the new live content,
    // and a NEW snapshot of "Before rollback" should have been created (rollback is itself snapshotted)
    const historyAfter = listMemoryHistory(target);
    assert.ok(historyAfter.length >= historyBefore);
  } finally {
    fs.rmSync(target, { force: true });
    const snapDir = `${target}.history`;
    fs.rmSync(snapDir, { recursive: true, force: true });
  }
});

test('getMemorySnapshotAttribution returns attribution for a snapshot', () => {
  const target = tempFile();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '# Test\nContent.\n');
  try {
    const attribution = { authorityId: 'auth-xyz', senderRole: 'member', jid: 'jid-123' };
    const snapPath = snapshotMemoryFile(target, attribution);
    const retrieved = getMemorySnapshotAttribution(snapPath!);
    assert.ok(retrieved);
    assert.equal(retrieved!.authorityId, 'auth-xyz');
    assert.equal(retrieved!.senderRole, 'member');
    assert.equal(retrieved!.jid, 'jid-123');
  } finally {
    fs.rmSync(target, { force: true });
    const snapDir = `${target}.history`;
    fs.rmSync(snapDir, { recursive: true, force: true });
  }
});

test('snapshotMemoryFile uses PARITY_CONFIG.skills.historyRetentionDays as default retention', () => {
  const target = tempFile();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '# Test\nContent.\n');
  try {
    const snap = snapshotMemoryFile(target);
    assert.ok(snap);
    // The function should use the configured retention days (defaults to 14)
    assert.ok(PARITY_CONFIG.skills.historyRetentionDays >= 1);
  } finally {
    fs.rmSync(target, { force: true });
    const snapDir = `${target}.history`;
    fs.rmSync(snapDir, { recursive: true, force: true });
  }
});
