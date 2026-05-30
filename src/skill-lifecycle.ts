import fs from 'fs';
import path from 'path';

import YAML from 'yaml';
import { z } from 'zod';

import { defaultBackupPath, writeTextFileAtomic } from './atomic-write.js';
import {
  listSkillHistory,
  rollbackSkillFile,
  snapshotSkillFile,
} from './skill-history.js';
import { DATA_DIR, MAIN_GROUP_FOLDER, MAIN_WORKSPACE_DIR } from './config.js';
import {
  assertValidGroupFolder,
  resolveGroupFolderPath,
} from './group-folder.js';
import { logger } from './logger.js';
import type { RegisteredGroup, SkillActionRequest } from './types.js';

export const SKILL_USAGE_FILE = '.usage.json';
export const SKILL_MANAGER_STATE_FILE = '.skill_manager_state.json';
export const SKILL_ARCHIVE_DIR = '.archive';
export const SKILL_BACKUP_DIR = '.curator_backups';
export const SKILL_REPORTS_DIR = 'skill-manager';

export type SkillLifecycleState = 'active' | 'stale' | 'archived';

export interface SkillUsageRecord {
  created_by?: 'agent' | null;
  use_count: number;
  view_count: number;
  patch_count: number;
  last_used_at: string | null;
  last_viewed_at: string | null;
  last_patched_at: string | null;
  created_at: string;
  state: SkillLifecycleState;
  pinned: boolean;
  archived_at: string | null;
}

export interface SkillManagerConfig {
  enabled: boolean;
  intervalHours: number;
  minIdleHours: number;
  staleAfterDays: number;
  archiveAfterDays: number;
  backupEnabled: boolean;
  backupKeep: number;
}

export interface SkillManagerState {
  lastRunAt: string | null;
  lastRunDurationSeconds: number | null;
  lastRunSummary: string | null;
  lastReportPath: string | null;
  paused: boolean;
  runCount: number;
}

export interface SkillReportEntry {
  name: string;
  path: string;
  source: 'project' | 'external' | 'agent' | 'unmanaged';
  usage: SkillUsageRecord;
  lastActivityAt: string | null;
  activityCount: number;
  frontmatterOk: boolean;
  frontmatterIssues: string[];
  description: string;
}

export interface SkillActionExecutionContext {
  sourceGroup: string;
  isMain: boolean;
  registeredGroups: Record<string, RegisteredGroup>;
}

export interface SkillActionResult {
  requestId: string;
  status: 'success' | 'error';
  result?: unknown;
  error?: string;
  executedAt: string;
}

interface ManagedSkillManifest {
  managed: Set<string>;
  sources: Map<string, 'project' | 'external'>;
}

const skillNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/, {
    message: 'skill names must be lowercase alphanumeric with hyphens',
  })
  .refine((value) => !value.includes('--'), {
    message: 'skill names must not contain consecutive hyphens',
  });

const skillActionSchema = z.object({
  type: z.literal('skill_action'),
  requestId: z.string().min(1),
  action: z.enum([
    'skill_list',
    'skill_view',
    'skill_create',
    'skill_patch',
    'skill_write_file',
    'skill_archive',
    'skill_restore',
    'skill_rollback',
    'skill_pin',
    'skill_unpin',
    'skill_status',
  ]),
  params: z
    .object({
      name: z.string().optional(),
      content: z.string().optional(),
      filePath: z.string().optional(),
      fileContent: z.string().optional(),
      description: z.string().optional(),
      groupFolder: z.string().optional(),
      includeArchived: z.boolean().optional(),
      reason: z.string().optional(),
      version: z.string().optional(),
    })
    .default({}),
});

function nowIso(): string {
  return new Date().toISOString();
}

function defaultUsageRecord(): SkillUsageRecord {
  return {
    created_by: null,
    use_count: 0,
    view_count: 0,
    patch_count: 0,
    last_used_at: null,
    last_viewed_at: null,
    last_patched_at: null,
    created_at: nowIso(),
    state: 'active',
    pinned: false,
    archived_at: null,
  };
}

function defaultSkillManagerState(): SkillManagerState {
  return {
    lastRunAt: null,
    lastRunDurationSeconds: null,
    lastRunSummary: null,
    lastReportPath: null,
    paused: false,
    runCount: 0,
  };
}

export function resolveGroupPiHomeDir(groupFolder: string): string {
  assertValidGroupFolder(groupFolder);
  const piBaseDir = path.resolve(DATA_DIR, 'pi');
  const piHomeDir = path.resolve(piBaseDir, groupFolder, '.pi');
  assertInside(piHomeDir, piBaseDir);
  return piHomeDir;
}

