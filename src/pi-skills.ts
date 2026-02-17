import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

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
  warnings: SkillValidationIssue[];
}

export interface SkillSyncResult {
  sourceDirExists: boolean;
  sourceDirs: string[];
  copied: string[];
  removed: string[];
  managed: string[];
  invalid: SkillValidationIssue[];
  skippedInvalid: string[];
  warnings: SkillValidationIssue[];
  warnedSkills: string[];
}

export interface SkillSyncOptions {
  projectRuntimeSkillDirCandidates?: string[];
  additionalSkillSourceDirs?: string[];
}

const FRONTMATTER_REQUIRED_FIELDS = ['name', 'description'] as const;
const FRONTMATTER_OPTIONAL_FIELDS = [
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
] as const;
const FRONTMATTER_ALLOWED_FIELDS = new Set<string>([
  ...FRONTMATTER_REQUIRED_FIELDS,
  ...FRONTMATTER_OPTIONAL_FIELDS,
]);
const SKILL_NAME_PATTERN = /^[\p{Ll}\p{Nd}-]+$/u;
const REQUIRED_PROJECT_PI_SKILL_SET = new Set<string>(REQUIRED_PROJECT_PI_SKILLS);
const HIGH_RISK_SKILL_NAME_PATTERN =
  /(?:^|-)(?:ops|install|setup|bootstrap|onboarding|validate|debug|migrate|deploy|provision|flash)(?:-|$)/;
const WHEN_TO_USE_SECTION_PATTERN = /^##\s+when to use(?:\s+this\s+skill)?\b/im;
const WHEN_NOT_TO_USE_SECTION_PATTERN =
  /^##\s+when not to use(?:\s+this\s+skill)?\b/im;
const LIMITATIONS_SECTION_PATTERN =
  /^##\s+(?:limitations|what this skill does not do)\b/im;

interface ParsedSkillMarkdown {
  frontmatter: Record<string, unknown>;
  content: string;
  body: string;
}

type SkillSectionPolicy = 'required' | 'recommended' | 'none';

interface SkillValidationOptions {
  enforceFftPolicy: boolean;
  whenToUsePolicy: SkillSectionPolicy;
  whenNotToUsePolicy: SkillSectionPolicy;
}

interface SkillMarkdownValidation {
  issues: SkillValidationIssue[];
  warnings: SkillValidationIssue[];
}

function parseSkillMarkdown(skillMarkdownPath: string): ParsedSkillMarkdown | null {
  if (!fs.existsSync(skillMarkdownPath)) return null;
  const content = fs.readFileSync(skillMarkdownPath, 'utf-8').replace(/\r\n/g, '\n');
  if (!content.startsWith('---\n')) return null;
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) return null;

  const yamlFrontmatter = content.slice(4, end);
  let parsed: unknown;
  try {
    parsed = YAML.parse(yamlFrontmatter);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return {
    frontmatter: parsed as Record<string, unknown>,
    content,
    body: content.slice(end + '\n---\n'.length),
  };
}

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim();
}

function validateMetadataMap(
  value: unknown,
  skillMarkdownPath: string,
  issues: SkillValidationIssue[],
): void {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issues.push({
      file: skillMarkdownPath,
      message: 'Frontmatter field "metadata" must be a key/value map',
    });
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== 'string' || key.trim().length === 0) {
      issues.push({
        file: skillMarkdownPath,
        message: 'Frontmatter field "metadata" contains an invalid key',
      });
      continue;
    }
    if (typeof item !== 'string') {
      issues.push({
        file: skillMarkdownPath,
        message: `Frontmatter field "metadata.${key}" must be a string`,
      });
    }
  }
}

function hasWhenToUseSection(body: string): boolean {
  return WHEN_TO_USE_SECTION_PATTERN.test(body);
}

function hasWhenNotToUseSection(body: string): boolean {
  return (
    WHEN_NOT_TO_USE_SECTION_PATTERN.test(body) ||
    LIMITATIONS_SECTION_PATTERN.test(body)
  );
}

function addSectionPolicyIssue(
  policy: SkillSectionPolicy,
  issue: SkillValidationIssue,
  issues: SkillValidationIssue[],
  warnings: SkillValidationIssue[],
): void {
  if (policy === 'none') return;
  if (policy === 'required') {
    issues.push(issue);
    return;
  }
  warnings.push(issue);
}

function isHighRiskSkillName(skillName: string): boolean {
  return HIGH_RISK_SKILL_NAME_PATTERN.test(skillName);
}

