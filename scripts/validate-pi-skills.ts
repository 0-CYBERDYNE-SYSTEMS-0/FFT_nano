#!/usr/bin/env -S npx tsx
import path from 'path';

import { validateProjectPiSkills } from '../src/pi-skills.js';

const projectRoot = process.cwd();
const result = validateProjectPiSkills(projectRoot);

if (result.ok) {
  console.log(
    `Pi skill validation passed for ${path.join(projectRoot, '.pi', 'skills')}`,
  );
  process.exit(0);
}

console.error('Pi skill validation failed:');
for (const issue of result.issues) {
  console.error(`- ${issue.file}: ${issue.message}`);
}
process.exit(1);
