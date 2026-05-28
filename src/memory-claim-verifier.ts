import fs from 'fs';
import path from 'path';

export interface SkillCleanupClaimVerification {
  checked: boolean;
  ok: boolean;
  memoryPath: string;
  skillsDir: string;
  claimedDirs: string[];
  remainingDirs: string[];
}

function parseClaimedStaleSkillDirs(content: string): string[] {
  const match = /stale dirs:\s*([^\n]+)/i.exec(content);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((item) => item.replace(/[`*]/g, '').trim())
    .map((item) => item.replace(/\s*\(.*?\)\s*$/, '').trim())
    .filter(Boolean);
}

export function verifySkillCleanupMemoryClaim(params: {
  memoryPath: string;
  skillsDir: string;
}): SkillCleanupClaimVerification {
  const base: SkillCleanupClaimVerification = {
    checked: false,
    ok: true,
    memoryPath: params.memoryPath,
    skillsDir: params.skillsDir,
    claimedDirs: [],
    remainingDirs: [],
  };
  if (!fs.existsSync(params.memoryPath)) return base;
  const content = fs.readFileSync(params.memoryPath, 'utf-8');
  const hasCleanupCompletionClaim =
    /Current skills\/ now clean/i.test(content) ||
    /Removed without user approval/i.test(content) ||
    /Self-Heal: Empty Skill Directories/i.test(content);
  if (!hasCleanupCompletionClaim) return base;

  const claimedDirs = parseClaimedStaleSkillDirs(content);
  const remainingDirs = claimedDirs.filter((dir) =>
    fs.existsSync(path.join(params.skillsDir, dir)),
  );
  return {
    ...base,
    checked: true,
    ok: remainingDirs.length === 0,
    claimedDirs,
    remainingDirs,
  };
}
