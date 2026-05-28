import fs from 'fs';
import path from 'path';

import { writeTextFileAtomic } from './atomic-write.js';

const HISTORY_DIR = '.history';
const MAX_SNAPSHOTS = 10;

// Monotonic counter so two snapshots taken in the same millisecond (e.g. a
// patch immediately followed by a rollback) get distinct, ordered versions.
let snapshotSeq = 0;

function historyDirFor(target: string): string {
  return path.join(path.dirname(target), HISTORY_DIR);
}

/**
 * Snapshot of one file version. `path` is the absolute snapshot file; `version`
 * is the sortable timestamp token embedded in its name (newest sorts last).
 */
export interface SkillHistoryEntry {
  path: string;
  base: string;
  version: string;
}

function snapshotName(base: string, version: string): string {
  return `${base}.${version}`;
}

function parseSnapshot(
  fileName: string,
  base: string,
): SkillHistoryEntry | null {
  const prefix = `${base}.`;
  if (!fileName.startsWith(prefix)) return null;
  const version = fileName.slice(prefix.length);
  if (!version) return null;
  return { path: '', base, version };
}

/**
 * List prior versions of `target` (a skill file like .../SKILL.md), newest
 * last. Only snapshots of that exact base name are returned, so multiple files
 * can share one `.history/` dir without collisions.
 */
export function listSkillHistory(target: string): SkillHistoryEntry[] {
  const dir = historyDirFor(target);
  const base = path.basename(target);
  if (!fs.existsSync(dir)) return [];
  const entries: SkillHistoryEntry[] = [];
  for (const fileName of fs.readdirSync(dir)) {
    const parsed = parseSnapshot(fileName, base);
    if (!parsed) continue;
    entries.push({ ...parsed, path: path.join(dir, fileName) });
  }
  entries.sort((a, b) => a.version.localeCompare(b.version));
  return entries;
}

function pruneHistory(target: string, keep = MAX_SNAPSHOTS): void {
  const entries = listSkillHistory(target);
  const excess = entries.length - keep;
  for (let i = 0; i < excess; i += 1) {
    try {
      fs.rmSync(entries[i].path, { force: true });
    } catch {
      /* best-effort prune */
    }
  }
}

/**
 * Snapshot the current contents of `target` into its `.history/` dir before it
 * is overwritten, so every skill mutation leaves a recoverable prior version.
 * No-op when the target does not yet exist (first write). Returns the snapshot
 * path, or null if there was nothing to snapshot.
 */
export function snapshotSkillFile(target: string): string | null {
  if (!fs.existsSync(target)) return null;
  const dir = historyDirFor(target);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(target);
  // Sortable, filename-safe UTC timestamp plus a monotonic suffix so versions
  // stay strictly ordered even within the same millisecond.
  const seq = (snapshotSeq += 1).toString(36).padStart(6, '0');
  const version = `${new Date().toISOString().replace(/[:.]/g, '')}-${seq}`;
  const dest = path.join(dir, snapshotName(base, version));
  fs.copyFileSync(target, dest);
  pruneHistory(target);
  return dest;
}

/**
 * Restore a prior version of `target` from its `.history/`. By default restores
 * the most recent snapshot; pass `version` to restore a specific one. The
 * current contents are snapshotted first, so a rollback is itself reversible.
 * Returns the version restored, or null when there is no history to restore.
 */
export function rollbackSkillFile(
  target: string,
  options: { version?: string } = {},
): string | null {
  const entries = listSkillHistory(target);
  if (entries.length === 0) return null;
  const chosen = options.version
    ? entries.find((entry) => entry.version === options.version)
    : entries[entries.length - 1];
  if (!chosen) return null;
  const restored = fs.readFileSync(chosen.path, 'utf-8');
  // Snapshot current state before clobbering it so rollback is reversible.
  snapshotSkillFile(target);
  writeTextFileAtomic(target, restored);
  return chosen.version;
}
