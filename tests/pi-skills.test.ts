import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  REQUIRED_PROJECT_PI_SKILLS,
  syncProjectPiSkillsToGroupPiHome,
  validateProjectPiSkills,
} from '../src/pi-skills.js';

test('project Pi skills validate required frontmatter and guardrails', () => {
  const result = validateProjectPiSkills(process.cwd());
  assert.equal(result.ok, true, result.issues.map((i) => `${i.file}: ${i.message}`).join('\n'));
  assert.equal(result.issues.length, 0);
});

test('syncProjectPiSkillsToGroupPiHome mirrors project fft-* skills into group Pi home', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-pi-skills-'));

  try {
    const projectRoot = path.join(tempRoot, 'project');
    const groupPiHome = path.join(tempRoot, 'group-home', '.pi');
    const srcSkillsRoot = path.join(projectRoot, '.pi', 'skills');
    const dstSkillsRoot = path.join(groupPiHome, 'skills');

    fs.mkdirSync(srcSkillsRoot, { recursive: true });
    fs.mkdirSync(dstSkillsRoot, { recursive: true });

    for (const skillName of REQUIRED_PROJECT_PI_SKILLS) {
      const dir = path.join(srcSkillsRoot, skillName);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'SKILL.md'),
        `---\nname: ${skillName}\ndescription: test\n---\n\n# ${skillName}\n`,
      );
    }

    // Non FFT skill should not be copied by the sync routine.
    fs.mkdirSync(path.join(srcSkillsRoot, 'custom-skill'), { recursive: true });

    // Stale FFT skill should be removed from destination.
    fs.mkdirSync(path.join(dstSkillsRoot, 'fft-stale'), { recursive: true });

    const res = syncProjectPiSkillsToGroupPiHome(projectRoot, groupPiHome);

    assert.equal(res.sourceDirExists, true);
    assert.ok(res.copied.includes('fft-setup'));
    assert.ok(res.removed.includes('fft-stale'));

    for (const skillName of REQUIRED_PROJECT_PI_SKILLS) {
      assert.equal(
        fs.existsSync(path.join(dstSkillsRoot, skillName, 'SKILL.md')),
        true,
        `expected ${skillName} to be synced`,
      );
    }

    assert.equal(
      fs.existsSync(path.join(dstSkillsRoot, 'custom-skill')),
      false,
      'non fft-* skills should not be mirrored',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
