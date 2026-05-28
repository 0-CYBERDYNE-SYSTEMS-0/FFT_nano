import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  listSkillHistory,
  rollbackSkillFile,
  snapshotSkillFile,
} from '../src/skill-history.js';
import { executeSkillAction } from '../src/skill-lifecycle.js';

function tempSkillFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-skillhist-'));
  return path.join(dir, 'SKILL.md');
}

test('snapshotSkillFile is a no-op when the target does not exist yet', () => {
  const target = tempSkillFile();
  assert.equal(snapshotSkillFile(target), null);
  assert.deepEqual(listSkillHistory(target), []);
});

test('each write snapshots the prior version, newest last', () => {
  const target = tempSkillFile();
  fs.writeFileSync(target, 'v1');
  snapshotSkillFile(target);
  fs.writeFileSync(target, 'v2');
  snapshotSkillFile(target);
  fs.writeFileSync(target, 'v3');

  const history = listSkillHistory(target);
  assert.equal(history.length, 2);
  assert.equal(fs.readFileSync(history[0].path, 'utf-8'), 'v1');
  assert.equal(fs.readFileSync(history[1].path, 'utf-8'), 'v2');
});

test('rollback restores the most recent prior version and is reversible', () => {
  const target = tempSkillFile();
  fs.writeFileSync(target, 'good');
  snapshotSkillFile(target);
  fs.writeFileSync(target, 'broken');

  const restored = rollbackSkillFile(target);
  assert.ok(restored);
  assert.equal(fs.readFileSync(target, 'utf-8'), 'good');

  // Rollback snapshotted 'broken' first, so a second rollback returns to it.
  const restoredAgain = rollbackSkillFile(target);
  assert.ok(restoredAgain);
  assert.equal(fs.readFileSync(target, 'utf-8'), 'broken');
});

test('rollback returns null when there is no history', () => {
  const target = tempSkillFile();
  fs.writeFileSync(target, 'only');
  assert.equal(rollbackSkillFile(target), null);
});

test('history is pruned to the most recent 10 versions', () => {
  const target = tempSkillFile();
  for (let i = 0; i < 15; i += 1) {
    fs.writeFileSync(target, `v${i}`);
    snapshotSkillFile(target);
  }
  const history = listSkillHistory(target);
  assert.equal(history.length, 10);
  // Oldest retained is v5 (v0..v4 pruned).
  assert.equal(fs.readFileSync(history[0].path, 'utf-8'), 'v5');
  assert.equal(fs.readFileSync(history[9].path, 'utf-8'), 'v14');
});

test('skill_rollback IPC undoes a bad patch', async () => {
  const groupFolder = `skill-rollback-${Date.now()}`;
  const skillsDir = path.join(
    process.cwd(),
    'data',
    'pi',
    groupFolder,
    '.pi',
    'skills',
  );
  const ctx = { sourceGroup: groupFolder, isMain: true, registeredGroups: {} };
  try {
    await executeSkillAction(
      {
        type: 'skill_action',
        action: 'skill_create',
        requestId: 'c1',
        params: {
          groupFolder,
          name: 'rollback-skill',
          description: 'first version',
          content:
            '---\nname: rollback-skill\ndescription: first version\n---\n\n# rollback-skill\n\noriginal body\n',
        },
      },
      ctx,
    );

    const patch = await executeSkillAction(
      {
        type: 'skill_action',
        action: 'skill_patch',
        requestId: 'p1',
        params: {
          groupFolder,
          name: 'rollback-skill',
          content:
            '---\nname: rollback-skill\ndescription: broken version\n---\n\n# rollback-skill\n\nBROKEN body\n',
        },
      },
      ctx,
    );
    assert.equal(patch.status, 'success');
    const skillMd = path.join(skillsDir, 'rollback-skill', 'SKILL.md');
    assert.match(fs.readFileSync(skillMd, 'utf-8'), /BROKEN body/);

    const rollback = await executeSkillAction(
      {
        type: 'skill_action',
        action: 'skill_rollback',
        requestId: 'r1',
        params: { groupFolder, name: 'rollback-skill' },
      },
      ctx,
    );
    assert.equal(rollback.status, 'success');
    const after = fs.readFileSync(skillMd, 'utf-8');
    assert.match(after, /original body/);
    assert.doesNotMatch(after, /BROKEN body/);
  } finally {
    fs.rmSync(path.join(process.cwd(), 'data', 'pi', groupFolder), {
      recursive: true,
      force: true,
    });
  }
});
