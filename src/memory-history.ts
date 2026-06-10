import fs from 'fs';
import path from 'path';

import { writeTextFileAtomic } from './atomic-write.js';
import { PARITY_CONFIG } from './config.js';

const HISTORY_DIR = '.history';
const MAX_SNAPSHOTS = 10;
const DEFAULT_RETENTION_DAYS = 14;

// Monotonic counter so two snapshots taken in the same millisecond get distinct versions.
let snapshotSeq = 0;

function historyDirFor(target: string): string {
  return path.join(path.dirname(target), HISTORY_DIR);
}

/**
 * Parse the embedded timestamp from a version string.
 * Version format: YYYYMMDDTHHMMSSfffZ-SEQ  (mirrors skill-history.ts)
 */
export function parseMemoryVersionTimestamp(version: string): Date | null {
  const zIdx = version.indexOf('Z');
  if (zIdx < 0) return null;
  const ts = version.slice(0, zIdx + 1); // e.g. 2026-06-10T160321039Z
  if (ts.length < 20) return null;
  const year = parseInt(ts.slice(0, 4), 10);
  const month = parseInt(ts.slice(5, 7), 10);
  const day = parseInt(ts.slice(8, 10), 10);
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

export interface MemoryHistoryEntry {
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
): MemoryHistoryEntry | null {
  const prefix = `${base}.`;
  if (!fileName.startsWith(prefix)) return null;
  const version = fileName.slice(prefix.length);
  if (!version) return null;
  return { path: '', base, version };
}

/**
 * List prior versions of `target` (a memory file like .../MEMORY.md), newest last.
 */
export function listMemoryHistory(target: string): MemoryHistoryEntry[] {
  const dir = historyDirFor(target);
  const base = path.basename(target);
  if (!fs.existsSync(dir)) return [];
  const entries: MemoryHistoryEntry[] = [];
  for (const fileName of fs.readdirSync(dir)) {
    const parsed = parseSnapshot(fileName, base);
    if (!parsed) continue;
    entries.push({ ...parsed, path: path.join(dir, fileName) });
  }
  entries.sort((a, b) => a.version.localeCompare(b.version));
  return entries;
}

/**
 * Prune old memory snapshots, keeping:
 *  - Any snapshot whose embedded timestamp is within the retention window (time floor)
 *  - Plus the newest MAX_SNAPSHOTS from those OUTSIDE the retention window
 */
function pruneMemoryHistory(
  target: string,
  keep = MAX_SNAPSHOTS,
  retentionDays = DEFAULT_RETENTION_DAYS,
): void {
  const entries = listMemoryHistory(target);
  if (entries.length === 0) return;

  const nowMs = Date.now();
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  const cutoff = nowMs - retentionMs;

  const inWindowEntries: typeof entries = [];
  const outOfWindowEntries: typeof entries = [];
  for (const entry of entries) {
    const ts = parseMemoryVersionTimestamp(entry.version);
    if (ts !== null && ts.getTime() >= cutoff) {
      inWindowEntries.push(entry);
    } else {
      outOfWindowEntries.push(entry);
    }
  }

  const keepSet = new Set<string>(inWindowEntries.map((e) => e.path));
  // For out-of-window entries (oldest-first), keep newest `keep` of them
  const outOfWindowKeep = outOfWindowEntries.slice(-keep);
  for (const entry of outOfWindowKeep) {
    keepSet.add(entry.path);
  }

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
 * is overwritten, so every memory mutation leaves a recoverable prior version.
 * No-op when the target does not yet exist. Returns the snapshot path, or null.
 *
 * Attribution data (authorityId, senderRole, jid) is stored in a companion .attr.json
 * file alongside the snapshot.
 */
export function snapshotMemoryFile(
  target: string,
  attribution?: {
    authorityId: string;
    senderRole: string;
    jid?: string;
  },
  retentionDays = DEFAULT_RETENTION_DAYS,
): string | null {
  if (!fs.existsSync(target)) return null;
  const dir = historyDirFor(target);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(target);
  const seq = (snapshotSeq += 1).toString(36).padStart(6, '0');
  const version = `${new Date().toISOString().replace(/[:.]/g, '')}-${seq}`;
  const dest = path.join(dir, snapshotName(base, version));
  fs.copyFileSync(target, dest);

  // Write attribution metadata alongside the snapshot
  if (attribution) {
    const attrPath = `${dest}.attr.json`;
    try {
      fs.writeFileSync(attrPath, JSON.stringify(attribution, null, 2));
    } catch {
      /* best-effort */
    }
  }

  pruneMemoryHistory(target, MAX_SNAPSHOTS, retentionDays);
  return dest;
}

/**
 * Restore a prior version of `target` from its `.history/`. By default restores
 * the most recent snapshot; pass `version` to restore a specific one. The
 * current contents are snapshotted first so rollback is reversible.
 * Returns the version restored, or null when there is no history.
 */
export function rollbackMemoryFile(
  target: string,
  options: { version?: string } = {},
): string | null {
  const entries = listMemoryHistory(target);
  if (entries.length === 0) return null;
  const chosen = options.version
    ? entries.find((entry) => entry.version === options.version)
    : entries[entries.length - 1];
  if (!chosen) return null;
  const restored = fs.readFileSync(chosen.path, 'utf-8');
  // Snapshot current state before clobbering so rollback is reversible
  snapshotMemoryFile(target);
  writeTextFileAtomic(target, restored);
  return chosen.version;
}

/**
 * Get attribution for a specific memory history snapshot.
 */
export function getMemorySnapshotAttribution(
  snapshotPath: string,
): { authorityId: string; senderRole: string; jid?: string } | null {
  const attrPath = `${snapshotPath}.attr.json`;
  try {
    if (fs.existsSync(attrPath)) {
      return JSON.parse(fs.readFileSync(attrPath, 'utf-8'));
    }
  } catch {
    /* best-effort */
  }
  return null;
}