export function resolveGroupSkillsDir(groupFolder: string): string {
  return path.join(resolveGroupPiHomeDir(groupFolder), 'skills');
}

function resolveGroupLogsDir(groupFolder: string): string {
  return path.join(resolveGroupFolderPath(groupFolder), 'logs');
}

function usagePath(skillsDir: string): string {
  return path.join(skillsDir, SKILL_USAGE_FILE);
}

function skillManagerStatePath(skillsDir: string): string {
  return path.join(skillsDir, SKILL_MANAGER_STATE_FILE);
}

function archiveRoot(skillsDir: string): string {
  return path.join(skillsDir, SKILL_ARCHIVE_DIR);
}

function backupRoot(skillsDir: string): string {
  return path.join(skillsDir, SKILL_BACKUP_DIR);
}

function readJsonMap<T>(filePath: string): Record<string, T> {
  try {
    if (!fs.existsSync(filePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, T>;
  } catch {
    return {};
  }
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeTextFileAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`, {
    backupPath: defaultBackupPath(filePath),
  });
}

function normalizeUsageRecord(value: unknown): SkillUsageRecord {
  const base = defaultUsageRecord();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
  const record = value as Partial<SkillUsageRecord>;
  return {
    ...base,
    ...record,
    created_by: record.created_by === 'agent' ? 'agent' : null,
    use_count: Number(record.use_count) || 0,
    view_count: Number(record.view_count) || 0,
    patch_count: Number(record.patch_count) || 0,
    state:
      record.state === 'stale' || record.state === 'archived'
        ? record.state
        : 'active',
    pinned: record.pinned === true,
  };
}

export function loadSkillUsage(
  skillsDir: string,
): Record<string, SkillUsageRecord> {
  const raw = readJsonMap<unknown>(usagePath(skillsDir));
  const out: Record<string, SkillUsageRecord> = {};
  for (const [name, record] of Object.entries(raw)) {
    out[name] = normalizeUsageRecord(record);
  }
  return out;
}

export function saveSkillUsage(
  skillsDir: string,
  usage: Record<string, SkillUsageRecord>,
): void {
  writeJsonAtomic(usagePath(skillsDir), usage);
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function latestActivity(record: SkillUsageRecord): string | null {
  const candidates = [
    record.last_used_at,
    record.last_viewed_at,
    record.last_patched_at,
  ]
    .map((value) => ({ value, date: parseDate(value) }))
    .filter((entry): entry is { value: string; date: Date } => !!entry.date);
  candidates.sort((a, b) => b.date.getTime() - a.date.getTime());
  return candidates[0]?.value || null;
}

function activityCount(record: SkillUsageRecord): number {
  return record.use_count + record.view_count + record.patch_count;
}

function skillDir(skillsDir: string, name: string): string {
  return path.join(skillsDir, name);
}

function archivedSkillDir(skillsDir: string, name: string): string {
  return path.join(archiveRoot(skillsDir), name);
}

function readSkillMarkdown(skillMarkdownPath: string): {
  frontmatter: Record<string, unknown>;
  body: string;
  content: string;
  issues: string[];
} {
  const issues: string[] = [];
  let content = '';
  try {
    content = fs
      .readFileSync(skillMarkdownPath, 'utf-8')
      .replace(/\r\n/g, '\n');
  } catch {
    return {
      frontmatter: {},
      body: '',
      content: '',
      issues: ['Missing SKILL.md'],
    };
  }

  if (!content.startsWith('---\n')) {
    return {
      frontmatter: {},
      body: content,
      content,
      issues: ['SKILL.md missing YAML frontmatter'],
    };
  }
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) {
    return {
      frontmatter: {},
      body: content,
      content,
      issues: ['SKILL.md frontmatter is not closed'],
    };
  }
  const raw = content.slice(4, end);
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch {
    issues.push('SKILL.md frontmatter is not valid YAML');
  }
  const frontmatter =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const body = content.slice(end + '\n---\n'.length);
  return { frontmatter, body, content, issues };
}

function frontmatterIssues(
  name: string,
  parsed: ReturnType<typeof readSkillMarkdown>,
): string[] {
  const issues = [...parsed.issues];
  const rawName =
    typeof parsed.frontmatter.name === 'string'
      ? parsed.frontmatter.name.trim()
      : '';
  const description =
    typeof parsed.frontmatter.description === 'string'
      ? parsed.frontmatter.description.trim()
      : '';
  if (!rawName) issues.push('Frontmatter missing required field: name');
  else if (rawName !== name)
    issues.push(
      `Frontmatter name (${rawName}) does not match folder (${name})`,
    );
  const nameCheck = skillNameSchema.safeParse(rawName || name);
  if (!nameCheck.success)
    issues.push(nameCheck.error.issues[0]?.message || 'Invalid skill name');
  if (!description)
    issues.push('Frontmatter missing required field: description');
  else if (description.length > 1024)
    issues.push('Frontmatter description is too long');
  return Array.from(new Set(issues));
}

function normalizeSkillMarkdown(params: {
  name: string;
  description: string;
  body: string;
}): string {
  const frontmatter = YAML.stringify({
    name: params.name,
    description: params.description.trim() || params.name,
  }).trim();
  const body = params.body.trim() || `# ${params.name}\n`;
  return `---\n${frontmatter}\n---\n\n${body.trimEnd()}\n`;
}

function assertSafeRelativeFilePath(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (
    !normalized ||
    normalized.includes('\0') ||
    normalized.split('/').some((part) => part === '..' || part === '.')
  ) {
    throw new Error(`Unsafe skill file path: ${relPath}`);
  }
  if (normalized === 'SKILL.md') return normalized;
  const first = normalized.split('/')[0];
  if (!['references', 'templates', 'scripts', 'assets'].includes(first)) {
    throw new Error(
      'Skill support files must live under references/, templates/, scripts/, or assets/',
    );
  }
  return normalized;
}

function assertInside(candidatePath: string, rootPath: string): void {
  const rel = path.relative(
    path.resolve(rootPath),
    path.resolve(candidatePath),
  );
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Resolved path escapes skill directory');
  }
}

function readManagedSkillManifest(skillsDir: string): ManagedSkillManifest {
  const manifest = path.join(skillsDir, '.fft_nano_managed_skills.json');
  const empty: ManagedSkillManifest = {
    managed: new Set(),
    sources: new Map(),
  };
  try {
    if (!fs.existsSync(manifest)) return empty;
    const parsed = JSON.parse(fs.readFileSync(manifest, 'utf-8'));
    if (!Array.isArray(parsed.managed)) return empty;
    const sources = new Map<string, 'project' | 'external'>();
    if (
      parsed.sources &&
      typeof parsed.sources === 'object' &&
      !Array.isArray(parsed.sources)
    ) {
      for (const [name, source] of Object.entries(
        parsed.sources as Record<string, unknown>,
      )) {
        if (source === 'project' || source === 'external') {
          sources.set(name, source);
        }
      }
    }
    return {
      managed: new Set(
        parsed.managed.filter(
          (item: unknown): item is string => typeof item === 'string',
        ),
      ),
      sources,
    };
  } catch {
    return empty;
  }
}

function readManagedSkillNames(skillsDir: string): Set<string> {
  return readManagedSkillManifest(skillsDir).managed;
}

function listSkillNames(skillsDir: string): string[] {
  if (!fs.existsSync(skillsDir)) return [];
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => fs.existsSync(path.join(skillsDir, name, 'SKILL.md')))
    .sort();
}

