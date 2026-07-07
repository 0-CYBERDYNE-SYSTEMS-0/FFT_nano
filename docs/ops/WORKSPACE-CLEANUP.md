# Workspace Cleanup Runbook (SPEC-09)

This runbook covers the **one-time cleanup** leg of SPEC-09. The retention policy
that follows it is wired into the host via `src/workspace-maintenance.ts` and
gated by an opt-in env flag — this runbook is for the manual operator sweep that
nukes pre-existing debris.

> The actual cleanup is operator-confirmed and reversible. Read every step
> before pressing Enter. Backups are written next to `~` (a dated tarball in
> `$HOME`) so a mistyped glob is recoverable in minutes.

## Scope

Targets the three classes of debris called out in SPEC-09:

1. **Test/scratch group folders** under `~/fft_nano/groups/` matching
   `test-*`, `scratch-*`, or `temp-*`. Real groups (`main`, etc.) are
   untouched.
2. **Memory trash** under `~/nano/memory/trash/`. Older than 30 days moves
   to a dated archive (`trash-archive-YYYY-MM/`).
3. **Untracked runtime worktree debris** under `~/fft_nano/` (the `reports/`
   directory and similar transient artifacts called out by the spec).

`~/nano/memory/archive/` is intentionally **not** purged here; that directory
is managed separately and is not the same as the dated `trash-archive-*`
buckets the retention task creates.

## Preconditions (operator checkpoints)

Before running any destructive step, confirm each checkpoint in order:

- [ ] **CP-1 — Runtime service is up to date.** You have run
      `cd ~/fft_nano-dev && git pull --ff-only origin main`,
      `cd ~/fft_nano && git pull --ff-only origin main`,
      `cd ~/fft_nano && npm run build`, and
      `./scripts/service.sh restart` (or the `launchctl` equivalent) within
      the last hour.
- [ ] **CP-2 — Backups are writable.** `df -h ~` shows >= 2 GB free. The
      backup tarball lands in `$HOME` and grows quickly for workspaces with
      many test groups.
- [ ] **CP-3 — No active agent runs.** No scheduled task is mid-run and no
      long-running agent is executing. Check
      `~/fft_nano/data/cron/` snap files and the live SQLite store.
- [ ] **CP-4 — Service single-instance.** `cat ~/fft_nano/data/fft_nano.lock`
      matches the running service PID; you do not have a stray foreground
      instance from `npm start` racing the daemon.
- [ ] **CP-5 — You have read the acceptance criteria below** and any group
      that matches `test-*` / `scratch-*` / `temp-*` has been independently
      confirmed as not-a-real-group.

If any checkpoint fails, stop and resolve it before continuing.

## Step 1 — Backup

```bash
cd ~/fft_nano
tar -czf ~/backup-fft-nano-hygiene-$(date +%Y%m%d-%H%M%S).tar.gz groups/
```

Verify the archive contains entries you expect to be cleaning:

```bash
tar -tzf ~/backup-fft-nano-hygiene-*.tar.gz | head -20
```

If the head looks wrong (missing the directories you expected to find), stop
and re-run after confirming `~/fft_nano/groups/` actually exists. Do **not**
proceed to deletion without a verified backup tarball.

## Step 2 — Inventory (dry-run)

```bash
# Group folders matching test/scratch/temp
ls -la ~/fft_nano/groups/ | grep -E 'test-|scratch-|temp-'

# Memory trash contents (head + total size)
ls -l ~/nano/memory/trash/ | head -20
du -sh ~/nano/memory/trash/

# Worktree debris
cd ~/fft_nano
git status
```

Inspect each line. If anything listed under `ls` looks like a real group (a
human-named chat, not a CI artifact), press `Ctrl-C` immediately and rename
that directory out of the `test-*` namespace before proceeding.

### Approval checkpoint (CP-6)

At this point, paste the three listings into your session log or a comment,
and confirm that every matched folder, file, and `git status` entry is
explicitly safe to act on. Without this confirmation, do not continue.

## Step 3 — Test/scratch group purge

```bash
cd ~/fft_nano
rm -rf groups/test-* groups/scratch-* groups/temp-*
```

If you removed by mistake, restore from the backup:

```bash
cd ~/fft_nano
tar -xzf ~/backup-fft-nano-hygiene-*.tar.gz -C ~/fft_nano-restore
# Inspect, then optionally:
# cp -a ~/fft_nano-restore/fft_nano/groups/test-foo ./groups/
```

