import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildSkillCatalogEntries,
  REQUIRED_PROJECT_PI_SKILLS,
  resolveProjectRuntimeSkillsDir,
  syncProjectPiSkillsToGroupPiHome,
  validateProjectPiSkills,
} from '../src/pi-skills.js';

function requiredSkillMarkdown(skillName: string, marker: string = ''): string {
  return `---\nname: ${skillName}\ndescription: test\n---\n\n# ${skillName}\n\n## When to use this skill\n\n- Use for test coverage.\n\n## When not to use this skill\n\n- Do not use outside test coverage.\n\n## Guardrails\n\n- Never run destructive git commands unless explicitly requested.\n- Preserve unrelated worktree changes.\n- Main/admin chat only for privileged actions.\n\n${marker}\n`;
}

test('project Pi skills validate required frontmatter and guardrails', () => {
  const result = validateProjectPiSkills(process.cwd());
  assert.equal(
    result.ok,
    true,
    result.issues.map((i) => `${i.file}: ${i.message}`).join('\n'),
  );
  assert.equal(result.issues.length, 0);
});

test('resolveProjectRuntimeSkillsDir resolves skills/runtime', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-pi-skills-'));

  try {
    const projectRoot = path.join(tempRoot, 'project');
    const runtimeRoot = path.join(projectRoot, 'skills', 'runtime');
    fs.mkdirSync(runtimeRoot, { recursive: true });

    const resolved = resolveProjectRuntimeSkillsDir(projectRoot);
    assert.equal(resolved, runtimeRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('syncProjectPiSkillsToGroupPiHome mirrors runtime skills and prunes stale managed skills', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-pi-skills-'));

  try {
    const projectRoot = path.join(tempRoot, 'project');
    const groupPiHome = path.join(tempRoot, 'group-home', '.pi');
    const srcSkillsRoot = path.join(projectRoot, 'skills', 'runtime');
    const dstSkillsRoot = path.join(groupPiHome, 'skills');
    const unmanagedSkill = path.join(dstSkillsRoot, 'manually-installed-skill');

    fs.mkdirSync(srcSkillsRoot, { recursive: true });
    fs.mkdirSync(dstSkillsRoot, { recursive: true });
    fs.mkdirSync(unmanagedSkill, { recursive: true });

    for (const skillName of REQUIRED_PROJECT_PI_SKILLS) {
      const dir = path.join(srcSkillsRoot, skillName);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'SKILL.md'),
        requiredSkillMarkdown(skillName),
      );
    }

    // Additional runtime skills should be mirrored even without fft-* prefix.
    const customSkillDir = path.join(srcSkillsRoot, 'custom-skill');
    fs.mkdirSync(customSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(customSkillDir, 'SKILL.md'),
      '---\nname: custom-skill\ndescription: test\n---\n\n# custom\n',
    );

    const res = syncProjectPiSkillsToGroupPiHome(projectRoot, groupPiHome);

    assert.equal(res.sourceDirExists, true);
    assert.ok(res.copied.includes('fft-setup'));
    assert.ok(res.copied.includes('custom-skill'));
    assert.equal(res.removed.length, 0);
    assert.equal(
      fs.existsSync(path.join(dstSkillsRoot, 'custom-skill', 'SKILL.md')),
      true,
    );
    assert.equal(fs.existsSync(unmanagedSkill), true);

    fs.rmSync(customSkillDir, { recursive: true, force: true });
    const resSecond = syncProjectPiSkillsToGroupPiHome(
      projectRoot,
      groupPiHome,
    );
    assert.ok(resSecond.removed.includes('custom-skill'));
    assert.equal(
      fs.existsSync(path.join(dstSkillsRoot, 'custom-skill')),
      false,
      'stale managed skill should be removed',
    );
    assert.equal(
      fs.existsSync(unmanagedSkill),
      true,
      'unmanaged destination skills should be preserved',
    );

    for (const skillName of REQUIRED_PROJECT_PI_SKILLS) {
      assert.equal(
        fs.existsSync(path.join(dstSkillsRoot, skillName, 'SKILL.md')),
        true,
        `expected ${skillName} to be synced`,
      );
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('main workspace skill source can override project runtime skill', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-pi-skills-'));

  try {
    const projectRoot = path.join(tempRoot, 'project');
    const groupPiHome = path.join(tempRoot, 'group-home', '.pi');
    const projectSkillsRoot = path.join(projectRoot, 'skills', 'runtime');
    const userSkillsRoot = path.join(tempRoot, 'user', 'skills');
    const dstSkillsRoot = path.join(groupPiHome, 'skills');

    fs.mkdirSync(projectSkillsRoot, { recursive: true });
    fs.mkdirSync(userSkillsRoot, { recursive: true });
    fs.mkdirSync(dstSkillsRoot, { recursive: true });

    const projectSkillDir = path.join(projectSkillsRoot, 'fft-debug');
    fs.mkdirSync(projectSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectSkillDir, 'SKILL.md'),
      requiredSkillMarkdown('fft-debug', 'project version'),
    );

    const userOverrideSkillDir = path.join(userSkillsRoot, 'fft-debug');
    fs.mkdirSync(userOverrideSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(userOverrideSkillDir, 'SKILL.md'),
      requiredSkillMarkdown('fft-debug', 'user override version'),
    );

    const userSkillDir = path.join(userSkillsRoot, 'field-inspector');
    fs.mkdirSync(userSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(userSkillDir, 'SKILL.md'),
      '---\nname: field-inspector\ndescription: user\n---\n\nuser-only skill\n',
    );

    const res = syncProjectPiSkillsToGroupPiHome(projectRoot, groupPiHome, {
      additionalSkillSourceDirs: [userSkillsRoot],
    });

    assert.equal(res.sourceDirExists, true);
    assert.ok(res.copied.includes('fft-debug'));
    assert.ok(res.copied.includes('field-inspector'));
    assert.equal(
      fs
        .readFileSync(
          path.join(dstSkillsRoot, 'fft-debug', 'SKILL.md'),
          'utf-8',
        )
        .includes('user override version'),
      true,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('invalid external override falls back to valid project required skill', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-pi-skills-'));

  try {
    const projectRoot = path.join(tempRoot, 'project');
    const groupPiHome = path.join(tempRoot, 'group-home', '.pi');
    const projectSkillsRoot = path.join(projectRoot, 'skills', 'runtime');
    const userSkillsRoot = path.join(tempRoot, 'user', 'skills');
    const dstSkillsRoot = path.join(groupPiHome, 'skills');

    fs.mkdirSync(projectSkillsRoot, { recursive: true });
    fs.mkdirSync(userSkillsRoot, { recursive: true });
    fs.mkdirSync(dstSkillsRoot, { recursive: true });

    const projectSkillDir = path.join(projectSkillsRoot, 'fft-debug');
    fs.mkdirSync(projectSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectSkillDir, 'SKILL.md'),
      requiredSkillMarkdown('fft-debug', 'project version'),
    );

    const invalidOverrideSkillDir = path.join(userSkillsRoot, 'fft-debug');
    fs.mkdirSync(invalidOverrideSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(invalidOverrideSkillDir, 'SKILL.md'),
      '---\nname: fft-debug\ndescription: user override\n---\n\n# fft-debug\n',
    );

    const res = syncProjectPiSkillsToGroupPiHome(projectRoot, groupPiHome, {
      additionalSkillSourceDirs: [userSkillsRoot],
    });

    assert.equal(res.sourceDirExists, true);
    assert.ok(res.copied.includes('fft-debug'));
    assert.equal(res.skippedInvalid.includes('fft-debug'), false);
    assert.equal(
      fs
        .readFileSync(
          path.join(dstSkillsRoot, 'fft-debug', 'SKILL.md'),
          'utf-8',
        )
        .includes('project version'),
      true,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('non-required project custom skill without section headings syncs without warnings', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-pi-skills-'));

  try {
    const projectRoot = path.join(tempRoot, 'project');
    const groupPiHome = path.join(tempRoot, 'group-home', '.pi');
    const srcSkillsRoot = path.join(projectRoot, 'skills', 'runtime');
    const dstSkillsRoot = path.join(groupPiHome, 'skills');

    fs.mkdirSync(srcSkillsRoot, { recursive: true });
    fs.mkdirSync(dstSkillsRoot, { recursive: true });

    const customSkillDir = path.join(srcSkillsRoot, 'custom-skill');
    fs.mkdirSync(customSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(customSkillDir, 'SKILL.md'),
      '---\nname: custom-skill\ndescription: test\n---\n\n# custom\n',
    );

    const res = syncProjectPiSkillsToGroupPiHome(projectRoot, groupPiHome);

    assert.equal(res.sourceDirExists, true);
    assert.ok(res.copied.includes('custom-skill'));
    assert.equal(res.skippedInvalid.includes('custom-skill'), false);
    assert.equal(
      fs.existsSync(path.join(dstSkillsRoot, 'custom-skill', 'SKILL.md')),
      true,
    );
    assert.equal(res.warnings.length, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('personal skill validation accepts common frontmatter fields and loose descriptions', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-pi-skills-'));

  try {
    const projectRoot = path.join(tempRoot, 'project');
    const groupPiHome = path.join(tempRoot, 'group-home', '.pi');
    const projectSkillsRoot = path.join(projectRoot, 'skills', 'runtime');
    const userSkillsRoot = path.join(tempRoot, 'user', 'skills');

    fs.mkdirSync(projectSkillsRoot, { recursive: true });
    fs.mkdirSync(userSkillsRoot, { recursive: true });

    const looseSkillDir = path.join(userSkillsRoot, 'loose-skill');
    fs.mkdirSync(looseSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(looseSkillDir, 'SKILL.md'),
      [
        '---',
        'name: loose-skill',
        'description: Works with colons: this used to fail YAML parsing',
        'version: 1.0.0',
        'category: test',
        'disable-model-invocation: true',
        '---',
        '',
        '# Loose Skill',
      ].join('\n'),
    );

    const metadataSkillDir = path.join(userSkillsRoot, 'metadata-skill');
    fs.mkdirSync(metadataSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(metadataSkillDir, 'SKILL.md'),
      [
        '---',
        'name: metadata-skill',
        'description: test',
        'metadata:',
        '  hermes:',
        '    tags: [one, two]',
        '---',
        '',
        '# Metadata Skill',
      ].join('\n'),
    );

    const res = syncProjectPiSkillsToGroupPiHome(projectRoot, groupPiHome, {
      additionalSkillSourceDirs: [userSkillsRoot],
    });

    assert.equal(res.skippedInvalid.includes('loose-skill'), false);
    assert.equal(res.skippedInvalid.includes('metadata-skill'), false);
    assert.ok(res.copied.includes('loose-skill'));
    assert.ok(res.copied.includes('metadata-skill'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('skill path safety ignores embedded implementation dependency directories', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-pi-skills-'));

  try {
    const projectRoot = path.join(tempRoot, 'project');
    const groupPiHome = path.join(tempRoot, 'group-home', '.pi');
    const userSkillsRoot = path.join(tempRoot, 'user', 'skills');
    const skillDir = path.join(userSkillsRoot, 'browser-harness');
    const venvBin = path.join(skillDir, '.venv', 'bin');

    fs.mkdirSync(venvBin, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: browser-harness\ndescription: test\n---\n\n# Browser Harness\n',
    );
    fs.symlinkSync('/usr/bin/python3', path.join(venvBin, 'python3'));

    const res = syncProjectPiSkillsToGroupPiHome(projectRoot, groupPiHome, {
      additionalSkillSourceDirs: [userSkillsRoot],
    });

    assert.equal(res.skippedInvalid.includes('browser-harness'), false);
    assert.ok(res.copied.includes('browser-harness'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('high-risk non-required skill without non-use guidance warns but still syncs', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-pi-skills-'));

  try {
    const projectRoot = path.join(tempRoot, 'project');
    const groupPiHome = path.join(tempRoot, 'group-home', '.pi');
    const srcSkillsRoot = path.join(projectRoot, 'skills', 'runtime');
    const dstSkillsRoot = path.join(groupPiHome, 'skills');

    fs.mkdirSync(srcSkillsRoot, { recursive: true });
    fs.mkdirSync(dstSkillsRoot, { recursive: true });

    const customSkillDir = path.join(srcSkillsRoot, 'deploy-helper');
    fs.mkdirSync(customSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(customSkillDir, 'SKILL.md'),
      '---\nname: deploy-helper\ndescription: Deploy runtime components safely. Use when deploying services.\n---\n\n# Deploy Helper\n',
    );

    const res = syncProjectPiSkillsToGroupPiHome(projectRoot, groupPiHome);

    assert.equal(res.sourceDirExists, true);
    assert.ok(res.copied.includes('deploy-helper'));
    assert.equal(res.skippedInvalid.includes('deploy-helper'), false);
    assert.equal(
      fs.existsSync(path.join(dstSkillsRoot, 'deploy-helper', 'SKILL.md')),
      true,
    );
    assert.equal(
      res.warnings.some(
        (warning) =>
          warning.file.endsWith(path.join('deploy-helper', 'SKILL.md')) &&
          warning.message.includes('when not to use'),
      ),
      true,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('high-risk non-required skill with explicit non-use guidance does not warn', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-pi-skills-'));

  try {
    const projectRoot = path.join(tempRoot, 'project');
    const groupPiHome = path.join(tempRoot, 'group-home', '.pi');
    const srcSkillsRoot = path.join(projectRoot, 'skills', 'runtime');

    fs.mkdirSync(srcSkillsRoot, { recursive: true });

    const customSkillDir = path.join(srcSkillsRoot, 'deploy-helper');
    fs.mkdirSync(customSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(customSkillDir, 'SKILL.md'),
      '---\nname: deploy-helper\ndescription: Deploy runtime components safely. Use when deploying services. Do not use for incident triage or debugging.\n---\n\n# Deploy Helper\n',
    );

    const res = syncProjectPiSkillsToGroupPiHome(projectRoot, groupPiHome);

    assert.ok(res.copied.includes('deploy-helper'));
    assert.equal(
      res.warnings.some((warning) =>
        warning.file.endsWith(path.join('deploy-helper', 'SKILL.md')),
      ),
      false,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('buildSkillCatalogEntries returns compact summaries without full skill bodies', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-skill-catalog-'));

  try {
    const skillsRoot = path.join(tempRoot, 'skills');
    const skillDir = path.join(skillsRoot, 'fft-debug');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      requiredSkillMarkdown(
        'fft-debug',
        'Long body text that should never be emitted as a full skill body.\n'.repeat(
          10,
        ),
      ),
    );

    const catalog = buildSkillCatalogEntries([skillsRoot], { maxChars: 6000 });
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0]?.name, 'fft-debug');
    assert.match(catalog[0]?.whenToUse || '', /test coverage/i);
    assert.doesNotMatch(catalog[0]?.whenToUse || '', /Long body text/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('buildSkillCatalogEntries parses string allowed-tools frontmatter', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-skill-catalog-'));

  try {
    const skillsRoot = path.join(tempRoot, 'skills');
    const commaSkillDir = path.join(skillsRoot, 'comma-tools');
    const spaceSkillDir = path.join(skillsRoot, 'space-tools');
    fs.mkdirSync(commaSkillDir, { recursive: true });
    fs.mkdirSync(spaceSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(commaSkillDir, 'SKILL.md'),
      [
        '---',
        'name: comma-tools',
        'description: test',
        'allowed-tools: Read, Grep, Glob',
        '---',
        '',
        '# Comma Tools',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(spaceSkillDir, 'SKILL.md'),
      [
        '---',
        'name: space-tools',
        'description: test',
        'allowed-tools: read_file ddgs_search',
        '---',
        '',
        '# Space Tools',
      ].join('\n'),
    );

    const catalog = buildSkillCatalogEntries([skillsRoot], { maxChars: 6000 });
    assert.deepEqual(
      catalog.find((entry) => entry.name === 'comma-tools')?.allowedTools,
      ['Read', 'Grep', 'Glob'],
    );
    assert.deepEqual(
      catalog.find((entry) => entry.name === 'space-tools')?.allowedTools,
      ['read_file', 'ddgs_search'],
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('buildSkillCatalogEntries marks agent-created runtime skills from usage sidecar', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-skill-catalog-'));

  try {
    const skillsRoot = path.join(tempRoot, 'skills');
    const skillDir = path.join(skillsRoot, 'field-note-cleanup');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: field-note-cleanup\ndescription: Keep field notes organized.\n---\n\n# field note cleanup\n',
    );
    fs.writeFileSync(
      path.join(skillsRoot, '.usage.json'),
      JSON.stringify(
        {
          'field-note-cleanup': {
            created_by: 'agent',
            use_count: 1,
            view_count: 0,
            patch_count: 0,
            created_at: '2026-05-19T00:00:00.000Z',
            last_used_at: '2026-05-19T00:00:00.000Z',
            last_viewed_at: null,
            last_patched_at: null,
            state: 'active',
            pinned: false,
            archived_at: null,
          },
        },
        null,
        2,
      ),
    );

    const catalog = buildSkillCatalogEntries([skillsRoot], { maxChars: 6000 });
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0]?.name, 'field-note-cleanup');
    assert.equal(catalog[0]?.source, 'agent');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('synced external skills retain external source metadata for catalog entries', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-pi-skills-'));

  try {
    const projectRoot = path.join(tempRoot, 'project');
    const groupPiHome = path.join(tempRoot, 'group-home', '.pi');
    const userSkillsRoot = path.join(tempRoot, 'user', 'skills');
    const dstSkillsRoot = path.join(groupPiHome, 'skills');
    const externalSkillDir = path.join(userSkillsRoot, 'field-inspector');

    fs.mkdirSync(externalSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(externalSkillDir, 'SKILL.md'),
      '---\nname: field-inspector\ndescription: user skill\n---\n\n# Field Inspector\n',
    );

    const res = syncProjectPiSkillsToGroupPiHome(projectRoot, groupPiHome, {
      additionalSkillSourceDirs: [userSkillsRoot],
    });

    assert.ok(res.copied.includes('field-inspector'));
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(dstSkillsRoot, '.fft_nano_managed_skills.json'),
        'utf-8',
      ),
    );
    assert.equal(manifest.sources['field-inspector'], 'external');

    const catalog = buildSkillCatalogEntries([dstSkillsRoot], {
      maxChars: 6000,
    });
    assert.equal(
      catalog.find((entry) => entry.name === 'field-inspector')?.source,
      'external',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('buildSkillCatalogEntries treats managed skills as project-owned despite stale agent usage', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-skill-catalog-'));

  try {
    const skillsRoot = path.join(tempRoot, 'skills');
    const skillDir = path.join(skillsRoot, 'field-note-cleanup');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: field-note-cleanup\ndescription: Keep field notes organized.\n---\n\n# field note cleanup\n',
    );
    fs.writeFileSync(
      path.join(skillsRoot, '.fft_nano_managed_skills.json'),
      `${JSON.stringify({ managed: ['field-note-cleanup'] }, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(skillsRoot, '.usage.json'),
      JSON.stringify(
        {
          'field-note-cleanup': {
            created_by: 'agent',
            use_count: 1,
            view_count: 0,
            patch_count: 0,
            created_at: '2026-05-19T00:00:00.000Z',
            last_used_at: '2026-05-19T00:00:00.000Z',
            last_viewed_at: null,
            last_patched_at: null,
            state: 'active',
            pinned: false,
            archived_at: null,
          },
        },
        null,
        2,
      ),
    );

    const catalog = buildSkillCatalogEntries([skillsRoot], { maxChars: 6000 });
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0]?.name, 'field-note-cleanup');
    assert.equal(catalog[0]?.source, 'project');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('sync skips skill sources that contain symlinks', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-pi-skills-'));

  try {
    const projectRoot = path.join(tempRoot, 'project');
    const groupPiHome = path.join(tempRoot, 'group-home', '.pi');
    const srcSkillsRoot = path.join(projectRoot, 'skills', 'runtime');
    const dstSkillsRoot = path.join(groupPiHome, 'skills');
    const externalFile = path.join(tempRoot, 'outside.txt');

    fs.mkdirSync(srcSkillsRoot, { recursive: true });
    fs.mkdirSync(dstSkillsRoot, { recursive: true });
    fs.writeFileSync(externalFile, 'outside');

    const customSkillDir = path.join(srcSkillsRoot, 'custom-skill');
    fs.mkdirSync(customSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(customSkillDir, 'SKILL.md'),
      '---\nname: custom-skill\ndescription: test\n---\n\n# custom\n\n## When to use this skill\n\n- test\n',
    );
    const symlinkPath = path.join(customSkillDir, 'outside-link.txt');
    try {
      fs.symlinkSync(externalFile, symlinkPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (process.platform === 'win32') {
        assert.match(message, /EPERM|operation not permitted|privilege/i);
        return;
      }
      throw err;
    }

    const res = syncProjectPiSkillsToGroupPiHome(projectRoot, groupPiHome);

    assert.equal(res.copied.includes('custom-skill'), false);
    assert.ok(res.skippedInvalid.includes('custom-skill'));
    assert.equal(
      fs.existsSync(path.join(dstSkillsRoot, 'custom-skill')),
      false,
    );
    assert.equal(
      res.invalid.some(
        (issue) =>
          issue.file.endsWith(path.join('custom-skill', 'outside-link.txt')) &&
          issue.message.includes('symbolic links'),
      ),
      true,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('invalid symlink override falls back to valid project required skill', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-pi-skills-'));

  try {
    const projectRoot = path.join(tempRoot, 'project');
    const groupPiHome = path.join(tempRoot, 'group-home', '.pi');
    const projectSkillsRoot = path.join(projectRoot, 'skills', 'runtime');
    const userSkillsRoot = path.join(tempRoot, 'user', 'skills');
    const dstSkillsRoot = path.join(groupPiHome, 'skills');
    const externalFile = path.join(tempRoot, 'outside.txt');

    fs.mkdirSync(projectSkillsRoot, { recursive: true });
    fs.mkdirSync(userSkillsRoot, { recursive: true });
    fs.mkdirSync(dstSkillsRoot, { recursive: true });
    fs.writeFileSync(externalFile, 'outside');

    const projectSkillDir = path.join(projectSkillsRoot, 'fft-debug');
    fs.mkdirSync(projectSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectSkillDir, 'SKILL.md'),
      requiredSkillMarkdown('fft-debug', 'project version'),
    );

    const overrideSkillDir = path.join(userSkillsRoot, 'fft-debug');
    fs.mkdirSync(overrideSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(overrideSkillDir, 'SKILL.md'),
      requiredSkillMarkdown('fft-debug', 'external version'),
    );
    const symlinkPath = path.join(overrideSkillDir, 'outside-link.txt');
    try {
      fs.symlinkSync(externalFile, symlinkPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (process.platform === 'win32') {
        assert.match(message, /EPERM|operation not permitted|privilege/i);
        return;
      }
      throw err;
    }

    const res = syncProjectPiSkillsToGroupPiHome(projectRoot, groupPiHome, {
      additionalSkillSourceDirs: [userSkillsRoot],
    });

    assert.ok(res.copied.includes('fft-debug'));
    assert.equal(
      fs
        .readFileSync(
          path.join(dstSkillsRoot, 'fft-debug', 'SKILL.md'),
          'utf-8',
        )
        .includes('project version'),
      true,
    );
    assert.equal(res.skippedInvalid.includes('fft-debug'), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