export function isAgentCreatedSkill(skillsDir: string, name: string): boolean {
  if (readManagedSkillNames(skillsDir).has(name)) return false;
  const usage = loadSkillUsage(skillsDir);
  return usage[name]?.created_by === 'agent';
}

function classifySource(
  name: string,
  usage: Record<string, SkillUsageRecord>,
  managedManifest: ManagedSkillManifest,
): SkillReportEntry['source'] {
  if (managedManifest.managed.has(name)) {
    return managedManifest.sources.get(name) || 'project';
  }
  if (usage[name]?.created_by === 'agent') return 'agent';
  return 'unmanaged';
}

export function buildSkillReport(
  skillsDir: string,
  includeArchived = false,
): SkillReportEntry[] {
  const usage = loadSkillUsage(skillsDir);
  const managedManifest = readManagedSkillManifest(skillsDir);
  const names = listSkillNames(skillsDir);
  if (includeArchived && fs.existsSync(archiveRoot(skillsDir))) {
    for (const entry of fs.readdirSync(archiveRoot(skillsDir), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory() && !names.includes(entry.name))
        names.push(entry.name);
    }
  }

  return names.sort().map((name) => {
    const activePath = skillDir(skillsDir, name);
    const archivedPath = archivedSkillDir(skillsDir, name);
    const basePath = fs.existsSync(activePath) ? activePath : archivedPath;
    const record = normalizeUsageRecord(usage[name]);
    if (!usage[name]) {
      record.created_at = nowIso();
    }
    if (!fs.existsSync(activePath)) {
      record.state = 'archived';
      record.archived_at = record.archived_at || nowIso();
    }
    const parsed = readSkillMarkdown(path.join(basePath, 'SKILL.md'));
    const issues = frontmatterIssues(name, parsed);
    const description =
      typeof parsed.frontmatter.description === 'string'
        ? parsed.frontmatter.description.trim()
        : '';
    return {
      name,
      path: basePath,
      source: classifySource(name, usage, managedManifest),
      usage: record,
      lastActivityAt: latestActivity(record),
      activityCount: activityCount(record),
      frontmatterOk: issues.length === 0,
      frontmatterIssues: issues,
      description,
    };
  });
}

