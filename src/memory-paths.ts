import fs from 'fs';
import path from 'path';

import { GROUPS_DIR, MAIN_GROUP_FOLDER, MAIN_WORKSPACE_DIR } from './config.js';

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
  '4. Retrieve durable canon from canonical/*.md when needed',
  '5. Read BOOTSTRAP.md (if present)',
  '',
  'Heartbeat and scheduled maintenance runs also read HEARTBEAT.md.',
  '',
  'Memory policy:',
  '- Durable memory belongs in canonical/*.md.',
  '- Daily staging and compaction notes belong in memory/*.md.',
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

const DEFAULT_CANONICAL_BODIES: Record<string, string> = {
  '_hot.md': '# _hot\n\nHigh-priority durable memory retrieved before all other canon.\n',
  'identity.md': '# identity\n\nStable user preferences and profile facts.\n',
  'constraints.md': '# constraints\n\nStanding hard constraints and prohibitions.\n',
  'commitments.md': '# commitments\n\nActive long-lived commitments and obligations.\n',
  'projects.md': '# projects\n\nLong-lived project context and architecture notes.\n',
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
      fs.writeFileSync(
        memoryPath,
        '# MEMORY\n\nDurable facts, decisions, and compaction summaries belong here.\n',
      );
    }
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.mkdirSync(canonicalDir, { recursive: true });
    for (const [fileName, body] of Object.entries(DEFAULT_CANONICAL_BODIES)) {
      const filePath = path.join(canonicalDir, fileName);
      if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, body);
    }
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
