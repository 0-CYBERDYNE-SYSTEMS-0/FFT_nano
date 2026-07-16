import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  diffWorkspaceFiles,
  formatLongRunCompletionPacket,
  formatLongRunStartNotice,
  isWeakFinalText,
  snapshotWorkspaceFiles,
} from '../src/long-run-visibility.js';

test('isWeakFinalText catches mid-thought completions', () => {
  assert.equal(isWeakFinalText(null), true);
  assert.equal(isWeakFinalText(''), true);
  assert.equal(
    isWeakFinalText(
      'Now let me build the HTML prototype. I am going for a Digital Soil aesthetic.',
    ),
    true,
  );
  assert.equal(
    isWeakFinalText(
      'Done. Open `projects/agri-agent-harness/prototype/index.html` for the field guide.',
    ),
    false,
  );
});

test('formatLongRunStartNotice includes controls', () => {
  const notice = formatLongRunStartNotice(
    'run-1',
    'research agent harnesses and build a farmer education site',
  );
  assert.match(notice, /Started long run run-1/);
  assert.match(notice, /milestones/i);
  assert.match(notice, /\/run_status run-1/);
  assert.match(notice, /\/cancel_run run-1/);
});

test('workspace snapshot/diff reports created files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-ws-snap-'));
  try {
    const before = snapshotWorkspaceFiles(root);
    fs.mkdirSync(path.join(root, 'projects'), { recursive: true });
    fs.writeFileSync(path.join(root, 'projects', 'a.html'), '<html/>');
    const after = snapshotWorkspaceFiles(root);
    const changes = diffWorkspaceFiles(before, after);
    assert.equal(changes.length, 1);
    assert.equal(changes[0]?.relativePath, path.join('projects', 'a.html'));
    assert.equal(changes[0]?.kind, 'created');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('completion packet includes inventory and weak-summary banner', () => {
  const packet = formatLongRunCompletionPacket({
    runId: 'run-x',
    elapsedText: '120s',
    output: 'Now let me build the HTML prototype.',
    changes: [
      {
        relativePath: 'projects/demo/index.html',
        size: 1200,
        kind: 'created',
      },
    ],
    workspaceRoot: '/tmp/ws',
  });
  assert.match(packet, /Run run-x complete \(120s\)/);
  assert.match(packet, /Wrote `projects\/demo\/index\.html`/);
  assert.match(packet, /weak summary/i);
  assert.match(packet, /Workspace: \/tmp\/ws/);
});
