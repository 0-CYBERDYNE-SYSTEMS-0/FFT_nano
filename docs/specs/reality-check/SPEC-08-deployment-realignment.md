# SPEC-08 — Deployment Realignment (branch authority and runtime tracking)

**Severity:** SERIOUS · **Type:** ops/docs · **Status:** Ready for dev

## Problem

The documented deployment workflow (CLAUDE.md) prescribes `origin/dev` as the active integration
line with the runtime worktree `~/fft_nano` tracking it. In reality:

- `origin/dev` is STALE @ commit 119488b (2026-06-23, 14 days old).
- `origin/main` is CURRENT @ commit a5cdb17 (2026-07-01, latest PR #152).
- Runtime `~/fft_nano` is checked out to LOCAL `main` @ commit 80328a5 (2026-06-24), 8 commits
  behind `origin/main`.
- Runtime worktree has uncommitted `package-lock.json` changes and an untracked `reports/`
  directory (hygiene issue, see SPEC-09).
- Service PID 785 running since 2026-07-02 (predates the build's own guarantees).

The documented ship loop (feature → `dev` → runtime pulls `dev` → build → kickstart) is
inverted: `main` moved ahead while `dev` went stale. The runtime is pinned to an old local
main, and no monitoring surface alerts the operator that the running process is out of sync
with the canonical remote.

## Evidence

- CLAUDE.md (project instructions):
  - Lines defining `origin/dev` as "active integration line; direct fast-forward pushes
    allowed; force-push blocked."
  - Lines defining `origin/main` as "blessed/release-only. PR-gated; moves only when dev is
    merged in + a release tagged."
  - Ship loop: "feature → push → fast-forward origin/dev → in ~/fft_nano: git pull --ff-only
    origin dev → npm run build → launchctl kickstart."
- Live runtime state (2026-07-07 00:46 UTC):
  - `~/fft_nano/.git/HEAD`: on local main (commit 80328a5).
  - `origin/main`: commit a5cdb17 (7 days ahead, PR #152 merged 2026-07-01).
  - `origin/dev`: commit 119488b (last update 2026-06-23, 14 days stale).
- Boot-time GIT_INFO capture: `src/state-persistence.ts:34-53` (resolveGitInfo) reads branch +
  short commit at module load; available to embed in boot log and periodic digests but currently
  unused for drift detection.
- Runtime log check: no entry noting branch/commit mismatch or stale-dev condition.

## Root cause

No single authoritative deployment line. Two possible configurations exist in the codebase, but
neither is canonical. When main moved ahead, the documentation was not updated and no signal
alerted the operator that the running process was now stale relative to the shipped commits.
The GIT_INFO is captured at boot but not compared against remote tips.

## Fix

Pick one line as authoritative and document it clearly. Recommendation: **keep main-track
(simpler, matches current state, reduces merge risk).** If main-track is chosen:

1. **Update CLAUDE.md** to document the true workflow:
   - `origin/main` = canonical; all PRs merged here.
   - `~/fft_nano` tracks main (not dev).
   - Ship loop: feature branch → PR → merge to main → `cd ~/fft_nano && git pull --ff-only
     origin main && npm run build && launchctl kickstart -k gui/$(id -u)/com.fft_nano && verify
     new PID + clean logs/fft_nano.log`.
   - Explicitly note: force-push to main is forbidden; cherry-pick or revert for rollback.

2. **Reconcile origin branches** (one-time operational fix, not code):
   - Fast-forward `origin/dev` to `origin/main` (squash or merge; if merging, a clean merge-base
     exists since dev was the integration line before main pulled ahead). Document the reconcile
     commit in the release notes.
   - Alternatively, retire `origin/dev` entirely (mark obsolete in README, delete after a 30-day
     grace period).

3. **Reconcile runtime worktree** (one-time operational fix):
   - Stash untracked (`git stash push -u`) and reset to origin/main (`git fetch origin && git
     reset --hard origin/main`).
   - `npm run build && launchctl kickstart -k gui/$(id -u)/com.fft_nano`.
   - Verify new PID, clean logs, and confirm GIT_INFO reflects the new HEAD.

4. **Add drift witness** (code change — light):
   - At boot (in `src/app.ts` main() after GIT_INFO is available) and on heartbeat completion,
     compare local GIT_INFO.commit against `origin/<canonical-branch>` tip (via `git ls-remote
     origin <branch> | head -1`). If behind by >4 commits for >2 days, emit a WARN log with
     drift details and enqueue a Telegram notice (dedupe key `drift-witness:<local>:<remote>`):
     "Runtime is behind main by N commits (latest: <date>). Deploy to sync." Post to
     delivery outbox so it survives restarts.

5. **Document the canonical line in config** — add a comment to `src/app-config.ts`:
   ```
   // Canonical deployment branch: main (not dev).
   // See CLAUDE.md "Development Workflow (Authoritative)."
   ```

## Verification checklist (ops tasks — not TDD)

Replace TDD with these operator-confirmed steps (post-migration):

- [ ] Origin reconcile complete: `git log --oneline origin/dev..origin/main | wc -l` shows 0
      (dev == main) OR dev is marked obsolete/deleted and documentation reflects it.
- [ ] Runtime worktree reconciled: `cd ~/fft_nano && git rev-parse --abbrev-ref HEAD` shows
      `main` and `git rev-parse HEAD` matches origin/main tip.
- [ ] Service restarted: `launchctl kickstart -k gui/$(id -u)/com.fft_nano` succeeded and PID
      changed.
- [ ] Boot log shows new GIT_INFO (branch=main, commit=<current origin/main short hash>).
- [ ] logs/fft_nano.log cleaned and no ERROR/WARN entries about git state.
- [ ] Drift witness deployed: next heartbeat cycle includes commit-compare check (visible in
      logs as `drift-witness: <commit-delta>` or `drift-witness: CLEAN`).
- [ ] CLAUDE.md updated and reviewed for accuracy against live state.

## Acceptance criteria

- [ ] Canonical branch is unambiguous in CLAUDE.md; runtime worktree matches it.
- [ ] origin/dev and origin/main are either reconciled (same tip) or one is retired (documented).
- [ ] Runtime worktree is clean (no uncommitted changes, no stale untracked files).
- [ ] Boot log includes GIT_INFO (branch + commit).
- [ ] Heartbeat or dedicated cron task logs commit-delta check at least daily.
- [ ] No developer confusion about which branch to push to; PR/merge process is documented.

## Files

`CLAUDE.md` (project instructions), `src/app.ts` (boot witness for drift), `src/app-config.ts`
(canonical branch comment + env for drift threshold if needed), `src/heartbeat-service.ts` or
new `src/drift-witness-service.ts` (drift check on heartbeat/startup). No schema changes.

## Out of scope

Auto-merge or auto-rollback on drift (operator must confirm). Changing PR review process or
release tagging. Auditing past deployment history (focus is forward alignment).

## Risks / rollback

Reconciling origin branches is a one-time operation; if it fails, force-push dev back to its
original commit (document the SHA beforehand). Reconciling runtime worktree uses `git reset
--hard`, which discards local changes — verify nothing valuable in `reports/` or
`package-lock.json` changes first (see SPEC-09). Drift witness is append-only (logs + outbox
entries); rollback = revert the witness code and purge outbox entries with dedupe key prefix
`drift-witness:`.
