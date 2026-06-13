import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

import { loadSkillUsage } from './skill-lifecycle.js';
import type { SkillCatalogEntry } from './system-prompt.js';
import { getPlatformAdapter } from './platform/index.js';

export const PROJECT_RUNTIME_SKILLS_RELATIVE_DIR_CANDIDATES = [
  path.join('skills', 'runtime'),
] as const;
export const PROJECT_SETUP_SKILLS_RELATIVE_DIR_CANDIDATES = [
  path.join('skills', 'setup'),
] as const;
export const PROJECT_SKILLS_MANIFEST_RELATIVE_PATH = path.join(
  'skills',
  'manifest.json',
);

export interface ProjectSkillsManifest {
  version: string;
  required: string[];
  bundled: string[];
  setupOnly: string[];
}

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
  'version',
  'author',
  'dependencies',
  'category',
  'disable-model-invocation',
] as const;
const FRONTMATTER_ALLOWED_FIELDS = new Set<string>([
  ...FRONTMATTER_REQUIRED_FIELDS,
  ...FRONTMATTER_OPTIONAL_FIELDS,
]);
const SKILL_NAME_PATTERN = /^[\p{Ll}\p{Nd}-]+$/u;
const HIGH_RISK_SKILL_NAME_PATTERN =
  /(?:^|-)(?:ops|install|setup|bootstrap|onboarding|validate|debug|migrate|deploy|provision|flash)(?:-|$)/;
const WHEN_TO_USE_SECTION_PATTERN = /^##\s+when to use(?:\s+this\s+skill)?\b/im;
const WHEN_NOT_TO_USE_SECTION_PATTERN =
  /^##\s+when not to use(?:\s+this\s+skill)?\b/im;
const LIMITATIONS_SECTION_PATTERN =
  /^##\s+(?:limitations|what this skill does not do)\b/im;
const BACKTICKED_SKILL_REFERENCE_PATTERN = /`([a-z][a-z0-9-]*-[a-z0-9-]+)`/g;
const INITIAL_PROJECT_SKILLS_MANIFEST = readProjectSkillsManifest(
  process.cwd(),
);
export const REQUIRED_PROJECT_PI_SKILLS = Object.freeze([
  ...(INITIAL_PROJECT_SKILLS_MANIFEST?.required ?? []),
]) as readonly string[];

interface ParsedSkillMarkdown {
  frontmatter: Record<string, unknown>;
  content: string;
  body: string;
}

type SkillSectionPolicy = 'required' | 'recommended' | 'none';

interface SkillValidationOptions {
  enforceFftPolicy: boolean;
  highRiskNegativeScopePolicy: SkillSectionPolicy;
}

interface SkillMarkdownValidation {
  issues: SkillValidationIssue[];
  warnings: SkillValidationIssue[];
}

type ManagedSkillSource = 'project' | 'external';

interface ManagedSkillManifest {
  managed: string[];
  sources: Record<string, ManagedSkillSource>;
}

function projectSkillsManifestPath(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_SKILLS_MANIFEST_RELATIVE_PATH);
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function readStringArrayField(
  value: unknown,
  fieldName: keyof ProjectSkillsManifest,
  manifestPath: string,
  issues?: SkillValidationIssue[],
): string[] {
  if (!Array.isArray(value)) {
    issues?.push({
      file: manifestPath,
      message: `Manifest field "${fieldName}" must be an array of skill names`,
    });
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) {
      issues?.push({
        file: manifestPath,
        message: `Manifest field "${fieldName}" contains a non-string skill name`,
      });
      continue;
    }
    const skillName = item.trim();
    if (!SKILL_NAME_PATTERN.test(skillName)) {
      issues?.push({
        file: manifestPath,
        message: `Manifest field "${fieldName}" contains invalid skill name: ${skillName}`,
      });
      continue;
    }
    out.push(skillName);
  }
  return uniqueSorted(out);
}

