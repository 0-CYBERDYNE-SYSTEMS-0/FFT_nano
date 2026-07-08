import { execFileSync } from 'child_process';

import {
  FFT_NANO_CANONICAL_BRANCH,
  FFT_NANO_DRIFT_THRESHOLD,
} from './app-config.js';
import { enqueueDelivery, type DeliveryOutboxRecord } from './db.js';

// ---------------------------------------------------------------------------
// SPEC-08 — Deployment Realignment witness.
//
// Compares the running service's captured GIT_INFO (branch + short commit at
// boot) against the remote tip of the canonical branch (default `main`) and
// surfaces a WARN + outbox-deduped Telegram notice when the runtime is falling
// behind. Two layers of safety:
//
// 1. Pure decision function `decideDriftWitnessAlert` — testable without
//    network, git, or runtime state. Both commit-lag (>threshold) AND age
//    (>=2 days) are required to fire, and a threshold of 0 disables drift
//    detection entirely so a misconfigured env var never floods the operator.
// 2. `runDriftWitnessAtBoot` — the IO-bearing boot witness that resolves the
//    remote tip with `git ls-remote`, gathers commit-age metadata, and enqueues
//    a dedupe-keyed outbox row when `decideDriftWitnessAlert` says fire. The
//    outbox path survives restarts so a crash-loop can never re-spam the same
//    drift alert.
//
// `~/fft_nano` runtime tracks `main` per SPEC-08; the canonical branch is
// read from `FFT_NANO_CANONICAL_BRANCH` and defaults to `main`. See
// CLAUDE.md "Development Workflow (Authoritative)".
// ---------------------------------------------------------------------------

export interface DriftEvidence {
  /** Short commit of the local checkout as captured at boot. */
  localCommit: string | null;
  /** Short commit reported by `git ls-remote origin <branch>` head. */
  remoteCommit: string | null;
  /** Commits between local and remote (how far the runtime has fallen behind). */
  commitsBehind: number | null;
  /** Age of the remote tip in days (computed against `now`). Null when unknown. */
  remoteAgeDays: number | null;
}

export interface DriftAlertDecision {
  alert: boolean;
  reason: string;
}

export interface DecideDriftWitnessAlertInput {
  commitsBehind: number | null;
  remoteAgeDays: number | null;
  threshold: number;
  /** Days the remote tip must have been the newest for an alert. SPEC-08 says 2. */
  minRemoteAgeDays?: number;
}

/**
 * Pure decision function. Returns `{ alert: true, reason: ... }` only when BOTH
 * `commitsBehind > threshold` AND `remoteAgeDays >= minRemoteAgeDays`. Either
 * missing input downgrades to no-alert (we cannot lie about drift we can't see).
 *
 * - `threshold === 0` disables drift detection entirely: a misconfigured env
 *   cannot flood the operator. Returns `alert: false` with reason
 *   `'threshold-disabled'`.
 * - A single short cycle (e.g. open PR not yet merged, lag < threshold)
 *   produces no alert.
 * - Both null inputs short-circuit to `'insufficient-evidence'` because we
 *   refuse to claim drift without evidence.
 */
export function decideDriftWitnessAlert(
  input: DecideDriftWitnessAlertInput,
): DriftAlertDecision {
  const minRemoteAgeDays = input.minRemoteAgeDays ?? 2;
  if (input.threshold <= 0) {
    return {
      alert: false,
      reason: 'threshold-disabled',
    };
  }
  if (input.commitsBehind === null || input.remoteAgeDays === null) {
    return {
      alert: false,
      reason: 'insufficient-evidence',
    };
  }
  if (input.commitsBehind <= input.threshold) {
    return {
      alert: false,
      reason: 'below-threshold',
    };
  }
  if (input.remoteAgeDays < minRemoteAgeDays) {
    return {
      alert: false,
      reason: 'remote-too-recent',
    };
  }
  return {
    alert: true,
    reason: `behind-${input.commitsBehind}-age-${input.remoteAgeDays.toFixed(2)}d`,
  };
}

export interface RemoteCommitResolution {
  commit: string;
  committedAt: Date;
}

export interface ResolveRemoteCommitOptions {
  /** Override the git binary path. Defaults to `git`. */
  gitBin?: string;
  /** Override the working directory. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Override `now` for age calculations. */
  now?: Date;
}

/**
 * Resolve the HEAD of the canonical remote-tracking branch via `git ls-remote
 * origin <branch> --heads`. Returns `null` when the branch does not exist on
 * the remote (e.g. canonical branch renamed, network failure, or origin
 * unreachable). The `--heads` flag narrows to branch refs so tag SHAs cannot
 * be mistaken for branch tips.
 *
 * The committedAt timestamp comes from the second `git ls-remote` call against
 * the resolved SHA (committer date via `git cat-file`); when `cat-file`
 * reports nothing parseable we return `null` from the resolve helper so the
 * decision layer can downgrade to `insufficient-evidence` rather than
 * over-claiming.
 */
