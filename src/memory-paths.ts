import fs from 'fs';
import path from 'path';

import { GROUPS_DIR, MAIN_GROUP_FOLDER, MAIN_WORKSPACE_DIR } from './config.js';
import { getLocalDateKey, getEffectiveTimezone } from './time-context.js';

const MEMORY_FILE_NAME = 'MEMORY.md';
const MEMORY_DIR_NAME = 'memory';
const CANONICAL_DIR_NAME = 'canonical';
const SOUL_FILE_NAME = 'SOUL.md';
const NANO_FILE_NAME = 'NANO.md';
const TODOS_FILE_NAME = 'TODOS.md';
const BOOTSTRAP_FILE_NAME = 'BOOTSTRAP.md';
const HEARTBEAT_FILE_NAME = 'HEARTBEAT.md';

const DEFAULT_NANO_BODY = [
  '# NANO',
  '',
  'Nano Core runtime contract.',
  '',
  'Session context order:',
  '1. Read NANO.md',
  '2. Read SOUL.md',
  '3. Read TODOS.md',
  '4. Read MEMORY.md',
  '5. Retrieve durable canon from canonical/*.md when needed',
  "6. Read today's memory/YYYY-MM-DD.md (auto-created on scaffold)",
  '7. Read BOOTSTRAP.md (if present)',
  '',
  'Heartbeat and scheduled maintenance runs also read HEARTBEAT.md.',
  '',
  'Memory policy:',
  '- canonical/*.md is the typed durable layer. _hot.md is always injected; the',
  '  others are retrieved on demand by path-bonus scoring.',
  '- memory/YYYY-MM-DD.md is the daily journal. One file per local-tz day;',
  "  append-only. Scaffold auto-creates today's file if missing.",
  '- MEMORY.md is operator-curated long-term memory plus compaction summaries.',
  '  Promote here only when the operator asks or a long-lived decision is made.',
  '- Keep SOUL.md stable; do not use it as compaction log storage.',
  '- TODOS.md is mission control for active execution state.',
  '',
  'Execution stance:',
  '- Use tools to verify claims and perform edits.',
  '- Prefer deterministic, testable changes.',
  '- Keep user-facing updates concise and concrete.',
].join('\n');

const DEFAULT_SOUL_BODY = [
  '# SOUL',
  '',
  'You are concise, practical, and technically rigorous.',
].join('\n');

const DEFAULT_TODOS_BODY = [
  '# TODOS.md = MISSION CONTROL: Initial Mission',
  '',
  '## 🚀 ACTIVE OBJECTIVE',
  '> Ship the next validated increment safely.',
  '',
  '## 📋 TASK BOARD',
  '- [ ] Define first active task <!-- id:T1 status:PENDING -->',
  '',
  '## 🤖 SUB-AGENTS & PROCESSES',
  '- [None]',
  '',
  '## ⏳ BLOCKED / WAITING',
  '- [None]',
  '',
  '## 📝 MISSION LOG',
  '- [00:00] - Mission control initialized.',
].join('\n');

const DEFAULT_MEMORY_BODY = [
  '# MEMORY',
  '',
  'Long-term curated memory and compaction summaries for this group.',
  '',
  'Layer split (do not collapse these into one file):',
  '- canonical/_hot.md            — always-injected high-priority durable memory',
  '- canonical/identity.md        — stable operator profile facts',
  '- canonical/constraints.md     — standing hard constraints and prohibitions',
  '- canonical/commitments.md     — active long-lived commitments',
  '- canonical/projects.md        — long-lived project context',
  '- memory/YYYY-MM-DD.md         — daily journal (auto-created, append-only)',
  '- MEMORY.md (this file)        — curated long-term memory + compaction summaries',
  '',
  'When you learn something durable, write it to the right canonical/*.md file.',
  "When you learn something transient, write it to today's memory/YYYY-MM-DD.md.",
  'Compaction summaries from long sessions land here.',
].join('\n');

const DEFAULT_CANONICAL_BODIES: Record<string, string> = {
  '_hot.md':
    '# _hot\n\nHigh-priority durable memory retrieved before all other canon.\n',
  'identity.md': '# identity\n\nStable user preferences and profile facts.\n',
  'constraints.md':
    '# constraints\n\nStanding hard constraints and prohibitions.\n',
  'commitments.md':
    '# commitments\n\nActive long-lived commitments and obligations.\n',
  'projects.md':
    '# projects\n\nLong-lived project context and architecture notes.\n',
};

const DEFAULT_USER_BODY = [
  '# FarmFriend Terminal - User Profile',
  '',
  '- Name:',
  '- Operation / Farm:',
  '- Preferences:',
  '- Safety notes:',
].join('\n');

const DEFAULT_IDENTITY_BODY = [
  '# FarmFriend Terminal - Agent Identity',
  '',
  'Name: FarmFriend Terminal',
  'Role: Local-first assistant for agriculture and operations',
].join('\n');