export function readProjectSkillsManifest(
  projectRoot: string = process.cwd(),
  issues?: SkillValidationIssue[],
): ProjectSkillsManifest | null {
  const manifestPath = projectSkillsManifestPath(projectRoot);
  if (!fs.existsSync(manifestPath)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    issues?.push({
      file: manifestPath,
      message: `Unable to parse skills manifest: ${err instanceof Error ? err.message : String(err)}`,
    });
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    issues?.push({
      file: manifestPath,
      message: 'Skills manifest must be a JSON object',
    });
    return null;
  }

  const manifest = parsed as Record<string, unknown>;
  const version =
    typeof manifest.version === 'string' && manifest.version.trim()
      ? manifest.version.trim()
      : '';
  if (!version) {
    issues?.push({
      file: manifestPath,
      message: 'Manifest field "version" must be a non-empty string',
    });
  }

  const required = readStringArrayField(
    manifest.required,
    'required',
    manifestPath,
    issues,
  );
  const bundled = readStringArrayField(
    manifest.bundled,
    'bundled',
    manifestPath,
    issues,
  );
  const setupOnly = readStringArrayField(
    manifest.setupOnly,
    'setupOnly',
    manifestPath,
    issues,
  );

  const bundledSet = new Set(bundled);
  for (const skillName of required) {
    if (bundledSet.has(skillName)) continue;
    issues?.push({
      file: manifestPath,
      message: `Required skill "${skillName}" must also be listed in bundled`,
    });
  }

  return { version, required, bundled, setupOnly };
}

function getProjectSkillsManifest(projectRoot: string): ProjectSkillsManifest {
  return (
    readProjectSkillsManifest(projectRoot) ?? {
      version: '',
      required: [...REQUIRED_PROJECT_PI_SKILLS],
      bundled: [],
      setupOnly: [],
    }
  );
}

function parseSkillMarkdown(
  skillMarkdownPath: string,
): ParsedSkillMarkdown | null {
  if (!fs.existsSync(skillMarkdownPath)) return null;
  const content = fs
    .readFileSync(skillMarkdownPath, 'utf-8')
    .replace(/\r\n/g, '\n');
  if (!content.startsWith('---\n')) return null;
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) return null;

  const yamlFrontmatter = content.slice(4, end);
  let parsed: unknown;
  try {
    parsed = YAML.parse(yamlFrontmatter);
  } catch {
    parsed = parseLooseFrontmatter(yamlFrontmatter);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return null;
  return {
    frontmatter: parsed as Record<string, unknown>,
    content,
    body: content.slice(end + '\n---\n'.length),
  };
}

function parseLooseFrontmatter(raw: string): Record<string, unknown> | null {
  const parsed: Record<string, unknown> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(trimmed);
    if (!match) return null;
    const key = match[1];
    const value = match[2] ?? '';
    if (value === 'true') {
      parsed[key] = true;
    } else if (value === 'false') {
      parsed[key] = false;
    } else if (value === '[]') {
      parsed[key] = [];
    } else {
      parsed[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }
  return Object.keys(parsed).length > 0 ? parsed : null;
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
    if (item === undefined) continue;
  }
}

function hasWhenNotToUseSection(body: string): boolean {
  return (
    WHEN_NOT_TO_USE_SECTION_PATTERN.test(body) ||
    LIMITATIONS_SECTION_PATTERN.test(body)
  );
}