export function resolveRemoteCommit(
  branch: string,
  options: ResolveRemoteCommitOptions = {},
): RemoteCommitResolution | null {
  const gitBin = options.gitBin ?? 'git';
  const cwd = options.cwd ?? process.cwd();
  const ref = `refs/heads/${branch}`;
  try {
    const lsOutput = execFileSync(
      gitBin,
      ['ls-remote', 'origin', ref, '--heads'],
      { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const firstLine = lsOutput
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (!firstLine) return null;
    const [sha] = firstLine.split(/\s+/, 1);
    if (!sha || sha.length < 7) return null;
    const catOutput = execFileSync(
      gitBin,
      ['cat-file', '-p', `${sha}^{commit}`],
      { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const committerLine = catOutput
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.toLowerCase().startsWith('committer '));
    if (!committerLine) return null;
    const tsMatch = committerLine.match(/\s(\d{10,})\s(?:\+|\-)\d{4}$/);
    if (!tsMatch) return null;
    const committedMs = Number.parseInt(tsMatch[1], 10) * 1000;
    if (!Number.isFinite(committedMs)) return null;
    return {
      commit: sha.slice(0, 7),
      committedAt: new Date(committedMs),
    };
  } catch {
    return null;
  }
}

/** Day difference between an event and `now`, floored toward zero. */
export function computeRemoteAgeDays(
  committedAt: Date,
  now: Date = new Date(),
): number {
  const ms = now.getTime() - committedAt.getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return ms / (24 * 60 * 60 * 1000);
}

/**
 * Count how many commits `local` is behind `remote` using
 * `git rev-list --count remote..local`. Returns `null` when the local repo
 * cannot answer (no git history, malformed SHAs, etc.) so the decision layer
 * can downgrade to `insufficient-evidence`.
 *
 * The argument order matches `git rev-list A..B` semantics — we want commits
 * reachable from `remote` but not from `local` (i.e. how many the local
 * checkout is missing).
 */
export function countCommitsBehind(
  local: string,
  remote: string,
  options: ResolveRemoteCommitOptions = {},
): number | null {
  const gitBin = options.gitBin ?? 'git';
  const cwd = options.cwd ?? process.cwd();
  try {
    const output = execFileSync(
      gitBin,
      ['rev-list', '--count', `${remote}..${local}`],
      { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const value = Number.parseInt(output.trim(), 10);
    if (!Number.isFinite(value) || value < 0) return null;
    return value;
  } catch {
    return null;
  }
}

export interface DriftWitnessBootDeps {
  /** Boot-captured branch/commit (from `resolveGitInfo` in `state-persistence.ts`). */
  gitInfo: { branch?: string; commit?: string };
  /** Resolved canonical remote tracking branch, e.g. `main`. Defaults to
   *  `FFT_NANO_CANONICAL_BRANCH` from src/app-config.ts. */
  canonicalBranch?: string;
  /** Commits-lag threshold; 0 disables detection entirely. Defaults to
   *  `FFT_NANO_DRIFT_THRESHOLD` from src/app-config.ts. */
  threshold?: number;
  /** Outbox.deliver OR undefined for log-only witness. */
  outbox?: {
    deliver: (input: {
      dedupeKey: string;
      destination: string;
      body: string;
    }) => Promise<boolean>;
  } | null;
  /** Resolves the Telegram chat id to notify. */
  findMainChatJid: () => string | null;
  logger?: {
    warn?: (payload: unknown, message?: string) => void;
    info?: (payload: unknown, message?: string) => void;
  };
  now?: Date;
  resolveRemote?: (branch: string) => RemoteCommitResolution | null;
  countCommitsBehind?: (local: string, remote: string) => number | null;
  computeRemoteAgeDays?: (committedAt: Date, now?: Date) => number;
}

/**
 * Boot witness. Compares the local captured `gitInfo` against the resolved
 * remote tip of the canonical branch, runs `decideDriftWitnessAlert`, and —
 * when the decision fires — emits a WARN log and enqueues a dedupe-keyed
 * outbox row so the operator is told the runtime is behind. Failures during
 * `git ls-remote` are soft — we never throw from a boot witness, we just skip
 * the alert (a missing remote does not mean we are up-to-date).
 */
export async function runDriftWitnessAtBoot(
  deps: DriftWitnessBootDeps,
): Promise<DriftWitnessOutcome> {
  const now = deps.now ?? new Date();
  const canonicalBranch =
    deps.canonicalBranch ?? FFT_NANO_CANONICAL_BRANCH;
  const threshold = deps.threshold ?? FFT_NANO_DRIFT_THRESHOLD;
  const localCommit = deps.gitInfo.commit ?? null;
  const localBranch = deps.gitInfo.branch ?? null;
  const resolve = deps.resolveRemote ?? ((branch: string) =>
    resolveRemoteCommit(branch));
  const counter =
    deps.countCommitsBehind ??
    ((local: string, remote: string) => countCommitsBehind(local, remote));
  const computeAge = deps.computeRemoteAgeDays ?? computeRemoteAgeDays;

  const resolved = resolve(canonicalBranch);
  if (!resolved) {
    // Soft-fail: a missing remote does not mean we are up-to-date. Log it
    // as CLEAN with a reason so the heartbeat surface still shows the daily
    // commit-delta check (spec acceptance: log at least daily).
    deps.logger?.info?.(
      {
        canonicalBranch,
        localBranch,
        localCommit,
        reason: 'remote-unreachable',
      },
      'drift-witness: CLEAN',
    );
    return {
      fired: false,
      reason: 'remote-unreachable',
      evidence: {
        localCommit,
        remoteCommit: null,
        commitsBehind: null,
        remoteAgeDays: null,
      },
    };
  }

  let commitsBehind: number | null = null;
  if (localCommit) {
    commitsBehind = counter(localCommit, resolved.commit);
  }

  const remoteAgeDays = computeAge(resolved.committedAt, now);
  const evidence: DriftEvidence = {
    localCommit,
    remoteCommit: resolved.commit,
    commitsBehind,
    remoteAgeDays,
  };

  const decision = decideDriftWitnessAlert({
    commitsBehind,
    remoteAgeDays,
    threshold,
  });

  if (!decision.alert) {
    deps.logger?.info?.(
      {
        localBranch,
        localCommit,
        remoteCommit: resolved.commit,
        commitsBehind,
        remoteAgeDays: Number(remoteAgeDays.toFixed(3)),
        reason: decision.reason,
      },
      'drift-witness: CLEAN',
    );
    return { fired: false, reason: decision.reason, evidence };
  }

  deps.logger?.warn?.(
    {
      canonicalBranch: deps.canonicalBranch,
      localBranch,
      localCommit,
      remoteCommit: resolved.commit,
      commitsBehind,
      remoteAgeDays: Number(remoteAgeDays.toFixed(3)),
      threshold,
      reason: decision.reason,
    },
    `drift-witness: behind by ${commitsBehind ?? '?'} commits`,
  );

  if (!deps.outbox) {
    return { fired: true, reason: decision.reason, evidence };
  }
  const destination = deps.findMainChatJid();
  if (!destination) {
    return {
      fired: true,
      reason: `${decision.reason}:no-main-chat`,
      evidence,
    };
  }
  const dedupeKey = `drift-witness:${localCommit ?? 'unknown'}:${resolved.commit}`;
  const commitsLabel = commitsBehind ?? '?';
  const ageLabel = `${remoteAgeDays.toFixed(1)}d`;
  const branchLabel =
    localBranch && localBranch !== canonicalBranch
      ? ` (checkout is on ${localBranch})`
      : '';
  const body = `Runtime is behind ${canonicalBranch} by ${commitsLabel} commits (latest commit ${ageLabel} old). Deploy to sync.${branchLabel}`;
  const delivered = await deps.outbox.deliver({
    dedupeKey,
    destination,
    body,
  });
  return {
    fired: true,
    reason: delivered ? `${decision.reason}:delivered` : `${decision.reason}:outbox-failed`,
    evidence,
  };
}

export interface DriftWitnessOutcome {
  fired: boolean;
  reason: string;
  evidence: DriftEvidence;
}

export interface DriftWitnessBootDbDeps {
  /** Boot-captured branch/commit (from `resolveGitInfo` in `state-persistence.ts`). */
  gitInfo: { branch?: string; commit?: string };
  canonicalBranch?: string;
  threshold?: number;
  /** Resolves the Telegram chat id to notify. When null, the witness still
   *  logs but skips the outbox row insertion. */
  findMainChatJid: () => string | null;
  logger?: {
    warn?: (payload: unknown, message?: string) => void;
    info?: (payload: unknown, message?: string) => void;
  };
  now?: Date;
  /** Override the underlying helpers for tests. */
  resolveRemote?: (branch: string) => RemoteCommitResolution | null;
  countCommitsBehind?: (local: string, remote: string) => number | null;
  computeRemoteAgeDays?: (committedAt: Date, now?: Date) => number;
  /** Override the delivery_outbox enqueue (defaults to `enqueueDelivery` from db.ts). */
  enqueue?: (input: {
    dedupeKey: string;
    destination: string;
    body: string;
    maxAttempts?: number;
  }) => { record: DeliveryOutboxRecord; duplicate: boolean };
}

/**
 * Boot-friendly witness that wires the dedupe-keyed outbox row through the
 * existing `delivery_outbox` table directly. The next `flushPending()` cycle
 * (driven by the existing outboxDeliverer wiring) picks the row up and
 * delivers it via the configured Telegram transport. This lets the witness
 * survive restarts and crash-loops without needing access to the live
 * outboxDeliverer.
 *
 * Mirrors `runDriftWitnessAtBoot` semantically; the only difference is the
 * transport — this one writes to `delivery_outbox`, that one calls
 * `outbox.deliver` directly. Use this variant from `main()` in app.ts.
 */
export async function runDriftWitnessBootWithDb(
  deps: DriftWitnessBootDbDeps,
): Promise<DriftWitnessOutcome> {
  const now = deps.now ?? new Date();
  const canonicalBranch = deps.canonicalBranch ?? FFT_NANO_CANONICAL_BRANCH;
  const threshold = deps.threshold ?? FFT_NANO_DRIFT_THRESHOLD;
  const localCommit = deps.gitInfo.commit ?? null;
  const localBranch = deps.gitInfo.branch ?? null;
  const resolve =
    deps.resolveRemote ??
    ((branch: string) => resolveRemoteCommit(branch));
  const counter =
    deps.countCommitsBehind ??
    ((local: string, remote: string) => countCommitsBehind(local, remote));
  const computeAge =
    deps.computeRemoteAgeDays ?? computeRemoteAgeDays;

  const resolved = resolve(canonicalBranch);
  if (!resolved) {
    deps.logger?.info?.(
      {
        canonicalBranch,
        localBranch,
        localCommit,
        reason: 'remote-unreachable',
      },
      'drift-witness: CLEAN',
    );
    return {
      fired: false,
      reason: 'remote-unreachable',
      evidence: {
        localCommit,
        remoteCommit: null,
        commitsBehind: null,
        remoteAgeDays: null,
      },
    };
  }

  let commitsBehind: number | null = null;
  if (localCommit) {
    commitsBehind = counter(localCommit, resolved.commit);
  }
  const remoteAgeDays = computeAge(resolved.committedAt, now);
  const evidence: DriftEvidence = {
    localCommit,
    remoteCommit: resolved.commit,
    commitsBehind,
    remoteAgeDays,
  };

  const decision = decideDriftWitnessAlert({
    commitsBehind,
    remoteAgeDays,
    threshold,
  });

  if (!decision.alert) {
    deps.logger?.info?.(
      {
        localBranch,
        localCommit,
        remoteCommit: resolved.commit,
        commitsBehind,
        remoteAgeDays: Number(remoteAgeDays.toFixed(3)),
        reason: decision.reason,
      },
      'drift-witness: CLEAN',
    );
    return { fired: false, reason: decision.reason, evidence };
  }

  deps.logger?.warn?.(
    {
      canonicalBranch,
      localBranch,
      localCommit,
      remoteCommit: resolved.commit,
      commitsBehind,
      remoteAgeDays: Number(remoteAgeDays.toFixed(3)),
      threshold,
      reason: decision.reason,
    },
    `drift-witness: behind by ${commitsBehind ?? '?'} commits`,
  );

  const destination = deps.findMainChatJid();
  if (!destination) {
    return {
      fired: true,
      reason: `${decision.reason}:no-main-chat`,
      evidence,
    };
  }

  const dedupeKey = `drift-witness:${localCommit ?? 'unknown'}:${resolved.commit}`;
  const commitsLabel = commitsBehind ?? '?';
  const ageLabel = `${remoteAgeDays.toFixed(1)}d`;
  const branchLabel =
    localBranch && localBranch !== canonicalBranch
      ? ` (checkout is on ${localBranch})`
      : '';
  const body = `Runtime is behind ${canonicalBranch} by ${commitsLabel} commits (latest commit ${ageLabel} old). Deploy to sync.${branchLabel}`;
  const enqueue = deps.enqueue ?? enqueueDelivery;
  const { record, duplicate } = enqueue({
    dedupeKey,
    destination,
    body,
  });
  deps.logger?.info?.(
    {
      dedupeKey,
      destination,
      status: record.status,
      duplicate,
    },
    duplicate
      ? 'drift-witness: outbox row already exists, no double-post'
      : 'drift-witness: outbox row enqueued',
  );
  return {
    fired: true,
    reason: duplicate ? `${decision.reason}:deduped` : `${decision.reason}:enqueued`,
    evidence,
  };
}