function assertMutableAgentSkill(skillsDir: string, name: string): void {
  if (!isAgentCreatedSkill(skillsDir, name)) {
    throw new Error(
      `Skill "${name}" is source-owned or unmanaged; only agent-created runtime skills can be mutated by skill actions`,
    );
  }
}

function bumpUsage(
  skillsDir: string,
  name: string,
  kind: 'use' | 'view' | 'patch',
  markAgentCreated = false,
): SkillUsageRecord {
  const usage = loadSkillUsage(skillsDir);
  const record = normalizeUsageRecord(usage[name]);
  const ts = nowIso();
  if (markAgentCreated) record.created_by = 'agent';
  if (kind === 'use') {
    record.use_count += 1;
    record.last_used_at = ts;
  } else if (kind === 'view') {
    record.view_count += 1;
    record.last_viewed_at = ts;
  } else {
    record.patch_count += 1;
    record.last_patched_at = ts;
  }
  usage[name] = record;
  saveSkillUsage(skillsDir, usage);
  return record;
}

export function noteSkillCatalogUse(
  skillsDir: string,
  skillNames: string[],
): void {
  if (skillNames.length === 0) return;
  try {
    const usage = loadSkillUsage(skillsDir);
    const ts = nowIso();
    for (const name of skillNames) {
      const record = normalizeUsageRecord(usage[name]);
      record.use_count += 1;
      record.last_used_at = ts;
      usage[name] = record;
    }
    saveSkillUsage(skillsDir, usage);
  } catch (err) {
    logger.debug({ err }, 'Failed to record skill catalog usage');
  }
}

function resolveAuthorizedGroupFolder(input: {
  requestedGroupFolder?: string;
  sourceGroup: string;
  isMain: boolean;
}): string {
  const requested = input.requestedGroupFolder?.trim();
  if (!requested) return input.sourceGroup;
  if (!input.isMain && requested !== input.sourceGroup) {
    throw new Error('Cross-group skill action denied for non-main group');
  }
  return requested;
}

function createSkill(params: {
  skillsDir: string;
  name: string;
  description: string;
  content?: string;
}): SkillReportEntry {
  const parsedName = skillNameSchema.parse(params.name);
  const dir = skillDir(params.skillsDir, parsedName);
  if (
    fs.existsSync(dir) &&
    !isAgentCreatedSkill(params.skillsDir, parsedName)
  ) {
    throw new Error(`Refusing to replace source-owned skill "${parsedName}"`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const content = params.content?.trim()
    ? params.content
    : normalizeSkillMarkdown({
        name: parsedName,
        description: params.description || parsedName,
        body: `# ${parsedName}\n\n## When to use this skill\n\n- Use when this workflow comes up again.\n`,
      });
  const parsed = readSkillMarkdownFromContent(content);
  const description =
    typeof parsed.frontmatter.description === 'string'
      ? parsed.frontmatter.description
      : params.description || parsedName;
  const body = parsed.body || content;
  const normalized = normalizeSkillMarkdown({
    name: parsedName,
    description,
    body,
  });
  snapshotSkillFile(path.join(dir, 'SKILL.md'));
  writeTextFileAtomic(path.join(dir, 'SKILL.md'), normalized, {
    backupPath: defaultBackupPath(path.join(dir, 'SKILL.md')),
  });
  bumpUsage(params.skillsDir, parsedName, 'patch', true);
  return buildSkillReport(params.skillsDir).find(
    (entry) => entry.name === parsedName,
  )!;
}

function readSkillMarkdownFromContent(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n'))
    return { frontmatter: {}, body: normalized };
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) return { frontmatter: {}, body: normalized };
  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed = YAML.parse(normalized.slice(4, end));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = parsed as Record<string, unknown>;
    }
  } catch {
    frontmatter = {};
  }
  return {
    frontmatter,
    body: normalized.slice(end + '\n---\n'.length),
  };
}

