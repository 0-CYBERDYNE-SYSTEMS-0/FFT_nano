#!/usr/bin/env -S npx tsx
import path from 'path';

import {
  resolveProjectRuntimeSkillsDir,
  validateProjectPiSkills,
} from '../src/pi-skills.js';

const projectRoot = process.cwd();
const result = validateProjectPiSkills(projectRoot);

if (result.ok) {
  const skillsRoot = resolveProjectRuntimeSkillsDir(projectRoot);
  console.log(
    `Pi skill validation passed for ${path.relative(projectRoot, skillsRoot) || '.'}`,
  );
  process.exit(0);
}

console.error('Pi skill validation failed:');
for (const issue of result.issues) {
  console.error(`- ${issue.file}: ${issue.message}`);
}
process.exit(1);