function requiredSkillSectionPolicy(skillName: string): {
  whenToUsePolicy: SkillSectionPolicy;
  whenNotToUsePolicy: SkillSectionPolicy;
} {
  return {
    whenToUsePolicy: 'required',
    whenNotToUsePolicy: isHighRiskSkillName(skillName)
      ? 'required'
      : 'recommended',
  };
}

function nonRequiredSkillSectionPolicy(skillName: string): {
  whenToUsePolicy: SkillSectionPolicy;
  whenNotToUsePolicy: SkillSectionPolicy;
} {
  return {
    whenToUsePolicy: 'recommended',
    whenNotToUsePolicy: isHighRiskSkillName(skillName)
      ? 'recommended'
      : 'none',
  };
}

function validateSkillMarkdown(
  expectedSkillName: string,
  skillMarkdownPath: string,
  options: SkillValidationOptions,
): SkillMarkdownValidation {
  const issues: SkillValidationIssue[] = [];
  const warnings: SkillValidationIssue[] = [];
  if (!fs.existsSync(skillMarkdownPath)) {
    issues.push({ file: skillMarkdownPath, message: 'Missing SKILL.md' });
    return { issues, warnings };
  }
  const parsed = parseSkillMarkdown(skillMarkdownPath);
  if (!parsed) {
    issues.push({
      file: skillMarkdownPath,
      message: 'SKILL.md must begin with valid YAML frontmatter delimited by ---',
    });
    return { issues, warnings };
  }

  const { frontmatter, content, body } = parsed;
  for (const key of Object.keys(frontmatter)) {
    if (FRONTMATTER_ALLOWED_FIELDS.has(key)) continue;
    issues.push({
      file: skillMarkdownPath,
      message: `Frontmatter contains unsupported field: ${key}`,
    });
  }

  const rawName = toTrimmedString(frontmatter.name);
  if (!rawName) {
    issues.push({
      file: skillMarkdownPath,
      message: 'Frontmatter missing required field: name',
    });
  } else {
    if (rawName.length > 64) {
      issues.push({
        file: skillMarkdownPath,
        message: 'Frontmatter field "name" must be 1-64 characters',
      });
    }
    if (!SKILL_NAME_PATTERN.test(rawName)) {
      issues.push({
        file: skillMarkdownPath,
        message:
          'Frontmatter field "name" must use lowercase alphanumeric characters and hyphens only',
      });
    }
    if (rawName.startsWith('-') || rawName.endsWith('-') || rawName.includes('--')) {
      issues.push({
        file: skillMarkdownPath,
        message:
          'Frontmatter field "name" must not start/end with "-" or contain consecutive hyphens',
      });
    }
    if (rawName !== expectedSkillName) {
      issues.push({
        file: skillMarkdownPath,
        message: `Frontmatter name (${rawName}) does not match folder (${expectedSkillName})`,
      });
    }
  }

  const rawDescription = toTrimmedString(frontmatter.description);
  if (!rawDescription) {
    issues.push({
      file: skillMarkdownPath,
      message: 'Frontmatter missing required field: description',
    });
  } else if (rawDescription.length > 1024) {
    issues.push({
      file: skillMarkdownPath,
      message: 'Frontmatter field "description" must be 1-1024 characters',
    });
  }

  if (frontmatter.license !== undefined && !toTrimmedString(frontmatter.license)) {
    issues.push({
      file: skillMarkdownPath,
      message: 'Frontmatter field "license" must be a non-empty string if provided',
    });
  }

  if (frontmatter.compatibility !== undefined) {
    const compatibility = toTrimmedString(frontmatter.compatibility);
    if (!compatibility) {
      issues.push({
        file: skillMarkdownPath,
        message: 'Frontmatter field "compatibility" must be a non-empty string if provided',
      });
    } else if (compatibility.length > 500) {
      issues.push({
        file: skillMarkdownPath,
        message: 'Frontmatter field "compatibility" must be 1-500 characters if provided',
      });
    }
  }

  if (frontmatter['allowed-tools'] !== undefined && !toTrimmedString(frontmatter['allowed-tools'])) {
    issues.push({
      file: skillMarkdownPath,
      message: 'Frontmatter field "allowed-tools" must be a non-empty string if provided',
    });
  }

  validateMetadataMap(frontmatter.metadata, skillMarkdownPath, issues);

  if (!hasWhenToUseSection(body)) {
    addSectionPolicyIssue(
      options.whenToUsePolicy,
      {
        file: skillMarkdownPath,
        message: 'Missing section: "## When to use this skill"',
      },
      issues,
      warnings,
    );
  }

  if (!hasWhenNotToUseSection(body)) {
    addSectionPolicyIssue(
      options.whenNotToUsePolicy,
      {
        file: skillMarkdownPath,
        message:
          'Missing section: "## When not to use this skill" (or "## Limitations")',
      },
      issues,
      warnings,
    );
  }

  if (!options.enforceFftPolicy) return { issues, warnings };

  if (!/never (?:run|use) destructive git commands/i.test(content)) {
    issues.push({
      file: skillMarkdownPath,
      message: 'Skill guardrail missing: "never run destructive git commands"',
    });
  }

  if (!/preserve unrelated worktree changes/i.test(content)) {
    issues.push({
      file: skillMarkdownPath,
      message: 'Skill guardrail missing: "preserve unrelated worktree changes"',
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

  return { issues, warnings };
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
  const warnings: SkillValidationIssue[] = [];
  const skillsRoot = resolveProjectRuntimeSkillsDir(projectRoot);
  const validatedSkills = new Set<string>();

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
    const validation = validateSkillMarkdown(skillName, skillMarkdownPath, {
      enforceFftPolicy: true,
      ...requiredSkillSectionPolicy(skillName),
    });
    issues.push(...validation.issues);
    warnings.push(...validation.warnings);
    validatedSkills.add(skillName);
  }

  for (const skillName of listSkillDirectories(skillsRoot)) {
    if (validatedSkills.has(skillName)) continue;
    const skillMarkdownPath = path.join(skillsRoot, skillName, 'SKILL.md');
    const validation = validateSkillMarkdown(skillName, skillMarkdownPath, {
      enforceFftPolicy: false,
      ...nonRequiredSkillSectionPolicy(skillName),
    });
    issues.push(...validation.issues);
    warnings.push(...validation.warnings);
  }

  return {
    ok: issues.length === 0,
    issues,
    warnings,
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
    invalid: [],
    skippedInvalid: [],
    warnings: [],
    warnedSkills: [],
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
  const mergedSkills = new Map<
    string,
    Array<{ skillPath: string; source: 'project' | 'external' }>
  >();

  for (const sourceDir of projectSourceDirs) {
    for (const skillName of listSkillDirectories(sourceDir)) {
      const existing = mergedSkills.get(skillName) ?? [];
      existing.push({
        skillPath: path.join(sourceDir, skillName),
        source: 'project',
      });
      mergedSkills.set(skillName, existing);
    }
  }

  for (const sourceDir of extraSources) {
    const normalized = path.isAbsolute(sourceDir)
      ? sourceDir
      : path.resolve(projectRoot, sourceDir);
    if (!isDirectory(normalized)) continue;
    for (const skillName of listSkillDirectories(normalized)) {
      const existing = mergedSkills.get(skillName) ?? [];
      existing.push({
        skillPath: path.join(normalized, skillName),
        source: 'external',
      });
      mergedSkills.set(skillName, existing);
    }
  }

  const validatedSkills = new Map<string, string>();
  for (const [skillName, entries] of mergedSkills.entries()) {
    const invalidCandidates: SkillValidationIssue[] = [];
    const isRequiredSkill = REQUIRED_PROJECT_PI_SKILL_SET.has(skillName);
    const sectionPolicy = isRequiredSkill
      ? requiredSkillSectionPolicy(skillName)
      : nonRequiredSkillSectionPolicy(skillName);
    let selectedSkillPath: string | null = null;

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      const skillMarkdownPath = path.join(entry.skillPath, 'SKILL.md');
      const validation = validateSkillMarkdown(skillName, skillMarkdownPath, {
        enforceFftPolicy: isRequiredSkill,
        ...sectionPolicy,
      });
      if (validation.issues.length > 0) {
        invalidCandidates.push(...validation.issues);
        continue;
      }
      if (validation.warnings.length > 0) {
        result.warnings.push(...validation.warnings);
        result.warnedSkills.push(skillName);
      }
      selectedSkillPath = entry.skillPath;
      break;
    }

    if (!selectedSkillPath) {
      result.invalid.push(...invalidCandidates);
      result.skippedInvalid.push(skillName);
      continue;
    }
    validatedSkills.set(skillName, selectedSkillPath);
  }
  result.skippedInvalid = Array.from(new Set(result.skippedInvalid)).sort();
  result.warnedSkills = Array.from(new Set(result.warnedSkills)).sort();

  const nextManaged = new Set(validatedSkills.keys());
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
    const source = validatedSkills.get(skillName);
    if (!source) continue;
    const dest = path.join(destRoot, skillName);

    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(source, dest, { recursive: true });
    result.copied.push(skillName);
  }

  writeManagedSkillNames(manifestPath, result.managed);
  return result;
}