const DEFAULT_TOOLS_BODY = [
  '# FarmFriend Terminal - Tool Policy',
  '',
  'This file documents tool access policy. It is used as a pre-session tool manifest.',
  '',
  'Allowed tools (example):',
  'allowed-tools:',
  '',
  'Notes:',
  '- If no allowed-tools list is present, all tools remain available.',
  '- ALWAYS_ALLOWED tools (skill_loader, skill_documentation, skill_sequencer, skill_draft, skill_apply) are always permitted.',
].join('\n');

const DEFAULT_BOOTSTRAP_BODIES: Record<string, string> = {
  'USER.md': DEFAULT_USER_BODY,
  'IDENTITY.md': DEFAULT_IDENTITY_BODY,
  'TOOLS.md': DEFAULT_TOOLS_BODY,
};

export const DEFAULT_CANONICAL_FILE_NAMES = Object.freeze(
  Object.keys(DEFAULT_CANONICAL_BODIES),
);

export function resolveGroupWorkspaceDir(groupFolder: string): string {
  if (groupFolder === MAIN_GROUP_FOLDER) return MAIN_WORKSPACE_DIR;
  return path.join(GROUPS_DIR, groupFolder);
}

export function resolveSoulPath(groupFolder: string): string {
  return path.join(resolveGroupWorkspaceDir(groupFolder), SOUL_FILE_NAME);
}

export function resolveNanoPath(groupFolder: string): string {
  return path.join(resolveGroupWorkspaceDir(groupFolder), NANO_FILE_NAME);
}

export function resolveTodosPath(groupFolder: string): string {
  return path.join(resolveGroupWorkspaceDir(groupFolder), TODOS_FILE_NAME);
}

export function resolveBootstrapPath(groupFolder: string): string {
  return path.join(resolveGroupWorkspaceDir(groupFolder), BOOTSTRAP_FILE_NAME);
}

export function resolveHeartbeatPath(groupFolder: string): string {
  return path.join(resolveGroupWorkspaceDir(groupFolder), HEARTBEAT_FILE_NAME);
}

export function resolveMemoryPath(groupFolder: string): string {
  return path.join(resolveGroupWorkspaceDir(groupFolder), MEMORY_FILE_NAME);
}

export function resolveMemoryDir(groupFolder: string): string {
  return path.join(resolveGroupWorkspaceDir(groupFolder), MEMORY_DIR_NAME);
}

export function resolveCanonicalDir(groupFolder: string): string {
  return path.join(resolveGroupWorkspaceDir(groupFolder), CANONICAL_DIR_NAME);
}

export function buildDailyJournalBody(localDateKey: string): string {
  return [
    `# ${localDateKey}`,
    '',
    '> Daily journal. Append-only. Use bullets; promote durable facts to canonical/*.md.',
    '',
    '## Session Notes',
    '',
    '## Decisions',
    '',
    '## Open Questions',
    '',
  ].join('\n');
}

export function ensureDailyMemoryJournal(
  groupFolder: string,
  opts?: {
    now?: () => Date;
    timezone?: string;
    createIfMissing?: boolean;
    workspaceDir?: string;
  },
): { relPath: string; absolutePath: string; created: boolean } {
  const create = opts?.createIfMissing !== false;
  const now = opts?.now ? opts.now() : new Date();
  const tz = opts?.timezone ?? getEffectiveTimezone();
  const localDateKey = getLocalDateKey(now, tz);
  const relPath = `memory/${localDateKey}.md`;
  const baseDir =
    opts?.workspaceDir ?? resolveGroupWorkspaceDir(groupFolder);
  const absolutePath = path.join(baseDir, relPath);
  const created = create && !fs.existsSync(absolutePath);
  if (created) {
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, buildDailyJournalBody(localDateKey));
  }
  return { relPath, absolutePath, created };
}

export function ensureMemoryScaffold(
  groupFolder: string,
  opts?: { createIfMissing?: boolean },
): {
  memoryPath: string;
  memoryDir: string;
  canonicalDir: string;
  nanoPath: string;
  soulPath: string;
  todosPath: string;
} {
  const create = opts?.createIfMissing !== false;
  const workspaceDir = resolveGroupWorkspaceDir(groupFolder);
  const nanoPath = resolveNanoPath(groupFolder);
  const soulPath = resolveSoulPath(groupFolder);
  const todosPath = resolveTodosPath(groupFolder);
  const memoryPath = resolveMemoryPath(groupFolder);
  const memoryDir = resolveMemoryDir(groupFolder);
  const canonicalDir = resolveCanonicalDir(groupFolder);

  if (create) {
    fs.mkdirSync(workspaceDir, { recursive: true });
    if (!fs.existsSync(nanoPath)) {
      fs.writeFileSync(nanoPath, `${DEFAULT_NANO_BODY}\n`);
    }
    if (!fs.existsSync(soulPath)) {
      fs.writeFileSync(soulPath, `${DEFAULT_SOUL_BODY}\n`);
    }
    if (!fs.existsSync(todosPath)) {
      fs.writeFileSync(todosPath, `${DEFAULT_TODOS_BODY}\n`);
    }
    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
    if (!fs.existsSync(memoryPath)) {
      fs.writeFileSync(memoryPath, `${DEFAULT_MEMORY_BODY}\n`);
    }
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.mkdirSync(canonicalDir, { recursive: true });
    for (const [fileName, body] of Object.entries(DEFAULT_CANONICAL_BODIES)) {
      const filePath = path.join(canonicalDir, fileName);
      if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, body);
    }
    ensureDailyMemoryJournal(groupFolder);
  }

  return { memoryPath, memoryDir, canonicalDir, nanoPath, soulPath, todosPath };
}

