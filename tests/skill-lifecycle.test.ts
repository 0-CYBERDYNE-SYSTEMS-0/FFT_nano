import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applySkillManagerTransitions,
  buildSkillReport,
  executeSkillAction,
  isAgentCreatedSkill,
  loadSkillUsage,
  resolveGroupSkillsDir,
  saveSkillUsage,
  type SkillManagerConfig,
} from '../src/skill-lifecycle.js';

const config: SkillManagerConfig = {
  enabled: true,
  intervalHours: 168,
  minIdleHours: 2,
  staleAfterDays: 30,
  archiveAfterDays: 90,
  backupEnabled: true,
  backupKeep: 5,
};

function skillMarkdown(name: string, description = 'test skill'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;
}

test('skill actions create, view, patch, archive, and restore agent-created skills', async () => {
  const groupFolder = `skill-test-${Date.now()}`;
  const skillsDir = path.join(
    process.cwd(),
    'data',
    'pi',
    groupFolder,
    '.pi',
    'skills',
  );
  try {
    const created = await executeSkillAction(
      {
        type: 'skill_action',
        action: 'skill_create',
        requestId: 'create-1',
        params: {
          groupFolder,
          name: 'irrigation-check',
          description: 'Check irrigation status consistently.',
        },
      },
      { sourceGroup: groupFolder, isMain: true, registeredGroups: {} },
    );

    assert.equal(created.status, 'success');

    const view = await executeSkillAction(
      {
        type: 'skill_action',
        action: 'skill_view',
        requestId: 'view-1',
        params: { groupFolder, name: 'irrigation-check' },
      },
      { sourceGroup: groupFolder, isMain: true, registeredGroups: {} },
    );
    assert.equal(view.status, 'success');

    let report = buildSkillReport(skillsDir);
    assert.equal(report[0]?.source, 'agent');
    assert.equal(report[0]?.frontmatterOk, true);

    const patch = await executeSkillAction(
      {
        type: 'skill_action',
        action: 'skill_patch',
        requestId: 'patch-1',
        params: {
          groupFolder,
          name: 'irrigation-check',
          content: skillMarkdown(
            'irrigation-check',
            'Updated irrigation workflow.',
          ),
        },
      },
      { sourceGroup: groupFolder, isMain: true, registeredGroups: {} },
    );
    assert.equal(patch.status, 'success');

    const archive = await executeSkillAction(
      {
        type: 'skill_action',
        action: 'skill_archive',
        requestId: 'archive-1',
        params: { groupFolder, name: 'irrigation-check' },
      },
      { sourceGroup: groupFolder, isMain: true, registeredGroups: {} },
    );
    assert.equal(archive.status, 'success');
    assert.equal(
      fs.existsSync(path.join(skillsDir, '.archive', 'irrigation-check')),
      true,
    );

    const restore = await executeSkillAction(
      {
        type: 'skill_action',
        action: 'skill_restore',
        requestId: 'restore-1',
        params: { groupFolder, name: 'irrigation-check' },
      },
      { sourceGroup: groupFolder, isMain: true, registeredGroups: {} },
    );
    assert.equal(restore.status, 'success');

    report = buildSkillReport(skillsDir);
    assert.equal(
      report.find((entry) => entry.name === 'irrigation-check')?.usage.state,
      'active',
    );
  } finally {
    fs.rmSync(path.join(process.cwd(), 'data', 'pi', groupFolder), {
      recursive: true,
      force: true,
    });
  }
});

test('source-owned skills are visible but cannot be archived by skill actions', async () => {
  const groupFolder = `skill-test-${Date.now()}`;
  try {
    const skillsDir = path.join(
      process.cwd(),
      'data',
      'pi',
      groupFolder,
      '.pi',
      'skills',
    );
    const sourceSkillDir = path.join(skillsDir, 'source-owned-skill');
    fs.mkdirSync(sourceSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourceSkillDir, 'SKILL.md'),
      skillMarkdown('source-owned-skill'),
    );

    const report = buildSkillReport(skillsDir);
    assert.equal(
      report.find((entry) => entry.name === 'source-owned-skill')?.source,
      'unmanaged',
    );

    const archive = await executeSkillAction(
      {
        type: 'skill_action',
        action: 'skill_archive',
        requestId: 'archive-source',
        params: { groupFolder, name: 'source-owned-skill' },
      },
      { sourceGroup: groupFolder, isMain: true, registeredGroups: {} },
    );
    assert.equal(archive.status, 'error');
    assert.match(archive.error || '', /only agent-created/);
  } finally {
    fs.rmSync(path.join(process.cwd(), 'data', 'pi', groupFolder), {
      recursive: true,
      force: true,
    });
  }
});

