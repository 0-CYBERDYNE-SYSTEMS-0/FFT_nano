import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
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
  assert.equal(result.ok, true, result.issues.map((i) => `${i.file}: ${i.message}`).join('\n'));
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
      fs.writeFileSync(path.join(dir, 'SKILL.md'), requiredSkillMarkdown(skillName));
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
    assert.equal(fs.existsSync(path.join(dstSkillsRoot, 'custom-skill', 'SKILL.md')), true);
    assert.equal(fs.existsSync(unmanagedSkill), true);

    fs.rmSync(customSkillDir, { recursive: true, force: true });
    const resSecond = syncProjectPiSkillsToGroupPiHome(projectRoot, groupPiHome);
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
      fs.readFileSync(path.join(dstSkillsRoot, 'fft-debug', 'SKILL.md'), 'utf-8').includes(
        'user override version',
      ),
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
      fs.readFileSync(path.join(dstSkillsRoot, 'fft-debug', 'SKILL.md'), 'utf-8').includes(
        'project version',
      ),
      true,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('non-required project custom skill without sections syncs with warning only', () => {
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
    assert.equal(fs.existsSync(path.join(dstSkillsRoot, 'custom-skill', 'SKILL.md')), true);
    assert.equal(
      res.warnings.some(
        (warning) =>
          warning.file.endsWith(path.join('custom-skill', 'SKILL.md')) &&
          warning.message.includes('When to use'),
      ),
      true,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