export function isAllowedMemoryRelativePath(relPath: string): boolean {
  if (!relPath) return false;
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (
    normalized === 'NANO.md' ||
    normalized === 'SOUL.md' ||
    normalized === 'TODOS.md' ||
    normalized === 'BOOTSTRAP.md' ||
    normalized === 'HEARTBEAT.md' ||
    normalized === 'MEMORY.md' ||
    normalized === 'memory.md'
  ) {
    return true;
  }

  if (/^canonical\/[^/].*\.md$/i.test(normalized)) {
    return true;
  }

  return /^memory\/[^/].*\.md$/i.test(normalized);
}

export function isCanonicalScaffoldContent(
  fileName: string,
  content: string,
): boolean {
  const defaultBody = DEFAULT_CANONICAL_BODIES[fileName];
  if (!defaultBody) return false;
  return content.trim() === defaultBody.trim();
}

export function isBootstrapScaffoldContent(
  fileName: string,
  content: string,
): boolean {
  const defaultBody = DEFAULT_BOOTSTRAP_BODIES[fileName];
  if (!defaultBody) return false;
  return content.trim() === defaultBody.trim();
}

export function isJournalScaffoldContent(
  localDateKey: string,
  content: string,
): boolean {
  if (!localDateKey || typeof localDateKey !== 'string') return false;
  const defaultBody = buildDailyJournalBody(localDateKey);
  return content.trim() === defaultBody.trim();
}

export interface JournalPristineState {
  consecutivePristineDays: number;
  lastSeenDateKey: string | null;
}

const JOURNAL_PRISTINE_STATE_FILENAME = 'journal_pristine_state.json';

function journalPristineStatePath(workspaceDir: string): string {
  return path.join(workspaceDir, 'heartbeat', JOURNAL_PRISTINE_STATE_FILENAME);
}

export function loadJournalPristineState(
  workspaceDir: string,
): JournalPristineState {
  const statePath = journalPristineStatePath(workspaceDir);
  if (!fs.existsSync(statePath)) {
    return { consecutivePristineDays: 0, lastSeenDateKey: null };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    const days =
      typeof raw?.consecutivePristineDays === 'number' &&
      Number.isFinite(raw.consecutivePristineDays) &&
      raw.consecutivePristineDays >= 0
        ? raw.consecutivePristineDays
        : 0;
    const last =
      typeof raw?.lastSeenDateKey === 'string' && raw.lastSeenDateKey
        ? raw.lastSeenDateKey
        : null;
    return { consecutivePristineDays: days, lastSeenDateKey: last };
  } catch {
    return { consecutivePristineDays: 0, lastSeenDateKey: null };
  }
}

export function recordJournalPristineObservation(
  workspaceDir: string,
  dateKey: string,
  written: boolean,
): JournalPristineState {
  const current = loadJournalPristineState(workspaceDir);
  if (current.lastSeenDateKey === dateKey) {
    return current;
  }
  const previousCount = current.consecutivePristineDays || 0;
  const next: JournalPristineState = {
    consecutivePristineDays: written
      ? 0
      : previousCount + 1,
    lastSeenDateKey: dateKey,
  };
  fs.mkdirSync(path.dirname(journalPristineStatePath(workspaceDir)), {
    recursive: true,
  });
  fs.writeFileSync(
    journalPristineStatePath(workspaceDir),
    `${JSON.stringify(next, null, 2)}\n`,
    'utf-8',
  );
  return next;
}

export function resolveAllowedMemoryFilePath(
  groupFolder: string,
  relPath: string,
): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!isAllowedMemoryRelativePath(normalized)) {
    throw new Error(`Path "${relPath}" is not an allowed memory file`);
  }

  const workspaceDir = resolveGroupWorkspaceDir(groupFolder);
  const absolute = path.resolve(workspaceDir, normalized);
  const workspaceResolved = path.resolve(workspaceDir);
  if (
    absolute !== workspaceResolved &&
    !absolute.startsWith(`${workspaceResolved}${path.sep}`)
  ) {
    throw new Error('Resolved path escapes workspace');
  }
  return absolute;
}
