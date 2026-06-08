#!/usr/bin/env -S npx tsx
import fs from 'fs';
import os from 'os';
import path from 'path';

import { validatePiSkillsSourceDir } from '../src/pi-skills.js';

const explicitSkillsRoot = process.argv[2];
const skillsRoot =
  explicitSkillsRoot ??
  path.join(
    process.env.FFT_NANO_MAIN_WORKSPACE_DIR || path.join(os.homedir(), 'nano'),
    'skills',
  );

if (!fs.existsSync(skillsRoot)) {
  console.log(`Personal Pi skills directory not found: ${skillsRoot}`);
  process.exit(0);
}

const result = validatePiSkillsSourceDir(skillsRoot);

if (result.ok) {
  console.log(`Personal Pi skill validation passed for ${skillsRoot}`);
  if (result.warnings.length > 0) {
    console.warn('Personal Pi skill validation warnings:');
    for (const warning of result.warnings) {
      console.warn(`- ${warning.file}: ${warning.message}`);
    }
  }
  process.exit(0);
}

console.error('Personal Pi skill validation failed:');
for (const issue of result.issues) {
  console.error(`- ${issue.file}: ${issue.message}`);
}
process.exit(1);