test('group folder traversal is rejected before resolving skill paths', async () => {
  assert.throws(
    () => resolveGroupSkillsDir('../../../tmp/escape'),
    /Invalid group folder/,
  );

  const created = await executeSkillAction(
    {
      type: 'skill_action',
      action: 'skill_create',
      requestId: 'create-traversal',
      params: {
        groupFolder: '../../../tmp/escape',
        name: 'escape-skill',
        description: 'should not be written',
      },
    },
    { sourceGroup: 'main', isMain: true, registeredGroups: {} },
  );

  assert.equal(created.status, 'error');
  assert.match(created.error || '', /Invalid group folder/);
});

test('managed manifest overrides stale agent-created usage provenance', async () => {
  const groupFolder = `skill-test-${Date.now()}`;
  try {
    const skillsDir = path.join(
      process.cwd(),
      'data',
      'pi',
      groupFolder,
      '.pi',
      'skills',
    );
    const skillDir = path.join(skillsDir, 'collision-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      skillMarkdown('collision-skill'),
    );
    fs.writeFileSync(
      path.join(skillsDir, '.fft_nano_managed_skills.json'),
      `${JSON.stringify({ managed: ['collision-skill'] }, null, 2)}\n`,
    );
    saveSkillUsage(skillsDir, {
      'collision-skill': {
        created_by: 'agent',
        use_count: 1,
        view_count: 0,
        patch_count: 0,
        last_used_at: '2025-01-01T00:00:00.000Z',
        last_viewed_at: null,
        last_patched_at: null,
        created_at: '2025-01-01T00:00:00.000Z',
        state: 'active',
        pinned: false,
        archived_at: null,
      },
    });

    assert.equal(isAgentCreatedSkill(skillsDir, 'collision-skill'), false);
    const report = buildSkillReport(skillsDir);
    assert.equal(
      report.find((entry) => entry.name === 'collision-skill')?.source,
      'project',
    );

    const patch = await executeSkillAction(
      {
        type: 'skill_action',
        action: 'skill_patch',
        requestId: 'patch-managed-collision',
        params: {
          groupFolder,
          name: 'collision-skill',
          content: skillMarkdown('collision-skill', 'new content'),
        },
      },
      { sourceGroup: groupFolder, isMain: true, registeredGroups: {} },
    );
    assert.equal(patch.status, 'error');
    assert.match(patch.error || '', /only agent-created/);

    const result = applySkillManagerTransitions({
      skillsDir,
      config,
      now: new Date('2026-05-19T00:00:00.000Z'),
    });
    assert.equal(result.checked, 0);
    assert.equal(result.archived, 0);
    assert.equal(fs.existsSync(path.join(skillsDir, 'collision-skill')), true);
  } finally {
    fs.rmSync(path.join(process.cwd(), 'data', 'pi', groupFolder), {
      recursive: true,
      force: true,
    });
  }
});

test('managed manifest source metadata surfaces external skills in reports', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-skill-life-'));
  try {
    const skillsDir = path.join(tempRoot, 'skills');
    const skillDir = path.join(skillsDir, 'personal-workflow');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      skillMarkdown('personal-workflow'),
    );
    fs.writeFileSync(
      path.join(skillsDir, '.fft_nano_managed_skills.json'),
      `${JSON.stringify(
        {
          managed: ['personal-workflow'],
          sources: { 'personal-workflow': 'external' },
        },
        null,
        2,
      )}\n`,
    );

    const report = buildSkillReport(skillsDir);
    assert.equal(
      report.find((entry) => entry.name === 'personal-workflow')?.source,
      'external',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('skill manager transitions archive stale unpinned agent-created skills', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-skill-life-'));
  try {
    const skillsDir = path.join(tempRoot, 'skills');
    const skillDir = path.join(skillsDir, 'old-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      skillMarkdown('old-skill'),
    );
    saveSkillUsage(skillsDir, {
      'old-skill': {
        created_by: 'agent',
        use_count: 1,
        view_count: 0,
        patch_count: 0,
        last_used_at: '2025-01-01T00:00:00.000Z',
        last_viewed_at: null,
        last_patched_at: null,
        created_at: '2025-01-01T00:00:00.000Z',
        state: 'active',
        pinned: false,
        archived_at: null,
      },
    });

    const result = applySkillManagerTransitions({
      skillsDir,
      config,
      now: new Date('2026-05-19T00:00:00.000Z'),
    });
    assert.equal(result.archived, 1);
    assert.equal(
      fs.existsSync(path.join(skillsDir, '.archive', 'old-skill')),
      true,
    );
    assert.equal(loadSkillUsage(skillsDir)['old-skill']?.state, 'archived');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
