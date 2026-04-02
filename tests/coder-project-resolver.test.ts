import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  extractProjectOverride,
  resolveCoderProjectTarget,
} from '../src/coder-project-resolver.js';

function createWorkspaceFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-coder-projects-'));
  fs.mkdirSync(path.join(root, 'workspace', 'projects'), { recursive: true });
  return root;
}

test('extractProjectOverride strips explicit project prefix from task text', () => {
  const parsed = extractProjectOverride('project:agintel fix the auth bug');
  assert.equal(parsed.projectHint, 'agintel');
  assert.equal(parsed.cleanedTaskText, 'fix the auth bug');
});

test('resolveCoderProjectTarget finds exact catalog project matches', () => {
  const root = createWorkspaceFixture();
  try {
    const projectDir = path.join(root, 'workspace', 'projects', 'agintel-dashboard');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.git'), 'gitdir: /tmp/mock\n');

    const resolved = resolveCoderProjectTarget({
      mainWorkspaceDir: root,
      taskText: 'project:agintel-dashboard fix the auth bug',
    });

    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.projectLabel, 'agintel-dashboard');
    assert.equal(resolved.workspaceRoot, projectDir);
    assert.equal(resolved.isGitRepo, true);
    assert.equal(resolved.taskText, 'fix the auth bug');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveCoderProjectTarget uses fuzzy matching for typoed project names', () => {
  const root = createWorkspaceFixture();
  try {
    const projectDir = path.join(root, 'workspace', 'projects', 'agintel-dashboard');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.git'), 'gitdir: /tmp/mock\n');

    const resolved = resolveCoderProjectTarget({
      mainWorkspaceDir: root,
      taskText: 'project:agintle fix the auth bug',
    });

    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.projectLabel, 'agintel-dashboard');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveCoderProjectTarget returns ambiguous when multiple close matches exist', () => {
  const root = createWorkspaceFixture();
  try {
    const projects = ['agintel-dashboard', 'agintel-api'];
    for (const name of projects) {
      const dir = path.join(root, 'workspace', 'projects', name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /tmp/mock\n');
    }

    const resolved = resolveCoderProjectTarget({
      mainWorkspaceDir: root,
      taskText: 'project:agintel fix the auth bug',
    });

    assert.equal(resolved.status, 'ambiguous');
    assert.deepEqual(
      [...resolved.candidates.map((candidate) => candidate.projectLabel)].sort(),
      [...projects].sort(),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveCoderProjectTarget falls back to direct child project directories', () => {
  const root = createWorkspaceFixture();
  try {
    const fallbackDir = path.join(root, 'synthetic-telemetry-engine');
    fs.mkdirSync(fallbackDir, { recursive: true });
    fs.writeFileSync(path.join(fallbackDir, '.git'), 'gitdir: /tmp/mock\n');

    const resolved = resolveCoderProjectTarget({
      mainWorkspaceDir: root,
      taskText: 'project:synthetic fix the telemetry bug',
    });

    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.projectLabel, 'synthetic-telemetry-engine');
    assert.equal(resolved.workspaceRoot, fallbackDir);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveCoderProjectTarget defaults to the main workspace root when no project is specified', () => {
  const root = createWorkspaceFixture();
  try {
    fs.writeFileSync(path.join(root, '.git'), 'gitdir: /tmp/mock\n');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });

    const resolved = resolveCoderProjectTarget({
      mainWorkspaceDir: root,
      taskText: 'fix src/index.ts and run the checks',
    });

    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.workspaceRoot, root);
    assert.equal(resolved.isGitRepo, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveCoderProjectTarget defaults to the non-git main workspace root for plan-mode style requests', () => {
  const root = createWorkspaceFixture();
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });

    const resolved = resolveCoderProjectTarget({
      mainWorkspaceDir: root,
      taskText: 'inspect src/index.ts and propose a refactor plan',
    });

    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.workspaceRoot, root);
    assert.equal(resolved.isGitRepo, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveCoderProjectTarget returns not_found and suggested slug when no project matches', () => {
  const root = createWorkspaceFixture();
  try {
    const resolved = resolveCoderProjectTarget({
      mainWorkspaceDir: root,
      taskText: 'project:orchard-os build the first dashboard',
    });

    assert.equal(resolved.status, 'not_found');
    assert.equal(resolved.projectHint, 'orchard-os');
    assert.equal(resolved.suggestedSlug, 'orchard-os');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