function patchSkill(params: {
  skillsDir: string;
  name: string;
  content: string;
}): SkillReportEntry {
  const name = skillNameSchema.parse(params.name);
  assertMutableAgentSkill(params.skillsDir, name);
  const dir = skillDir(params.skillsDir, name);
  if (!fs.existsSync(dir)) throw new Error(`Skill "${name}" does not exist`);
  const parsed = readSkillMarkdownFromContent(params.content);
  const description =
    typeof parsed.frontmatter.description === 'string'
      ? parsed.frontmatter.description
      : name;
  const normalized = normalizeSkillMarkdown({
    name,
    description,
    body: parsed.body || params.content,
  });
  const target = path.join(dir, 'SKILL.md');
  // Version the prior SKILL.md before overwriting so a bad self-patch can be
  // rolled back.
  snapshotSkillFile(target);
  writeTextFileAtomic(target, normalized, {
    backupPath: defaultBackupPath(target),
  });
  bumpUsage(params.skillsDir, name, 'patch');
  return buildSkillReport(params.skillsDir).find(
    (entry) => entry.name === name,
  )!;
}

function writeSkillFile(params: {
  skillsDir: string;
  name: string;
  filePath: string;
  fileContent: string;
}): SkillReportEntry {
  const name = skillNameSchema.parse(params.name);
  assertMutableAgentSkill(params.skillsDir, name);
  const rel = assertSafeRelativeFilePath(params.filePath);
  const dir = skillDir(params.skillsDir, name);
  const target = path.join(dir, rel);
  assertInside(target, dir);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  snapshotSkillFile(target);
  writeTextFileAtomic(target, params.fileContent, {
    backupPath: defaultBackupPath(target),
  });
  bumpUsage(params.skillsDir, name, 'patch');
  return buildSkillReport(params.skillsDir).find(
    (entry) => entry.name === name,
  )!;
}

function archiveSkill(skillsDir: string, name: string): SkillReportEntry {
  const parsedName = skillNameSchema.parse(name);
  assertMutableAgentSkill(skillsDir, parsedName);
  const usage = loadSkillUsage(skillsDir);
  const record = normalizeUsageRecord(usage[parsedName]);
  if (record.pinned) throw new Error(`Skill "${parsedName}" is pinned`);
  const src = skillDir(skillsDir, parsedName);
  if (!fs.existsSync(src))
    throw new Error(`Skill "${parsedName}" is not active`);
  const dest = archivedSkillDir(skillsDir, parsedName);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(src, dest);
  record.state = 'archived';
  record.archived_at = nowIso();
  usage[parsedName] = record;
  saveSkillUsage(skillsDir, usage);
  return buildSkillReport(skillsDir, true).find(
    (entry) => entry.name === parsedName,
  )!;
}

function restoreSkill(skillsDir: string, name: string): SkillReportEntry {
  const parsedName = skillNameSchema.parse(name);
  const src = archivedSkillDir(skillsDir, parsedName);
  const dest = skillDir(skillsDir, parsedName);
  if (!fs.existsSync(src))
    throw new Error(`Archived skill "${parsedName}" not found`);
  if (fs.existsSync(dest))
    throw new Error(`Active skill "${parsedName}" already exists`);
  fs.renameSync(src, dest);
  const usage = loadSkillUsage(skillsDir);
  const record = normalizeUsageRecord(usage[parsedName]);
  record.state = 'active';
  record.archived_at = null;
  usage[parsedName] = record;
  saveSkillUsage(skillsDir, usage);
  return buildSkillReport(skillsDir).find(
    (entry) => entry.name === parsedName,
  )!;
}

function rollbackSkill(params: {
  skillsDir: string;
  name: string;
  filePath?: string;
  version?: string;
}): SkillReportEntry {
  const name = skillNameSchema.parse(params.name);
  assertMutableAgentSkill(params.skillsDir, name);
  const dir = skillDir(params.skillsDir, name);
  if (!fs.existsSync(dir)) throw new Error(`Skill "${name}" does not exist`);
  const rel = params.filePath
    ? assertSafeRelativeFilePath(params.filePath)
    : 'SKILL.md';
  const target = path.join(dir, rel);
  assertInside(target, dir);
  const restored = rollbackSkillFile(target, { version: params.version });
  if (!restored) {
    const available = listSkillHistory(target).length;
    throw new Error(
      params.version
        ? `No history version "${params.version}" for ${name}/${rel}`
        : `No prior versions to roll back for ${name}/${rel} (${available} snapshots)`,
    );
  }
  bumpUsage(params.skillsDir, name, 'patch');
  return buildSkillReport(params.skillsDir).find(
    (entry) => entry.name === name,
  )!;
}

