import child_process from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { logger } from './logger.js';
import {
  FFT_NANO_TRASH_RETENTION_DAYS,
  FFT_NANO_TEST_GROUP_RETENTION_DAYS,
  FFT_NANO_WORKSPACE_MAINTENANCE_ENABLED,
  MAIN_GROUP_FOLDER,
} from './config.js';

// SPEC-09 — workspace hygiene sweep.
//
// Three complementary cleanup primitives. All are best-effort: failures on
// any individual file/folder are caught and reported in the result object,
// never thrown. This module is intentionally side-effect-light; gating flags
// live in `src/app-config.ts`. The actual scheduling hook (heartbeat idle
// slot or cron tick) is wired separately so the module stays unit-testable
// without any host bootstrap required.

const DEFAULT_WHITELIST = ['.env.local', '.env.local.*'];

const TEST_GROUP_PATTERNS: RegExp[] = [
  /^test-/i,
  /^scratch-/i,
  /^temp-/i,
];

export interface PurgeOldMemoryTrashOptions {
  memoryTrashDir?: string;
  archiveRoot?: string;
  now?: () => Date;
  retentionDays?: number;
  /**
   * Override the master gate for tests/operators. When unset, defaults to
   * `FFT_NANO_WORKSPACE_MAINTENANCE_ENABLED`. When explicitly `true`, the
   * function runs even if the env flag is off; when explicitly `false`,
   * the function short-circuits regardless of env. This is the only way to
   * exercise the real code path without mutating global env.
   */
  enabled?: boolean;
}

export interface PurgeOldMemoryTrashResult {
  scanned: number;
  archivedFiles: string[];
  skippedRecent: string[];
  archiveBucket: string | null;
  deletedSourceDir: boolean;
  retentionDays: number;
  errors: Array<{ file: string; error: string }>;
  skipped: boolean;
}

function resolveArchiveRoot(opts?: { archiveRoot?: string }): string {
  if (opts?.archiveRoot) return path.resolve(opts.archiveRoot);
  const home = process.env.HOME || os.homedir();
  return path.resolve(path.join(home, 'nano', 'memory'));
}

function resolveTrashDir(opts?: { memoryTrashDir?: string }): string {
  if (opts?.memoryTrashDir) return path.resolve(opts.memoryTrashDir);
  const home = process.env.HOME || os.homedir();
  return path.resolve(path.join(home, 'nano', 'memory', 'trash'));
}

