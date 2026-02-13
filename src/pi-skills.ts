import fs from 'fs';
import path from 'path';

export const PROJECT_PI_SKILLS_RELATIVE_DIR = path.join('.pi', 'skills');
export const REQUIRED_PROJECT_PI_SKILLS = [
  'fft-setup',
  'fft-debug',
  'fft-telegram-ops',
  'fft-coder-ops',
  'fft-farm-ops',
  'fft-dashboard-ops',
] as const;

export interface SkillValidationIssue {
  file: string;
  message: string;
}

export interface SkillValidationResult {
  ok: boolean;
  issues: SkillValidationIssue[];
}

export interface SkillSyncResult {
  sourceDirExists: boolean;
  copied: string[];
  removed: string[];
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(content: string): Record<string, string> | null {
  if (!content.startsWith('---\n')) return null;
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) return null;

  const yaml = content.slice(4, end);
  const out: Record<string, string> = {};

  for (const rawLine of yaml.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = stripQuotes(line.slice(sep + 1));
    if (!key) continue;
    out[key] = value;
  }

  return out;
}

function validateSkillMarkdown(
  expectedSkillName: string,
  skillMarkdownPath: string,
): SkillValidationIssue[] {
  const issues: SkillValidationIssue[] = [];

  if (!fs.existsSync(skillMarkdownPath)) {
    issues.push({ file: skillMarkdownPath, message: 'Missing SKILL.md' });
    return issues;
  }

  const content = fs.readFileSync(skillMarkdownPath, 'utf-8');
  const frontmatter = parseFrontmatter(content);

  if (!frontmatter) {
    issues.push({
      file: skillMarkdownPath,
      message: 'SKILL.md must begin with valid YAML frontmatter delimited by ---',
    });
    return issues;
  }

  if (!frontmatter.name) {
    issues.push({
      file: skillMarkdownPath,
      message: 'Frontmatter missing required field: name',
    });
  } else if (frontmatter.name !== expectedSkillName) {
    issues.push({
      file: skillMarkdownPath,
      message: `Frontmatter name (${frontmatter.name}) does not match folder (${expectedSkillName})`,
    });
  }

  if (!frontmatter.description) {
    issues.push({
      file: skillMarkdownPath,
      message: 'Frontmatter missing required field: description',
    });
  }

  if (!/never (?:run|use) destructive git commands/i.test(content)) {
    issues.push({
      file: skillMarkdownPath,
      message:
        'Skill guardrail missing: "never run destructive git commands"',
    });
  }

  if (!/preserve unrelated worktree changes/i.test(content)) {
    issues.push({
      file: skillMarkdownPath,
      message:
        'Skill guardrail missing: "preserve unrelated worktree changes"',
    });
  }

  if (
    !/main(?:\s+chat)?(?:\/?admin)?(?:\s|-)?only|main\/admin chat/i.test(
      content,
    )
  ) {
    issues.push({
      file: skillMarkdownPath,
      message:
        'Skill guardrail missing main-chat-only admin/delegation constraint',
    });
  }

  return issues;
}

export function validateProjectPiSkills(
  projectRoot: string = process.cwd(),
): SkillValidationResult {
  const issues: SkillValidationIssue[] = [];
  const skillsRoot = path.join(projectRoot, PROJECT_PI_SKILLS_RELATIVE_DIR);

  for (const skillName of REQUIRED_PROJECT_PI_SKILLS) {
    const skillPath = path.join(skillsRoot, skillName);
    if (!fs.existsSync(skillPath) || !fs.statSync(skillPath).isDirectory()) {
      issues.push({
        file: skillPath,
        message: 'Missing required skill directory',
      });
      continue;
    }

    const skillMarkdownPath = path.join(skillPath, 'SKILL.md');
    issues.push(...validateSkillMarkdown(skillName, skillMarkdownPath));
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function syncProjectPiSkillsToGroupPiHome(
  projectRoot: string,
  groupPiHomeDir: string,
  skillPrefix = 'fft-',
): SkillSyncResult {
  const sourceRoot = path.join(projectRoot, PROJECT_PI_SKILLS_RELATIVE_DIR);
  const result: SkillSyncResult = {
    sourceDirExists: false,
    copied: [],
    removed: [],
  };

  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    return result;
  }

  result.sourceDirExists = true;

  const skillDirs = fs
    .readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(skillPrefix));

  if (skillDirs.length === 0) {
    return result;
  }

  const destRoot = path.join(groupPiHomeDir, 'skills');
  fs.mkdirSync(destRoot, { recursive: true });

  const sourceSet = new Set(skillDirs);
  for (const entry of fs.readdirSync(destRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith(skillPrefix)) continue;
    if (sourceSet.has(entry.name)) continue;

    fs.rmSync(path.join(destRoot, entry.name), { recursive: true, force: true });
    result.removed.push(entry.name);
  }

  for (const skillName of skillDirs) {
    const source = path.join(sourceRoot, skillName);
    const dest = path.join(destRoot, skillName);

    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(source, dest, { recursive: true });
    result.copied.push(skillName);
  }

  return result;
}
