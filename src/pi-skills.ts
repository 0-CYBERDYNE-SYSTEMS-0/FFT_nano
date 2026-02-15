import fs from 'fs';
import path from 'path';

export const PROJECT_RUNTIME_SKILLS_RELATIVE_DIR_CANDIDATES = [
  path.join('skills', 'runtime'),
] as const;
export const PROJECT_SETUP_SKILLS_RELATIVE_DIR_CANDIDATES = [
  path.join('skills', 'setup'),
] as const;
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
  sourceDirs: string[];
  copied: string[];
  removed: string[];
  managed: string[];
}

export interface SkillSyncOptions {
  projectRuntimeSkillDirCandidates?: string[];
  additionalSkillSourceDirs?: string[];
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

function isDirectory(dirPath: string): boolean {
  return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
}

function resolveExistingSkillDirs(
  projectRoot: string,
  candidates: readonly string[],
): string[] {
  const out: string[] = [];
  for (const relativeDir of candidates) {
    const absoluteDir = path.join(projectRoot, relativeDir);
    if (!isDirectory(absoluteDir)) continue;
    out.push(absoluteDir);
  }
  return out;
}

function listSkillDirectories(sourceRoot: string): string[] {
  if (!isDirectory(sourceRoot)) return [];
  return fs
    .readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('.'))
    .filter((name) =>
      fs.existsSync(path.join(sourceRoot, name, 'SKILL.md')),
    );
}

function readManagedSkillNames(manifestPath: string): string[] {
  if (!fs.existsSync(manifestPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
      managed?: unknown;
    };
    if (!Array.isArray(parsed.managed)) return [];
    return parsed.managed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

function writeManagedSkillNames(manifestPath: string, managed: string[]): void {
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        managed: Array.from(new Set(managed)).sort(),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

function hasAllRequiredProjectSkills(skillsRoot: string): boolean {
  for (const skillName of REQUIRED_PROJECT_PI_SKILLS) {
    if (!isDirectory(path.join(skillsRoot, skillName))) return false;
  }
  return true;
}

export function resolveProjectRuntimeSkillsDir(
  projectRoot: string = process.cwd(),
): string {
  const existing = resolveExistingSkillDirs(
    projectRoot,
    PROJECT_RUNTIME_SKILLS_RELATIVE_DIR_CANDIDATES,
  );
  for (const sourceDir of existing) {
    if (hasAllRequiredProjectSkills(sourceDir)) return sourceDir;
  }
  for (const sourceDir of existing) {
    if (listSkillDirectories(sourceDir).length > 0) return sourceDir;
  }
  if (existing[0]) return existing[0];
  return path.join(projectRoot, PROJECT_RUNTIME_SKILLS_RELATIVE_DIR_CANDIDATES[0]);
}

export function validateProjectPiSkills(
  projectRoot: string = process.cwd(),
): SkillValidationResult {
  const issues: SkillValidationIssue[] = [];
  const skillsRoot = resolveProjectRuntimeSkillsDir(projectRoot);

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
  options: SkillSyncOptions = {},
): SkillSyncResult {
  const result: SkillSyncResult = {
    sourceDirExists: false,
    sourceDirs: [],
    copied: [],
    removed: [],
    managed: [],
  };
  const sourceDirs: string[] = [];
  const sourceDirSet = new Set<string>();
  const projectCandidates =
    options.projectRuntimeSkillDirCandidates ??
    Array.from(PROJECT_RUNTIME_SKILLS_RELATIVE_DIR_CANDIDATES);
  const projectSourceDirs = resolveExistingSkillDirs(projectRoot, projectCandidates);
  for (const projectSourceDir of projectSourceDirs) {
    if (sourceDirSet.has(projectSourceDir)) continue;
    sourceDirSet.add(projectSourceDir);
    sourceDirs.push(projectSourceDir);
  }

  const extraSources = options.additionalSkillSourceDirs ?? [];
  for (const sourceDir of extraSources) {
    const normalized = path.isAbsolute(sourceDir)
      ? sourceDir
      : path.resolve(projectRoot, sourceDir);
    if (!isDirectory(normalized)) continue;
    if (sourceDirSet.has(normalized)) continue;
    sourceDirSet.add(normalized);
    sourceDirs.push(normalized);
  }
  result.sourceDirs = sourceDirs;
  result.sourceDirExists = sourceDirs.length > 0;

  const destRoot = path.join(groupPiHomeDir, 'skills');
  const manifestPath = path.join(destRoot, '.fft_nano_managed_skills.json');
  const previousManaged = new Set(readManagedSkillNames(manifestPath));
  const mergedSkills = new Map<string, string>();

  for (const sourceDir of projectSourceDirs) {
    for (const skillName of listSkillDirectories(sourceDir)) {
      if (mergedSkills.has(skillName)) continue;
      mergedSkills.set(skillName, path.join(sourceDir, skillName));
    }
  }

  for (const sourceDir of extraSources) {
    const normalized = path.isAbsolute(sourceDir)
      ? sourceDir
      : path.resolve(projectRoot, sourceDir);
    if (!isDirectory(normalized)) continue;
    for (const skillName of listSkillDirectories(normalized)) {
      mergedSkills.set(skillName, path.join(normalized, skillName));
    }
  }

  const nextManaged = new Set(mergedSkills.keys());
  result.managed = Array.from(nextManaged).sort();

  if (previousManaged.size === 0 && nextManaged.size === 0) {
    return result;
  }

  fs.mkdirSync(destRoot, { recursive: true });

  for (const skillName of previousManaged) {
    if (nextManaged.has(skillName)) continue;
    const staleDest = path.join(destRoot, skillName);
    if (!fs.existsSync(staleDest)) continue;
    fs.rmSync(staleDest, { recursive: true, force: true });
    result.removed.push(skillName);
  }

  for (const skillName of Array.from(nextManaged).sort()) {
    const source = mergedSkills.get(skillName);
    if (!source) continue;
    const dest = path.join(destRoot, skillName);

    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(source, dest, { recursive: true });
    result.copied.push(skillName);
  }

  writeManagedSkillNames(manifestPath, result.managed);
  return result;
}