function safeMtimeMs(target: string): number {
  try {
    return fs.statSync(target).mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isTrashArchiveBucket(bucketName: string): boolean {
  // Be defensive — never stage files into an arbitrary directory that happens
  // to start with "trash" if a user (or a misconfigured hook) points us
  // somewhere unexpected. Only buckets that explicitly look like our dated
  // archive naming are created on demand.
  return /^trash-archive-\d{4}-\d{2}$/.test(bucketName);
}

export function purgeOldMemoryTrash(
  opts?: PurgeOldMemoryTrashOptions,
): PurgeOldMemoryTrashResult {
  const retentionDays =
    typeof opts?.retentionDays === 'number' && opts.retentionDays >= 0
      ? opts.retentionDays
      : FFT_NANO_TRASH_RETENTION_DAYS;
  const now = (opts?.now ?? (() => new Date()))();
  const thresholdMs = now.getTime() - retentionDays * 86_400_000;

  const trashDir = resolveTrashDir(opts);
  const archiveRoot = resolveArchiveRoot(opts);
  const result: PurgeOldMemoryTrashResult = {
    scanned: 0,
    archivedFiles: [],
    skippedRecent: [],
    archiveBucket: null,
    deletedSourceDir: false,
    retentionDays,
    errors: [],
    skipped: false,
  };

  if (!fftNanoWorkspaceMaintenanceEnabled(opts?.enabled)) {
    logger.debug(
      { module: 'workspace-maintenance' },
      'purgeOldMemoryTrash skipped: FFT_NANO_WORKSPACE_MAINTENANCE_ENABLED=false',
    );
    result.skipped = true;
    return result;
  }

  if (!fs.existsSync(trashDir)) {
    logger.debug(
      { module: 'workspace-maintenance', trashDir },
      'purgeOldMemoryTrash: trash dir does not exist, nothing to do',
    );
    return result;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(trashDir, { withFileTypes: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push({ file: trashDir, error: message });
    logger.warn(
      { err, trashDir },
      'purgeOldMemoryTrash failed to read trash directory',
    );
    return result;
  }
  result.scanned = entries.length;

  // Pre-compute the dated bucket once and reuse. YYYY-MM in the runtime
  // timezone — UTC is fine for ops hygiene; host-local time would risk a
  // bucketing skew at month boundaries.
  const bucketName = `trash-archive-${now.getUTCFullYear()}-${String(
    now.getUTCMonth() + 1,
  ).padStart(2, '0')}`;
  if (!isTrashArchiveBucket(bucketName)) {
    logger.warn(
      { module: 'workspace-maintenance', bucketName },
      'purgeOldMemoryTrash: bucket name did not match expected pattern; aborting',
    );
    result.errors.push({
      file: trashDir,
      error: `unsafe archive bucket name: ${bucketName}`,
    });
    return result;
  }
  const archiveBucket = path.join(archiveRoot, bucketName);

  try {
    fs.mkdirSync(archiveBucket, { recursive: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push({ file: archiveBucket, error: message });
    logger.warn(
      { err, archiveBucket },
      'purgeOldMemoryTrash failed to create archive bucket',
    );
    return result;
  }
  result.archiveBucket = archiveBucket;

  for (const entry of entries) {
    const entryPath = path.join(trashDir, entry.name);
    if (entry.isDirectory()) continue;
    const mtime = safeMtimeMs(entryPath);
    if (!Number.isFinite(mtime)) {
      result.errors.push({ file: entryPath, error: 'cannot stat mtime' });
      continue;
    }
    if (mtime > thresholdMs) {
      result.skippedRecent.push(entry.name);
      continue;
    }
    const targetPath = path.join(archiveBucket, entry.name);
    try {
      fs.renameSync(entryPath, targetPath);
      result.archivedFiles.push(entry.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ file: entryPath, error: message });
      logger.warn(
        { err, entryPath, targetPath },
        'purgeOldMemoryTrash: failed to move file',
      );
    }
  }

  // If the source trash dir is now empty, drop it. Otherwise the spec only
  // asks us to *move* stale files — empty-trash side-effect must be opt-in
  // and is intentionally conservative.
  try {
    const remaining = fs.readdirSync(trashDir);
    if (remaining.length === 0) {
      fs.rmdirSync(trashDir);
      result.deletedSourceDir = true;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.debug(
      { err, trashDir },
      'purgeOldMemoryTrash: trash dir not empty or unreadable; leaving in place',
    );
    result.errors.push({ file: trashDir, error: message });
  }

  logger.info(
    {
      module: 'workspace-maintenance',
      scanned: result.scanned,
      archived: result.archivedFiles.length,
      skippedRecent: result.skippedRecent.length,
      retentionDays: result.retentionDays,
      archiveBucket: result.archiveBucket,
      deletedSourceDir: result.deletedSourceDir,
      errors: result.errors.length,
    },
    'purgeOldMemoryTrash completed',
  );

  return result;
}

export interface PurgeOldTestGroupsOptions {
  groupsDir?: string;
  archiveRoot?: string;
  now?: () => Date;
  retentionDays?: number;
  protectedFolders?: readonly string[];
  /**
   * Override the master gate for tests/operators. Same semantics as
   * `purgeOldMemoryTrashOptions.enabled`.
   */
  enabled?: boolean;
}

export interface PurgeOldTestGroupsResult {
  groupsDir: string;
  archiveRoot: string;
  matchedFolders: string[];
  archivedTarballs: string[];
  removedFolders: string[];
  retentionDays: number;
  protectedFolders: readonly string[];
  errors: Array<{ group: string; error: string }>;
  skipped: boolean;
}

function resolveGroupsDir(opts?: { groupsDir?: string }): string {
  if (opts?.groupsDir) return path.resolve(opts.groupsDir);
  // The spec keeps the live groups dir separate from the runtime workspace
  // by default (the live tree is `groups/` relative to `cwd`). Callers can
  // override; we never assume `~/fft_nano/groups`.
  return path.resolve(process.cwd(), 'groups');
}

function resolvePurgedGroupsRoot(opts?: { archiveRoot?: string }): string {
  if (opts?.archiveRoot) return path.resolve(opts.archiveRoot);
  const home = process.env.HOME || os.homedir();
  return path.resolve(path.join(home, 'fft_nano', 'archive', 'purged-groups'));
}

function isProductionGroup(folder: string): boolean {
  // Hard-coded safety net: `main` is the only group shipped by default and
  // must never match the test-* / scratch-* / temp-* patterns because the
  // invocation site can opt to use or ignore `protectedFolders`. If a future
  // release ships additional always-on groups, extend this set. Callers can
  // further broaden the safety net through `protectedFolders`.
  return folder === MAIN_GROUP_FOLDER;
}

function matchesTestGroupPattern(folder: string): boolean {
  return TEST_GROUP_PATTERNS.some((re) => re.test(folder));
}

function tarDirectoryToFile(srcDir: string, tarPath: string): void {
  // Node's child_process.spawnSync with -czf to keep this dependency-free.
  // tar is available on macOS, Linux, and Termux out of the box.
  const result = child_process.spawnSync(
    'tar',
    ['-czf', tarPath, '-C', path.dirname(srcDir), path.basename(srcDir)],
    { encoding: 'utf-8' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `tar exited with status ${result.status}: ${(result.stderr || '').trim()}`,
    );
  }
}

export function purgeOldTestGroups(
  opts?: PurgeOldTestGroupsOptions,
): PurgeOldTestGroupsResult {
  const retentionDays =
    typeof opts?.retentionDays === 'number' && opts.retentionDays >= 0
      ? opts.retentionDays
      : FFT_NANO_TEST_GROUP_RETENTION_DAYS;
  const now = (opts?.now ?? (() => new Date()))();
  const thresholdMs = now.getTime() - retentionDays * 86_400_000;

  const groupsDir = resolveGroupsDir(opts);
  const archiveRoot = resolvePurgedGroupsRoot(opts);
  const protectedFolders = opts?.protectedFolders ?? [];
  const result: PurgeOldTestGroupsResult = {
    groupsDir,
    archiveRoot,
    matchedFolders: [],
    archivedTarballs: [],
    removedFolders: [],
    retentionDays,
    protectedFolders,
    errors: [],
    skipped: false,
  };

  if (!fftNanoWorkspaceMaintenanceEnabled(opts?.enabled)) {
    logger.debug(
      { module: 'workspace-maintenance' },
      'purgeOldTestGroups skipped: FFT_NANO_WORKSPACE_MAINTENANCE_ENABLED=false',
    );
    result.skipped = true;
    return result;
  }

  if (!fs.existsSync(groupsDir)) {
    logger.debug(
      { groupsDir },
      'purgeOldTestGroups: groupsDir does not exist, nothing to do',
    );
    return result;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(groupsDir, { withFileTypes: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push({ group: groupsDir, error: message });
    logger.warn({ err, groupsDir }, 'purgeOldTestGroups failed to read groups dir');
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (isProductionGroup(entry.name)) {
      // Hard rule: never auto-purge a group recognized as production.
      continue;
    }
    if (protectedFolders.includes(entry.name)) continue;
    if (!matchesTestGroupPattern(entry.name)) continue;
    const fullPath = path.join(groupsDir, entry.name);
    const mtime = safeMtimeMs(fullPath);
    if (!Number.isFinite(mtime)) continue;
    if (mtime > thresholdMs) continue;
    result.matchedFolders.push(entry.name);
  }

  if (result.matchedFolders.length === 0) {
    logger.debug(
      { groupsDir },
      'purgeOldTestGroups: no test groups older than retention window',
    );
    return result;
  }

  try {
    fs.mkdirSync(archiveRoot, { recursive: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push({ group: archiveRoot, error: message });
    logger.warn(
      { err, archiveRoot },
      'purgeOldTestGroups failed to create archive root',
    );
    return result;
  }

  const stamp = `${now.getUTCFullYear()}${String(
    now.getUTCMonth() + 1,
  ).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}-${String(
    now.getUTCHours(),
  ).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}`;

  for (const folder of result.matchedFolders) {
    const srcDir = path.join(groupsDir, folder);
    const tarName = `purged-${folder}-${stamp}.tar.gz`;
    const tarPath = path.join(archiveRoot, tarName);
    try {
      tarDirectoryToFile(srcDir, tarPath);
      result.archivedTarballs.push(tarPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ group: folder, error: message });
      logger.warn(
        { err, srcDir, tarPath },
        'purgeOldTestGroups: tar archive failed; skipping delete',
      );
      continue;
    }
    try {
      fs.rmSync(srcDir, { recursive: true, force: true });
      result.removedFolders.push(folder);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ group: folder, error: message });
      logger.warn(
        { err, srcDir },
        'purgeOldTestGroups: archived but failed to remove source folder',
      );
    }
  }

  logger.info(
    {
      module: 'workspace-maintenance',
      matched: result.matchedFolders.length,
      archived: result.archivedTarballs.length,
      removed: result.removedFolders.length,
      retentionDays: result.retentionDays,
      archiveRoot: result.archiveRoot,
      errors: result.errors.length,
    },
    'purgeOldTestGroups completed',
  );

  return result;
}

export interface WorktreeCleanliness {
  worktreePath: string;
  clean: boolean;
  modifiedCount: number;
  untrackedCount: number;
  modifiedFiles: string[];
  untrackedFiles: string[];
  whitelistApplied: boolean;
  whitelistHits: string[];
  warnings: string[];
}

export interface CheckWorktreeCleanlinessOptions {
  cwd?: string;
  whitelist?: readonly string[];
  now?: () => Date;
  runGitStatus?: (cwd: string) => string;
}

const DEFAULT_WORKTREE_WHITELIST = DEFAULT_WHITELIST;

function parseGitStatusShort(output: string): {
  modified: string[];
  untracked: string[];
  warnings: string[];
} {
  const modified: string[] = [];
  const untracked: string[] = [];
  const warnings: string[] = [];
  for (const rawLine of output.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line) continue;
    // Two-character porcelain status, then a space, then the path. Untracked
    // entries show as "??" rather than a tracked-status code.
    const xy = line.slice(0, 2);
    const rest = line.slice(3);
    if (xy === '??') {
      untracked.push(rest);
      continue;
    }
    if (!/^[ MADRCU?!]{2}$/.test(xy)) {
      warnings.push(line);
      continue;
    }
    if (xy !== '!!' && rest) {
      modified.push(rest);
      continue;
    }
    warnings.push(line);
  }
  return { modified, untracked, warnings };
}

function defaultRunGitStatus(cwd: string): string {
  const result = child_process.spawnSync(
    'git',
    ['status', '--short', '--untracked-files=all'],
    { cwd, encoding: 'utf-8' },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `git status exited with status ${result.status}: ${(result.stderr || '').trim()}`,
    );
  }
  return result.stdout || '';
}

export function checkWorktreeCleanliness(
  opts?: CheckWorktreeCleanlinessOptions,
): WorktreeCleanliness {
  const cwd = opts?.cwd ?? process.cwd();
  const whitelist = new Set<string>(
    opts?.whitelist ?? DEFAULT_WORKTREE_WHITELIST,
  );
  const runGit = opts?.runGitStatus ?? defaultRunGitStatus;

  let raw = '';
  let gitError: string | null = null;
  try {
    raw = runGit(cwd);
  } catch (err) {
    gitError = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err, cwd },
      'checkWorktreeCleanliness: git status failed',
    );
  }

  const parsed = parseGitStatusShort(raw);
  const whitelistHits: string[] = [];
  const modifiedFiles: string[] = [];
  const untrackedFiles: string[] = [];
  for (const entry of parsed.modified) {
    const basename = path.basename(entry);
    if (whitelist.has(basename) || basename.startsWith('.env.local.')) {
      whitelistHits.push(entry);
      continue;
    }
    modifiedFiles.push(entry);
  }
  for (const entry of parsed.untracked) {
    const basename = path.basename(entry);
    if (whitelist.has(basename) || basename.startsWith('.env.local.')) {
      whitelistHits.push(entry);
      continue;
    }
    untrackedFiles.push(entry);
  }

  const warnings: string[] = [...parsed.warnings];
  if (gitError) warnings.push(`git status error: ${gitError}`);

  const clean = modifiedFiles.length === 0 && untrackedFiles.length === 0;
  const worktreePath = cwd;

  // Observational only — the spec explicitly says do not auto-clean the
  // runtime worktree. We log a warning so an operator (or a heartbeat
  // witness) sees something actionable when there is noise to clean up.
  if (!clean) {
    logger.warn(
      {
        module: 'workspace-maintenance',
        worktreePath,
        modifiedCount: modifiedFiles.length,
        untrackedCount: untrackedFiles.length,
        whitelistHits: whitelistHits.length,
      },
      'checkWorktreeCleanliness: worktree has untracked or modified files',
    );
  } else {
    logger.debug(
      { module: 'workspace-maintenance', worktreePath },
      'checkWorktreeCleanliness: working tree clean',
    );
  }

  void MAIN_GROUP_FOLDER; // keep import to surface config type and avoid dead-code warnings
  void FFT_NANO_WORKSPACE_MAINTENANCE_ENABLED;

  return {
    worktreePath,
    clean,
    modifiedCount: modifiedFiles.length,
    untrackedCount: untrackedFiles.length,
    modifiedFiles,
    untrackedFiles,
    whitelistApplied: whitelist.size > 0,
    whitelistHits,
    warnings,
  };
}

function fftNanoWorkspaceMaintenanceEnabled(override?: boolean): boolean {
  if (typeof override === 'boolean') return override;
  return FFT_NANO_WORKSPACE_MAINTENANCE_ENABLED;
}