function addPolicyIssue(
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

function hasNegativeScopeGuidance(description: string, body: string): boolean {
  if (hasWhenNotToUseSection(body)) return true;
  return /\b(?:do not use|don't use|not for|avoid using|skip this skill|limitations?)\b/i.test(
    `${description}\n${body}`,
  );
}

function requiredSkillValidationPolicy(skillName: string): {
  highRiskNegativeScopePolicy: SkillSectionPolicy;
} {
  return {
    highRiskNegativeScopePolicy: isHighRiskSkillName(skillName)
      ? 'required'
      : 'none',
  };
}

function nonRequiredSkillValidationPolicy(skillName: string): {
  highRiskNegativeScopePolicy: SkillSectionPolicy;
} {
  return {
    highRiskNegativeScopePolicy: isHighRiskSkillName(skillName)
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
      message:
        'SKILL.md must begin with valid YAML frontmatter delimited by ---',
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
    if (
      rawName.startsWith('-') ||
      rawName.endsWith('-') ||
      rawName.includes('--')
    ) {
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

  if (
    frontmatter.license !== undefined &&
    !toTrimmedString(frontmatter.license)
  ) {
    issues.push({
      file: skillMarkdownPath,
      message:
        'Frontmatter field "license" must be a non-empty string if provided',
    });
  }

  if (frontmatter.compatibility !== undefined) {
    const compatibility = toTrimmedString(frontmatter.compatibility);
    if (!compatibility) {
      issues.push({
        file: skillMarkdownPath,
        message:
          'Frontmatter field "compatibility" must be a non-empty string if provided',
      });
    } else if (compatibility.length > 500) {
      issues.push({
        file: skillMarkdownPath,
        message:
          'Frontmatter field "compatibility" must be 1-500 characters if provided',
      });
    }
  }

  if (
    frontmatter['allowed-tools'] !== undefined &&
    !toTrimmedString(frontmatter['allowed-tools'])
  ) {
    issues.push({
      file: skillMarkdownPath,
      message:
        'Frontmatter field "allowed-tools" must be a non-empty string if provided',
    });
  }

  validateMetadataMap(frontmatter.metadata, skillMarkdownPath, issues);

  if (
    isHighRiskSkillName(expectedSkillName) &&
    !hasNegativeScopeGuidance(rawDescription ?? '', body)
  ) {
    addPolicyIssue(
      options.highRiskNegativeScopePolicy,
      {
        file: skillMarkdownPath,
        message:
          'High-risk skill missing clear "when not to use" guidance (add "## When not to use this skill"/"## Limitations" or explicit non-use wording in description/body)',
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

function normalizeForPathCompare(p: string): string {
  // Use platform adapter for consistent cross-platform path normalization
  const platformAdapter = getPlatformAdapter();
  return platformAdapter.normalizePath(p);
}

function isPathInsideRoot(candidatePath: string, rootPath: string): boolean {
  const platformAdapter = getPlatformAdapter();
  const normalizedCandidate = normalizeForPathCompare(candidatePath);
  const normalizedRoot = normalizeForPathCompare(rootPath);
  // Use pathsEqual for case-insensitive comparison on Windows
  if (platformAdapter.pathsEqual(normalizedCandidate, normalizedRoot)) {
    return true;
  }
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function validateSkillPathSafety(skillPath: string): SkillValidationIssue[] {
  const issues: SkillValidationIssue[] = [];
  let realSkillRoot: string;
  try {
    realSkillRoot = fs.realpathSync(skillPath);
  } catch {
    return [
      {
        file: skillPath,
        message: 'Unable to resolve skill source path',
      },
    ];
  }

  const stack = [skillPath];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      issues.push({
        file: current,
        message: 'Unable to read skill directory contents',
      });
      continue;
    }

    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        ['.venv', 'node_modules', '.git', '__pycache__'].includes(entry.name)
      ) {
        continue;
      }
      const entryPath = path.join(current, entry.name);
      let stats: fs.Stats;
      try {
        stats = fs.lstatSync(entryPath);
      } catch {
        issues.push({
          file: entryPath,
          message: 'Unable to stat skill entry',
        });
        continue;
      }

      if (stats.isSymbolicLink()) {
        issues.push({
          file: entryPath,
          message:
            'Skill source contains symbolic links, which are not allowed',
        });
        continue;
      }

      let realEntryPath: string;
      try {
        realEntryPath = fs.realpathSync(entryPath);
      } catch {
        issues.push({
          file: entryPath,
          message: 'Unable to resolve skill entry real path',
        });
        continue;
      }

      if (!isPathInsideRoot(realEntryPath, realSkillRoot)) {
        issues.push({
          file: entryPath,
          message: 'Skill source entry resolves outside the skill root',
        });
        continue;
      }

      if (stats.isDirectory()) {
        stack.push(entryPath);
      }
    }
  }

  return issues;
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
    .filter((name) => fs.existsSync(path.join(sourceRoot, name, 'SKILL.md')));
}

function getManifestRuntimeSkillNames(projectRoot: string): string[] | null {
  const manifest = readProjectSkillsManifest(projectRoot);
  if (!manifest) return null;
  return uniqueSorted(manifest.bundled);
}

function getProjectRuntimeSkillNames(
  projectRoot: string,
  sourceRoot: string,
): string[] {
  const manifestNames = getManifestRuntimeSkillNames(projectRoot);
  if (!manifestNames) return listSkillDirectories(sourceRoot);
  return manifestNames.filter((skillName) =>
    fs.existsSync(path.join(sourceRoot, skillName, 'SKILL.md')),
  );
}

function validateDeclaredSkillSet(params: {
  sourceRoot: string;
  declared: string[];
  label: string;
  issues: SkillValidationIssue[];
}): void {
  const actual = new Set(listSkillDirectories(params.sourceRoot));
  const declared = new Set(params.declared);

  for (const skillName of Array.from(actual).sort()) {
    if (declared.has(skillName)) continue;
    params.issues.push({
      file: path.join(params.sourceRoot, skillName),
      message: `${params.label} skill is not declared in ${PROJECT_SKILLS_MANIFEST_RELATIVE_PATH}`,
    });
  }

  for (const skillName of Array.from(declared).sort()) {
    if (actual.has(skillName)) continue;
    params.issues.push({
      file: path.join(params.sourceRoot, skillName),
      message: `${params.label} skill is declared in ${PROJECT_SKILLS_MANIFEST_RELATIVE_PATH} but missing on disk`,
    });
  }
}

function validateBacktickedSkillReferences(params: {
  sourceRoots: string[];
  declaredSkillNames: Set<string>;
  issues: SkillValidationIssue[];
}): void {
  for (const sourceRoot of params.sourceRoots) {
    for (const skillName of listSkillDirectories(sourceRoot)) {
      const skillMarkdownPath = path.join(sourceRoot, skillName, 'SKILL.md');
      let content = '';
      try {
        content = fs.readFileSync(skillMarkdownPath, 'utf-8');
      } catch {
        continue;
      }
      for (const match of content.matchAll(
        BACKTICKED_SKILL_REFERENCE_PATTERN,
      )) {
        const referencedSkillName = match[1];
        const matchIndex = match.index ?? 0;
        const lineStart = content.lastIndexOf('\n', matchIndex) + 1;
        const lineEnd = content.indexOf('\n', matchIndex);
        const line = content.slice(
          lineStart,
          lineEnd === -1 ? content.length : lineEnd,
        );
        if (!/\b(skill|handoff|hand off|route|routing)\b/i.test(line)) {
          continue;
        }
        if (params.declaredSkillNames.has(referencedSkillName)) continue;
        params.issues.push({
          file: skillMarkdownPath,
          message: `Backticked skill reference "${referencedSkillName}" is not declared in ${PROJECT_SKILLS_MANIFEST_RELATIVE_PATH}`,
        });
      }
    }
  }
}

function summarizeParagraph(text: string, maxChars = 220): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3)}...`;
}

function extractSectionText(body: string, headingPattern: RegExp): string {
  const match = headingPattern.exec(body);
  if (!match || typeof match.index !== 'number') return '';
  const rest = body.slice(match.index + match[0].length);
  const nextHeading = rest.search(/^##\s+/m);
  const section = nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
  return summarizeParagraph(section.replace(/^[\s*-]+/gm, ' ').trim());
}

function parseAllowedTools(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  const raw = toTrimmedString(value);
  if (!raw) return [];
  const parts = raw.includes(',') ? raw.split(',') : raw.split(/\s+/);
  return parts.map((item) => item.trim()).filter(Boolean);
}

export function buildSkillCatalogEntries(
  sourceDirs: string[],
  options: { maxChars: number } = { maxChars: 6000 },
): SkillCatalogEntry[] {
  const results: SkillCatalogEntry[] = [];
  let usedChars = 0;
  for (let rootIndex = 0; rootIndex < sourceDirs.length; rootIndex += 1) {
    const sourceDir = sourceDirs[rootIndex];
    if (!isDirectory(sourceDir)) continue;
    const usage = loadSkillUsage(sourceDir);
    const managedManifest = readManagedSkillManifest(
      path.join(sourceDir, '.fft_nano_managed_skills.json'),
    );
    const managedNames = new Set(managedManifest.managed);
    for (const skillName of listSkillDirectories(sourceDir)) {
      const managedSource = managedManifest.sources[skillName];
      const source: SkillCatalogEntry['source'] = managedNames.has(skillName)
        ? managedSource || 'project'
        : usage[skillName]?.created_by === 'agent'
          ? 'agent'
          : rootIndex === 0
            ? 'project'
            : 'external';
      const markdownPath = path.join(sourceDir, skillName, 'SKILL.md');
      const parsed = parseSkillMarkdown(markdownPath);
      if (!parsed) continue;
      const description =
        toTrimmedString(parsed.frontmatter.description) || skillName;
      const allowedTools = parseAllowedTools(
        parsed.frontmatter['allowed-tools'],
      );
      const whenToUse =
        extractSectionText(parsed.body, WHEN_TO_USE_SECTION_PATTERN) ||
        summarizeParagraph(parsed.body);
      const entry: SkillCatalogEntry = {
        name: skillName,
        description,
        allowedTools,
        whenToUse,
        source,
      };
      const approxChars =
        entry.name.length +
        entry.description.length +
        entry.whenToUse.length +
        entry.allowedTools.join(',').length +
        24;
      if (results.length > 0 && usedChars + approxChars > options.maxChars) {
        return results;
      }
      usedChars += approxChars;
      results.push(entry);
    }
  }
  return results;
}

function readManagedSkillManifest(manifestPath: string): ManagedSkillManifest {
  const empty: ManagedSkillManifest = { managed: [], sources: {} };
  if (!fs.existsSync(manifestPath)) return empty;
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
      managed?: unknown;
      sources?: unknown;
    };
    if (!Array.isArray(parsed.managed)) return empty;
    const managed = parsed.managed.filter(
      (entry): entry is string => typeof entry === 'string',
    );
    const sources: Record<string, ManagedSkillSource> = {};
    if (
      parsed.sources &&
      typeof parsed.sources === 'object' &&
      !Array.isArray(parsed.sources)
    ) {
      for (const [name, source] of Object.entries(
        parsed.sources as Record<string, unknown>,
      )) {
        if (source === 'project' || source === 'external') {
          sources[name] = source;
        }
      }
    }
    return { managed, sources };
  } catch {
    return empty;
  }
}

function readManagedSkillNames(manifestPath: string): string[] {
  return readManagedSkillManifest(manifestPath).managed;
}

function writeManagedSkillNames(
  manifestPath: string,
  managed: string[],
  sources: Record<string, ManagedSkillSource> = {},
): void {
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        managed: Array.from(new Set(managed)).sort(),
        sources,
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
  return path.join(
    projectRoot,
    PROJECT_RUNTIME_SKILLS_RELATIVE_DIR_CANDIDATES[0],
  );
}

export function validateProjectPiSkills(
  projectRoot: string = process.cwd(),
): SkillValidationResult {
  const issues: SkillValidationIssue[] = [];
  const warnings: SkillValidationIssue[] = [];
  const manifest = readProjectSkillsManifest(projectRoot, issues);
  const skillsRoot = resolveProjectRuntimeSkillsDir(projectRoot);
  const setupSkillsRoot = path.join(
    projectRoot,
    PROJECT_SETUP_SKILLS_RELATIVE_DIR_CANDIDATES[0],
  );
  const validatedSkills = new Set<string>();
  const requiredSkillNames = manifest?.required ?? [
    ...REQUIRED_PROJECT_PI_SKILLS,
  ];
  const runtimeSkillNames =
    manifest?.bundled ?? listSkillDirectories(skillsRoot);

  if (manifest) {
    validateDeclaredSkillSet({
      sourceRoot: skillsRoot,
      declared: manifest.bundled,
      label: 'Runtime',
      issues,
    });
    validateDeclaredSkillSet({
      sourceRoot: setupSkillsRoot,
      declared: manifest.setupOnly,
      label: 'Setup-only',
      issues,
    });
    validateBacktickedSkillReferences({
      sourceRoots: [skillsRoot, setupSkillsRoot],
      declaredSkillNames: new Set([...manifest.bundled, ...manifest.setupOnly]),
      issues,
    });
  }

  for (const skillName of requiredSkillNames) {
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
      ...requiredSkillValidationPolicy(skillName),
    });
    issues.push(...validation.issues);
    warnings.push(...validation.warnings);
    validatedSkills.add(skillName);
  }

  for (const skillName of runtimeSkillNames) {
    if (validatedSkills.has(skillName)) continue;
    const skillMarkdownPath = path.join(skillsRoot, skillName, 'SKILL.md');
    const validation = validateSkillMarkdown(skillName, skillMarkdownPath, {
      enforceFftPolicy: false,
      ...nonRequiredSkillValidationPolicy(skillName),
    });
    issues.push(...validation.issues);
    warnings.push(...validation.warnings);
  }

  if (manifest) {
    for (const skillName of manifest.setupOnly) {
      const skillMarkdownPath = path.join(
        setupSkillsRoot,
        skillName,
        'SKILL.md',
      );
      const validation = validateSkillMarkdown(skillName, skillMarkdownPath, {
        enforceFftPolicy: false,
        ...nonRequiredSkillValidationPolicy(skillName),
      });
      issues.push(...validation.issues);
      warnings.push(...validation.warnings);
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    warnings,
  };
}

export function validatePiSkillsSourceDir(
  skillsRoot: string,
): SkillValidationResult {
  const issues: SkillValidationIssue[] = [];
  const warnings: SkillValidationIssue[] = [];

  for (const skillName of listSkillDirectories(skillsRoot)) {
    const skillMarkdownPath = path.join(skillsRoot, skillName, 'SKILL.md');
    const validation = validateSkillMarkdown(skillName, skillMarkdownPath, {
      enforceFftPolicy: false,
      ...nonRequiredSkillValidationPolicy(skillName),
    });
    issues.push(...validation.issues);
    warnings.push(...validation.warnings);

    const safetyIssues = validateSkillPathSafety(
      path.join(skillsRoot, skillName),
    );
    issues.push(...safetyIssues);
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
  const projectSourceDirs = resolveExistingSkillDirs(
    projectRoot,
    projectCandidates,
  );
  const projectSkillsManifest = getProjectSkillsManifest(projectRoot);
  const requiredProjectSkillSet = new Set<string>(
    projectSkillsManifest.required,
  );
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
    for (const skillName of getProjectRuntimeSkillNames(
      projectRoot,
      sourceDir,
    )) {
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

  const validatedSkills = new Map<
    string,
    { skillPath: string; source: ManagedSkillSource }
  >();
  for (const [skillName, entries] of mergedSkills.entries()) {
    const invalidCandidates: SkillValidationIssue[] = [];
    const isRequiredSkill = requiredProjectSkillSet.has(skillName);
    const validationPolicy = isRequiredSkill
      ? requiredSkillValidationPolicy(skillName)
      : nonRequiredSkillValidationPolicy(skillName);
    let selectedSkill: {
      skillPath: string;
      source: ManagedSkillSource;
    } | null = null;

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      const skillMarkdownPath = path.join(entry.skillPath, 'SKILL.md');
      const validation = validateSkillMarkdown(skillName, skillMarkdownPath, {
        enforceFftPolicy: isRequiredSkill,
        ...validationPolicy,
      });
      if (validation.issues.length > 0) {
        invalidCandidates.push(...validation.issues);
        continue;
      }
      const safetyIssues = validateSkillPathSafety(entry.skillPath);
      if (safetyIssues.length > 0) {
        invalidCandidates.push(...safetyIssues);
        continue;
      }
      if (validation.warnings.length > 0) {
        result.warnings.push(...validation.warnings);
        result.warnedSkills.push(skillName);
      }
      selectedSkill = entry;
      break;
    }

    if (!selectedSkill) {
      result.invalid.push(...invalidCandidates);
      result.skippedInvalid.push(skillName);
      continue;
    }
    validatedSkills.set(skillName, selectedSkill);
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
    const selected = validatedSkills.get(skillName);
    if (!selected) continue;
    const dest = path.join(destRoot, skillName);

    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(selected.skillPath, dest, { recursive: true });
    result.copied.push(skillName);
  }

  writeManagedSkillNames(
    manifestPath,
    result.managed,
    Object.fromEntries(
      Array.from(validatedSkills.entries()).map(([skillName, selected]) => [
        skillName,
        selected.source,
      ]),
    ),
  );
  return result;
}
