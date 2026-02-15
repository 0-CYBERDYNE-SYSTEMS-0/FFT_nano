import fs from 'fs';
import path from 'path';

import { GROUPS_DIR, MAIN_GROUP_FOLDER, MAIN_WORKSPACE_DIR } from './config.js';

const MEMORY_FILE_NAME = 'MEMORY.md';
const MEMORY_DIR_NAME = 'memory';
const SOUL_FILE_NAME = 'SOUL.md';

export function resolveGroupWorkspaceDir(groupFolder: string): string {
  if (groupFolder === MAIN_GROUP_FOLDER) return MAIN_WORKSPACE_DIR;
  return path.join(GROUPS_DIR, groupFolder);
}

export function resolveSoulPath(groupFolder: string): string {
  return path.join(resolveGroupWorkspaceDir(groupFolder), SOUL_FILE_NAME);
}

export function resolveMemoryPath(groupFolder: string): string {
  return path.join(resolveGroupWorkspaceDir(groupFolder), MEMORY_FILE_NAME);
}

export function resolveMemoryDir(groupFolder: string): string {
  return path.join(resolveGroupWorkspaceDir(groupFolder), MEMORY_DIR_NAME);
}

export function ensureMemoryScaffold(
  groupFolder: string,
  opts?: { createIfMissing?: boolean },
): { memoryPath: string; memoryDir: string } {
  const create = opts?.createIfMissing !== false;
  const memoryPath = resolveMemoryPath(groupFolder);
  const memoryDir = resolveMemoryDir(groupFolder);

  if (create) {
    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
    if (!fs.existsSync(memoryPath)) {
      fs.writeFileSync(
        memoryPath,
        '# MEMORY\n\nDurable facts, decisions, and compaction summaries belong here.\n',
      );
    }
    fs.mkdirSync(memoryDir, { recursive: true });
  }

  return { memoryPath, memoryDir };
}

export function isAllowedMemoryRelativePath(relPath: string): boolean {
  if (!relPath) return false;
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (normalized === 'MEMORY.md' || normalized === 'memory.md') {
    return true;
  }

  return /^memory\/[^/].*\.md$/i.test(normalized);
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