function setPinned(
  skillsDir: string,
  name: string,
  pinned: boolean,
): SkillReportEntry {
  const parsedName = skillNameSchema.parse(name);
  assertMutableAgentSkill(skillsDir, parsedName);
  const usage = loadSkillUsage(skillsDir);
  const record = normalizeUsageRecord(usage[parsedName]);
  record.pinned = pinned;
  usage[parsedName] = record;
  saveSkillUsage(skillsDir, usage);
  return buildSkillReport(skillsDir, true).find(
    (entry) => entry.name === parsedName,
  )!;
}

export function loadSkillManagerState(skillsDir: string): SkillManagerState {
  try {
    const filePath = skillManagerStatePath(skillsDir);
    if (!fs.existsSync(filePath)) {
      // Migration: check for old curator state file
      const oldFilePath = path.join(skillsDir, '.curator_state.json');
      if (fs.existsSync(oldFilePath)) {
        try {
          const oldParsed = JSON.parse(fs.readFileSync(oldFilePath, 'utf-8'));
          const migrated = {
            ...defaultSkillManagerState(),
            ...(oldParsed || {}),
          };
          saveSkillManagerState(skillsDir, migrated);
          // Rename old file to avoid re-migrating
          fs.renameSync(oldFilePath, oldFilePath + '.migrated');
          return migrated;
        } catch {
          // fall through to default
        }
      }
      return defaultSkillManagerState();
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return { ...defaultSkillManagerState(), ...(parsed || {}) };
  } catch {
    return defaultSkillManagerState();
  }
}

export function saveSkillManagerState(
  skillsDir: string,
  state: SkillManagerState,
): void {
  writeJsonAtomic(skillManagerStatePath(skillsDir), state);
}

export function shouldRunSkillManager(
  skillsDir: string,
  config: SkillManagerConfig,
  now = new Date(),
  lastInboundAt?: number,
): boolean {
  if (!config.enabled) return false;
  const state = loadSkillManagerState(skillsDir);
  if (state.paused) return false;
  // Idle gate: don't run curator maintenance while the host is actively in use.
  if (
    config.minIdleHours > 0 &&
    typeof lastInboundAt === 'number' &&
    lastInboundAt > 0 &&
    now.getTime() - lastInboundAt < config.minIdleHours * 60 * 60 * 1000
  ) {
    return false;
  }
  if (!state.lastRunAt) {
    state.lastRunAt = now.toISOString();
    state.lastRunSummary =
      'deferred first run; manager seeded and will run after one full interval';
    saveSkillManagerState(skillsDir, state);
    return false;
  }
  const last = parseDate(state.lastRunAt);
  if (!last) return true;
  return (
    now.getTime() - last.getTime() >= config.intervalHours * 60 * 60 * 1000
  );
}

export function applySkillManagerTransitions(params: {
  skillsDir: string;
  config: SkillManagerConfig;
  dryRun?: boolean;
  now?: Date;
}): {
  checked: number;
  markedStale: number;
  archived: number;
  reactivated: number;
} {
  const now = params.now ?? new Date();
  const staleCutoff =
    now.getTime() - params.config.staleAfterDays * 24 * 60 * 60 * 1000;
  const archiveCutoff =
    now.getTime() - params.config.archiveAfterDays * 24 * 60 * 60 * 1000;
  const usage = loadSkillUsage(params.skillsDir);
  const report = buildSkillReport(params.skillsDir);
  const counts = { checked: 0, markedStale: 0, archived: 0, reactivated: 0 };

  for (const entry of report) {
    if (entry.source !== 'agent') continue;
    counts.checked += 1;
    const record = normalizeUsageRecord(usage[entry.name]);
    if (record.pinned) continue;
    const anchor =
      parseDate(entry.lastActivityAt) || parseDate(record.created_at) || now;
    const anchorMs = anchor.getTime();
    if (anchorMs <= archiveCutoff && record.state !== 'archived') {
      counts.archived += 1;
      if (!params.dryRun) {
        archiveSkill(params.skillsDir, entry.name);
        record.state = 'archived';
        record.archived_at = nowIso();
        usage[entry.name] = record;
      }
    } else if (anchorMs <= staleCutoff && record.state === 'active') {
      counts.markedStale += 1;
      if (!params.dryRun) {
        record.state = 'stale';
        usage[entry.name] = record;
      }
    } else if (anchorMs > staleCutoff && record.state === 'stale') {
      counts.reactivated += 1;
      if (!params.dryRun) {
        record.state = 'active';
        usage[entry.name] = record;
      }
    }
  }

  if (!params.dryRun) saveSkillUsage(params.skillsDir, usage);
  return counts;
}

export function snapshotSkills(params: {
  skillsDir: string;
  reason: string;
  keep: number;
}): string | null {
  if (!fs.existsSync(params.skillsDir)) return null;
  fs.mkdirSync(backupRoot(params.skillsDir), { recursive: true });
  const id = nowIso().replace(/[:.]/g, '-');
  const dest = path.join(backupRoot(params.skillsDir), id);
  fs.mkdirSync(dest, { recursive: true });
  const snapshotDir = path.join(dest, 'skills');
  fs.mkdirSync(snapshotDir, { recursive: true });
  for (const entry of fs.readdirSync(params.skillsDir, {
    withFileTypes: true,
  })) {
    if (entry.name === SKILL_BACKUP_DIR) continue;
    const src = path.join(params.skillsDir, entry.name);
    const dst = path.join(snapshotDir, entry.name);
    fs.cpSync(src, dst, { recursive: true });
  }
  writeJsonAtomic(path.join(dest, 'manifest.json'), {
    id,
    reason: params.reason,
    createdAt: nowIso(),
  });
  const backups = fs
    .readdirSync(backupRoot(params.skillsDir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const stale of backups.slice(Math.max(1, params.keep))) {
    fs.rmSync(path.join(backupRoot(params.skillsDir), stale), {
      recursive: true,
      force: true,
    });
  }
  return dest;
}

export function writeSkillManagerReport(params: {
  groupFolder: string;
  skillsDir: string;
  dryRun: boolean;
  summary: string;
  transitions: ReturnType<typeof applySkillManagerTransitions>;
}): string {
  const reportsRoot = path.join(
    resolveGroupLogsDir(params.groupFolder),
    SKILL_REPORTS_DIR,
  );
  fs.mkdirSync(reportsRoot, { recursive: true });
  const id = nowIso().replace(/[:.]/g, '-');
  const dir = path.join(reportsRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  const report = buildSkillReport(params.skillsDir, true);
  writeJsonAtomic(path.join(dir, 'run.json'), {
    dryRun: params.dryRun,
    summary: params.summary,
    transitions: params.transitions,
    skills: report,
    createdAt: nowIso(),
  });
  const badFrontmatter = report.filter((entry) => !entry.frontmatterOk);
  const lines = [
    `# Skill Manager Report ${id}`,
    '',
    params.summary,
    '',
    `- dryRun: ${params.dryRun}`,
    `- checked: ${params.transitions.checked}`,
    `- marked stale: ${params.transitions.markedStale}`,
    `- archived: ${params.transitions.archived}`,
    `- reactivated: ${params.transitions.reactivated}`,
    `- visible skills: ${report.length}`,
    `- frontmatter issues: ${badFrontmatter.length}`,
    '',
    '## Frontmatter Issues',
    ...(badFrontmatter.length
      ? badFrontmatter.map(
          (entry) => `- ${entry.name}: ${entry.frontmatterIssues.join('; ')}`,
        )
      : ['- None']),
  ];
  writeTextFileAtomic(path.join(dir, 'REPORT.md'), `${lines.join('\n')}\n`, {
    backupPath: defaultBackupPath(path.join(dir, 'REPORT.md')),
  });
  return path.join(dir, 'REPORT.md');
}

export async function executeSkillAction(
  request: SkillActionRequest,
  context: SkillActionExecutionContext,
): Promise<SkillActionResult> {
  const executedAt = nowIso();
  try {
    const parsed = skillActionSchema.parse(request);
    const groupFolder = resolveAuthorizedGroupFolder({
      requestedGroupFolder: parsed.params.groupFolder,
      sourceGroup: context.sourceGroup,
      isMain: context.isMain,
    });
    const skillsDir = resolveGroupSkillsDir(groupFolder);
    fs.mkdirSync(skillsDir, { recursive: true });

    const name = parsed.params.name?.trim();
    const result = (() => {
      switch (parsed.action) {
        case 'skill_list':
        case 'skill_status':
          return buildSkillReport(
            skillsDir,
            parsed.params.includeArchived === true,
          );
        case 'skill_view': {
          if (!name) throw new Error('skill_view requires params.name');
          const entry = buildSkillReport(skillsDir, true).find(
            (item) => item.name === name,
          );
          if (!entry) throw new Error(`Skill "${name}" not found`);
          bumpUsage(skillsDir, name, 'view');
          return {
            ...entry,
            content: fs.readFileSync(
              path.join(entry.path, 'SKILL.md'),
              'utf-8',
            ),
          };
        }
        case 'skill_create':
          if (!name) throw new Error('skill_create requires params.name');
          return createSkill({
            skillsDir,
            name,
            description: parsed.params.description || name,
            content: parsed.params.content,
          });
        case 'skill_patch':
          if (!name) throw new Error('skill_patch requires params.name');
          if (!parsed.params.content)
            throw new Error('skill_patch requires params.content');
          return patchSkill({
            skillsDir,
            name,
            content: parsed.params.content,
          });
        case 'skill_write_file':
          if (!name) throw new Error('skill_write_file requires params.name');
          if (!parsed.params.filePath)
            throw new Error('skill_write_file requires params.filePath');
          if (typeof parsed.params.fileContent !== 'string') {
            throw new Error('skill_write_file requires params.fileContent');
          }
          return writeSkillFile({
            skillsDir,
            name,
            filePath: parsed.params.filePath,
            fileContent: parsed.params.fileContent,
          });
        case 'skill_archive':
          if (!name) throw new Error('skill_archive requires params.name');
          return archiveSkill(skillsDir, name);
        case 'skill_restore':
          if (!name) throw new Error('skill_restore requires params.name');
          return restoreSkill(skillsDir, name);
        case 'skill_rollback':
          if (!name) throw new Error('skill_rollback requires params.name');
          return rollbackSkill({
            skillsDir,
            name,
            filePath: parsed.params.filePath,
            version: parsed.params.version,
          });
        case 'skill_pin':
          if (!name) throw new Error('skill_pin requires params.name');
          return setPinned(skillsDir, name, true);
        case 'skill_unpin':
          if (!name) throw new Error('skill_unpin requires params.name');
          return setPinned(skillsDir, name, false);
      }
    })();
    return {
      requestId: parsed.requestId,
      status: 'success',
      result,
      executedAt,
    };
  } catch (err) {
    return {
      requestId: request.requestId || 'unknown',
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      executedAt,
    };
  }
}

export function formatSkillManagerStatus(
  groupFolder = MAIN_GROUP_FOLDER,
): string {
  const skillsDir = resolveGroupSkillsDir(groupFolder);
  const state = loadSkillManagerState(skillsDir);
  const report = buildSkillReport(skillsDir, true);
  const active = report.filter(
    (entry) => entry.usage.state === 'active',
  ).length;
  const stale = report.filter((entry) => entry.usage.state === 'stale').length;
  const archived = report.filter(
    (entry) => entry.usage.state === 'archived',
  ).length;
  const agent = report.filter((entry) => entry.source === 'agent').length;
  const frontmatterIssues = report.filter(
    (entry) => !entry.frontmatterOk,
  ).length;
  const leastActive = report
    .filter((entry) => entry.usage.state !== 'archived')
    .sort((a, b) =>
      (a.lastActivityAt || a.usage.created_at).localeCompare(
        b.lastActivityAt || b.usage.created_at,
      ),
    )
    .slice(0, 5);
  return [
    `skill-manager: ${state.paused ? 'PAUSED' : 'ENABLED'}`,
    `runs: ${state.runCount}`,
    `last run: ${state.lastRunAt || 'never'}`,
    `last summary: ${state.lastRunSummary || '(none)'}`,
    `skills: ${report.length} total, ${agent} agent-created`,
    `states: active=${active} stale=${stale} archived=${archived}`,
    `frontmatter issues: ${frontmatterIssues}`,
    '',
    'least active:',
    ...(leastActive.length
      ? leastActive.map(
          (entry) =>
            `- ${entry.name} (${entry.source}, activity=${entry.activityCount}, state=${entry.usage.state})`,
        )
      : ['- none']),
  ].join('\n');
}

export function setSkillManagerPaused(
  groupFolder: string,
  paused: boolean,
): void {
  const skillsDir = resolveGroupSkillsDir(groupFolder);
  const state = loadSkillManagerState(skillsDir);
  state.paused = paused;
  saveSkillManagerState(skillsDir, state);
}

export function getMainWorkspaceSkillsDir(): string {
  return path.join(MAIN_WORKSPACE_DIR, 'skills');
}
