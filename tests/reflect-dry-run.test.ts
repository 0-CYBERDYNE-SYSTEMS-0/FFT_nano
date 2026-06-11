import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { executeSkillAction } from '../src/skill-lifecycle.js';
import { executeMemoryAction } from '../src/memory-action-gateway.js';
import { runAuthorityRegistry } from '../src/app-state.js';
import { mintRunAuthority } from '../src/run-authority.js';

function auditPath(group: string): string {
  return path.join(
    process.cwd(),
    'groups',
    group,
    'logs',
    'mutation-audit.jsonl',
  );
}

function readAuditLines(group: string): string[] {
  const p = auditPath(group);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0);
}

function setDryRunAuthority(groupFolder: string, dryRun: boolean): void {
  runAuthorityRegistry.set(
    groupFolder,
    mintRunAuthority({
      requestId: 'reflect-test',
      groupFolder,
      isMain: true,
      dryRun,
    }),
  );
}

test('skill_create is rejected for a dry-run authority and audited as noop', async () => {
  const groupFolder = `reflect-dryrun-skill-${Date.now()}`;
  const skillsDir = path.join(
    process.cwd(),
    'data',
    'pi',
    groupFolder,
    '.pi',
    'skills',
  );
  setDryRunAuthority(groupFolder, true);
  try {
    const result = await executeSkillAction(
      {
        type: 'skill_action',
        action: 'skill_create',
        requestId: 'create-dry-1',
        params: {
          groupFolder,
          name: 'dry-run-skill',
          description: 'Should not be created.',
        },
      },
      { sourceGroup: groupFolder, isMain: true, registeredGroups: {} },
    );

    assert.equal(result.status, 'error');
    assert.match(result.error || '', /dry-run/i);
    assert.ok(
      !fs.existsSync(path.join(skillsDir, 'dry-run-skill')),
      'skill directory must not be created in dry-run',
    );

    const lines = readAuditLines(groupFolder);
    const noop = lines
      .map((l) => JSON.parse(l))
      .find((e) => e.kind === 'noop' && e.noopReason === 'dry-run');
    assert.ok(noop, 'expected a noop audit line with noopReason "dry-run"');
  } finally {
    runAuthorityRegistry.delete(groupFolder);
    fs.rmSync(path.join(process.cwd(), 'data', 'pi', groupFolder), {
      recursive: true,
      force: true,
    });
    fs.rmSync(path.join(process.cwd(), 'groups', groupFolder), {
      recursive: true,
      force: true,
    });
  }
});

test('memory_write is rejected for a dry-run authority and audited as noop', async () => {
  const groupFolder = `reflect-dryrun-memory-${Date.now()}`;
  const groupDir = path.join(process.cwd(), 'groups', groupFolder);
  setDryRunAuthority(groupFolder, true);
  try {
    fs.mkdirSync(groupDir, { recursive: true });

    const result = await executeMemoryAction(
      {
        type: 'memory_action',
        action: 'memory_write',
        requestId: 'write-dry-1',
        params: {
          intent: 'todo_upsert_task',
          payload: {
            entryId: 'T-dry-run',
            text: 'Should not be written',
            status: 'PENDING',
          },
        },
      },
      { sourceGroup: groupFolder, isMain: false, registeredGroups: {} },
    );

    assert.equal(result.status, 'error');
    assert.match(result.error || '', /dry-run/i);

    const lines = readAuditLines(groupFolder);
    const noop = lines
      .map((l) => JSON.parse(l))
      .find((e) => e.kind === 'noop' && e.noopReason === 'dry-run');
    assert.ok(noop, 'expected a noop audit line with noopReason "dry-run"');
  } finally {
    runAuthorityRegistry.delete(groupFolder);
    fs.rmSync(groupDir, { recursive: true, force: true });
  }
});

test('read-only skill actions still succeed under a dry-run authority', async () => {
  const groupFolder = `reflect-dryrun-readonly-${Date.now()}`;
  try {
    // Create the skill with a non-dry-run authority first.
    setDryRunAuthority(groupFolder, false);
    const created = await executeSkillAction(
      {
        type: 'skill_action',
        action: 'skill_create',
        requestId: 'create-readonly-1',
        params: {
          groupFolder,
          name: 'readonly-check-skill',
          description: 'Used to verify dry-run reads still work.',
        },
      },
      { sourceGroup: groupFolder, isMain: true, registeredGroups: {} },
    );
    assert.equal(created.status, 'success');

    // Now flip to a dry-run authority and confirm reads still succeed.
    setDryRunAuthority(groupFolder, true);
    const status = await executeSkillAction(
      {
        type: 'skill_action',
        action: 'skill_status',
        requestId: 'status-dry-1',
        params: { groupFolder },
      },
      { sourceGroup: groupFolder, isMain: true, registeredGroups: {} },
    );
    assert.equal(status.status, 'success');

    const view = await executeSkillAction(
      {
        type: 'skill_action',
        action: 'skill_view',
        requestId: 'view-dry-1',
        params: { groupFolder, name: 'readonly-check-skill' },
      },
      { sourceGroup: groupFolder, isMain: true, registeredGroups: {} },
    );
    assert.equal(view.status, 'success');
  } finally {
    runAuthorityRegistry.delete(groupFolder);
    fs.rmSync(path.join(process.cwd(), 'data', 'pi', groupFolder), {
      recursive: true,
      force: true,
    });
    fs.rmSync(path.join(process.cwd(), 'groups', groupFolder), {
      recursive: true,
      force: true,
    });
  }
});

test('skill_create still succeeds for a normal (non-dry-run) authority', async () => {
  const groupFolder = `reflect-dryrun-sanity-${Date.now()}`;
  setDryRunAuthority(groupFolder, false);
  try {
    const result = await executeSkillAction(
      {
        type: 'skill_action',
        action: 'skill_create',
        requestId: 'create-sanity-1',
        params: {
          groupFolder,
          name: 'sanity-skill',
          description: 'Default path remains unchanged.',
        },
      },
      { sourceGroup: groupFolder, isMain: true, registeredGroups: {} },
    );

    assert.equal(result.status, 'success');
  } finally {
    runAuthorityRegistry.delete(groupFolder);
    fs.rmSync(path.join(process.cwd(), 'data', 'pi', groupFolder), {
      recursive: true,
      force: true,
    });
    fs.rmSync(path.join(process.cwd(), 'groups', groupFolder), {
      recursive: true,
      force: true,
    });
  }
});