## Step 4 — Memory trash archival

```bash
# Inspect first, archive second.
ls -l ~/nano/memory/trash/ | head -20
du -sh ~/nano/memory/trash/

mv ~/nano/memory/trash ~/nano/memory/trash-$(date +%Y%m%d-%archived)
```

The renamed directory is now your dated archive bucket. The retention task
in the next section will create new buckets per month (e.g.
`trash-archive-2026-07/`).

## Step 5 — Worktree cleanup

```bash
cd ~/fft_nano
git status  # nothing critical should appear

# Stash untracked files for review
git stash push -u

# After stashing, transient artifacts become safe to remove
rm -rf reports/

# Verify clean state
git status  # should be "working tree clean"

# Inspect the stash before deciding to drop it
git stash list
git stash show -u stash@{0}
# Only after manual review: git stash drop
```

The new `.gitignore` rules (see commit in feat/spec-09-workspace-hygiene)
will prevent `reports/`, `temp/`, `*.tmp`, `package-lock.json.orig`,
`*.swp`, and `*.swo` from re-appearing as untracked noise on future
reconciles.

## Verification (post-cleanup checklist)

Walk the acceptance criteria the spec defines:

- [ ] `ls -lh ~/backup-fft-nano-hygiene-*.tar.gz` shows a dated archive of
      non-zero size.
- [ ] `ls ~/fft_nano/groups/ | grep -E 'test-|scratch-|temp-'` returns
      nothing (or returns only entries you intentionally kept).
- [ ] `du -sh ~/nano/memory/trash*/` shows `~/nano/memory/trash` is gone
      and a `trash-YYYYMMDD-archived/` sibling exists.
- [ ] `cd ~/fft_nano && git status` reports "working tree clean"
      (whitelisted exceptions like `.env.local` are out of repo so they
      never appear in `git status`).
- [ ] `git check-ignore -v reports/ package-lock.json` returns an ignore
      match for `reports/` (the lock-file check applies only if you
      actually have an in-tree `package-lock.json`; this repo uses
      `package.json` only).
- [ ] The new runbook and `.gitignore` rules are present on the active
      runtime checkout: `cd ~/fft_nano && git log --oneline -5` includes
      the spec-09 commit.

After all six items pass, you can mark SPEC-09 acceptance satisfied for
the one-time cleanup leg. The retention policy leg is handled by the
scheduled cleanup task wired in `src/workspace-maintenance.ts`; flip on
`FFT_NANO_WORKSPACE_MAINTENANCE_ENABLED=true` when you are ready for it
to start moving trash on its own.

## Retention policy (post-merge behavior)

After the spec-09 commit is on `main` and the runtime is rebuilt, the
following opt-in behavior becomes available without further operator
intervention:

| Setting | Default | Effect |
| --- | --- | --- |
| `FFT_NANO_WORKSPACE_MAINTENANCE_ENABLED` | `false` | Master switch for scheduled retention. Off by default. |
| `FFT_NANO_TRASH_RETENTION_DAYS` | `30` | Age (days) before `~/nano/memory/trash/*` is moved into a `trash-archive-YYYY-MM/` bucket. |
| `FFT_NANO_TEST_GROUP_RETENTION_DAYS` | `90` | Age (days) before `test-*` / `scratch-*` / `temp-*` group folders are tarred into `~/fft_nano/archive/purged-groups/` and removed from the live `groups/` tree. |

`checkWorktreeCleanliness()` is purely observational (reads `git status
--short` and reports counts + paths) — it never deletes anything. Wire it
into a cron tick or heartbeat idle slot to get a warning when the runtime
worktree starts accumulating untracked debris again.

## Out of scope / risks

- **Restores**: This runbook does not delete backups; the dated
  `~/backup-fft-nano-hygiene-*.tar.gz` is left for the operator to manage.
  Restore-from-backup is documented inline at each destructive step.
- **Auditing provenance**: The runbook does not investigate *why* test
  groups were created. SPEC-09 only cleans up the debris and prevents
  recurrence via the `.gitignore` + retention policy combined.
- **Memory compaction/strategies**: Out of scope per SPEC-09 (owned by
  SPEC-05 / SPEC-06 if relevant).
- **Worst case**: a mistyped glob deletes a real group. Backups in
  `$HOME` cover that. Set `FFT_NANO_WORKSPACE_MAINTENANCE_ENABLED=false`
  to disable the scheduled path while you investigate.
