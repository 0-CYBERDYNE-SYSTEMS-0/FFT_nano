import fs from 'fs';
import path from 'path';

import { writeTextFileAtomic } from './atomic-write.js';

const HISTORY_DIR = '.history';
const MAX_SNAPSHOTS = 10;
const DEFAULT_RETENTION_DAYS = 14;

// Monotonic counter so two snapshots taken in the same millisecond (e.g. a
// patch immediately followed by a rollback) get distinct, ordered versions.
let snapshotSeq = 0;

function historyDirFor(target: string): string {
  return path.join(path.dirname(target), HISTORY_DIR);
}

/**
 * Parse the embedded timestamp from a version string.
 * Version format: YYYYMMDDTHHMMSSfffZ-SEQ  (e.g. 20260110T153022412Z-000001)
 * Returns null if the version string is malformed.
 */
export function parseVersionTimestamp(version: string): Date | null {
  // snapshotSkillFile uses .toISOString().replace(/[:.]/g, ''):
  //   Input:  2026-06-10T16:03:21.039Z
  //   Output: 2026-06-10T160321039Z  (dashes in date, no dashes in time)
  // Version: 2026-06-10T160321039Z-000001 (timestamp-SEQ)
  // Note: HH, MM, SS have no leading zeros stripped (they come from toISOString)
  const zIdx = version.indexOf('Z');
  if (zIdx < 0) return null;
  // Include Z in timestamp: YYYY-MM-DDTHHMMSSmmmZ
  const ts = version.slice(0, zIdx + 1); // e.g. 2026-06-10T160321039Z

  // ts format: YYYY-MM-DDTHHMMSSmmmZ (20 chars)
  // Date: YYYY-MM-DD (10 chars: 4+1+2+1+2)
  // T separator at position 10
  // Time: HHMMSSmmm (9 chars: 2+2+2+3)
  if (ts.length < 20) return null;
  const year = parseInt(ts.slice(0, 4), 10);
  const month = parseInt(ts.slice(5, 7), 10);
  const day = parseInt(ts.slice(8, 10), 10);
  // ts[10] is 'T'
  const hour = parseInt(ts.slice(11, 13), 10);
  const minute = parseInt(ts.slice(13, 15), 10);
  const second = parseInt(ts.slice(15, 17), 10);
  const ms = parseInt(ts.slice(17, 20), 10);
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    Number.isNaN(second) ||
    Number.isNaN(ms)
  )
    return null;
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
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

/**
 * Prune old snapshots, keeping:
 *  - Any snapshot whose embedded timestamp is within the retention window
 *    (time floor — these are protected from count-based pruning)
 *  - Plus the newest `keep` snapshots from those OUTSIDE the retention window
 *
 * The version timestamp is parsed from the snapshot filename (not the filesystem
 * mtime), so pruning behavior is independent of filesystem ordering.
 */
function pruneHistory(
  target: string,
  keep = MAX_SNAPSHOTS,
  retentionDays = DEFAULT_RETENTION_DAYS,
): void {
  const entries = listSkillHistory(target);
  if (entries.length === 0) return;

  const nowMs = Date.now();
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  const cutoff = nowMs - retentionMs;

  // Partition entries into in-window (protected) and out-of-window (count-capped)
  const inWindowEntries: typeof entries = [];
  const outOfWindowEntries: typeof entries = [];
  for (const entry of entries) {
    const ts = parseVersionTimestamp(entry.version);
    if (ts !== null && ts.getTime() >= cutoff) {
      inWindowEntries.push(entry);
    } else {
      outOfWindowEntries.push(entry);
    }
  }

  // Keep all in-window entries (time floor); for out-of-window, keep newest `keep`
  const keepSet = new Set<string>(inWindowEntries.map((e) => e.path));

  // Out-of-window entries are sorted oldest-first; take the newest `keep` of them
  const outOfWindowKeep = outOfWindowEntries.slice(-keep);
  for (const entry of outOfWindowKeep) {
    keepSet.add(entry.path);
  }

  // Remove everything not in the keep-set
  for (const entry of entries) {
    if (keepSet.has(entry.path)) continue;
    try {
      fs.rmSync(entry.path, { force: true });
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
export function snapshotSkillFile(
  target: string,
  retentionDays = DEFAULT_RETENTION_DAYS,
): string | null {
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
  pruneHistory(target, MAX_SNAPSHOTS, retentionDays);
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
