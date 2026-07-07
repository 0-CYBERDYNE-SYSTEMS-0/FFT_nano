# SPEC-09 — Workspace Hygiene Sweep (clean debris, policy retention)

**Severity:** WARNING · **Type:** ops/process · **Status:** Ready for dev

## Problem

The runtime worktree `~/fft_nano` and memory directories harbor orphaned test data, untracked
files, and modified lock files that are not under version control:

- **Test/scratch group folders** in `~/fft_nano/groups/`: leftover test-* and scratch entries
  alongside real groups (main). No retention policy; accumulate indefinitely.
- **Memory trash** in `~/nano/memory/trash/`: ~70 files with no purge schedule. Related
  `~/nano/memory/archive/` exists but is not managed.
- **Runtime worktree debris** in `~/fft_nano/`: untracked `reports/` directory and modified
  `package-lock.json` (also referenced by SPEC-08 as a hygiene liability during branch
  reconciliation).

Orphaned test data can pollute memory searches, inflate storage, and confuse manual audits.
Untracked files in the worktree create risk during force operations (SPEC-08's `git reset
--hard`).

## Evidence

- `~/fft_nano/groups/`: listing shows entries like `test-*`, `scratch-*`, `temp-*` alongside
  production group folders (e.g., `main`). No timestamp or metadata indicates creation date or
  purpose.
- `~/nano/memory/trash/`: contains ~70 archived/deleted memory files. No `.mtime` policy or
  explicit retention schedule.
- `~/nano/memory/archive/`: directory exists; contents unknown (see verification step).
- `~/fft_nano/reports/`: untracked (not in .gitignore); contains transient reports (likely
  from prior test runs).
- `~/fft_nano/package-lock.json`: shows modifications (per `git status`); unclear if intentional
  or from partial installs.
- No retention-policy logic in existing scheduled maintenance tasks; cron service
  (`src/cron/service.ts`) does not include a memory/group cleanup job.

## Root cause

One-time cleanup operations are missing (no initial purge runbook). No retention policy is
encoded (neither in code via scheduled cleanup nor documented as a manual SOP). The .gitignore
does not exclude known transient directories (reports/, temp-*), so they appear as worktree
noise during reconciliation tasks.

## Fix

Three complementary remedies:

### 1. One-time cleanup runbook (operator-confirmed, scripted)

A dry-run-first, backups-before-delete approach to eliminate existing debris:

```bash
# Backup step
cd ~/fft_nano
tar -czf ~/backup-fft-nano-hygiene-$(date +%Y%m%d-%H%M%S).tar.gz groups/

# List test/scratch groups (dry-run)
ls -la groups/ | grep -E 'test-|scratch-|temp-'

# Operator reviews and confirms deletion
# When ready:
rm -rf groups/test-* groups/scratch-* groups/temp-*

# List memory trash (inspect)
ls -l ~/nano/memory/trash/ | head -20
du -sh ~/nano/memory/trash/

# Operator inspects and confirms
# When ready, move to dated archive:
mv ~/nano/memory/trash ~/nano/memory/trash-$(date +%Y%m%d-%archived)

# Clean worktree
cd ~/fft_nano
git status  # verify nothing critical
git stash push -u
rm -rf reports/  # if untracked after stash

# Verify clean state
git status  # should be "working tree clean"
```

Document this runbook in `docs/ops/WORKSPACE-CLEANUP.md` with approval checkpoints.

### 2. Retention policy (scheduled cleanup — lightweight code)

Add a weekly or monthly maintenance task (inject into existing cron or heartbeat idle slot):

- **Memory trash retention**: files in `trash/` older than 30 days → move to a dated archive
  directory (e.g., `trash-archive-2026-07/`).
- **Test groups purge**: groups matching patterns `test-*` or `scratch-*` that are >90 days old
  (check folder mtime) → archive to a dated tarball under `~/fft_nano/archive/purged-groups/`,
  then delete.
- **Worktree litter**: before the heartbeat or nightly cron, run `git status --short` and warn
  if untracked or modified files exist (excluding whitelisted exceptions like `.env.local`).

Implement as a new optional scheduled task in `src/cron/service.ts` or a standalone
`src/workspace-maintenance.ts` module (called from idle curator or a dedicated cron config
entry). Keep it cheap (no subprocess per file; batch operations). Example config:

```json
{
  "maintenance": {
    "enabled": true,
    "schedule": "0 2 * * 0",
    "trash_retention_days": 30,
    "test_group_retention_days": 90
  }
}
```

### 3. .gitignore and worktree conventions

Add to `.gitignore` (or create `.git/info/exclude` if .gitignore coverage is insufficient):

```
# Transient worktree artifacts
reports/
temp/
*.tmp
package-lock.json.orig
*.swp
*.swo
```

Document in `CLAUDE.md` under "Development Workflow":

```
- Runtime worktree (~/fft_nano) must stay clean. Before pushing changes, verify:
  git status → working tree clean (no untracked files, no modifications).
  - Use git stash push -u to shelve untracked files.
  - Do not commit lock files or reports/; these are excluded by .gitignore.
  - Test artifacts should be isolated to ~/fft_nano-dev, not ~/fft_nano.
```

## Verification checklist (ops tasks — not TDD)

Replace TDD with these post-cleanup operator confirmations:

- [ ] Backup created: `ls -lh ~/backup-fft-nano-hygiene-*.tar.gz` shows dated archive.
- [ ] Test/scratch groups listed and reviewed: `ls groups/ | grep -E 'test-|scratch-'` returns
      nothing (or operator confirms removal is safe).
- [ ] Memory trash reviewed: `du -sh ~/nano/memory/trash/` shows reduced size (or archived).
- [ ] Worktree cleaned: `cd ~/fft_nano && git status` shows "working tree clean".
- [ ] .gitignore updated and verified: `git check-ignore -v reports/ package-lock.json` returns
      matches (if entries added).
- [ ] Retention policy deployed: `config/runtime.parity.json` or cron config includes
      `"maintenance"` entry (or new `src/workspace-maintenance.ts` is wired in).
- [ ] Documentation added: `docs/ops/WORKSPACE-CLEANUP.md` exists with runbook and approval
      checkpoints.

## Acceptance criteria

- [ ] No test-*, scratch-*, or temp-* group folders remain in ~/fft_nano/groups/ (or all are
      dated and >90 days old).
- [ ] ~/nano/memory/trash/ is either empty or contains only recent files (<30 days).
- [ ] Runtime worktree is clean: `git status` shows no untracked files or modifications (except
      whitelisted .env.local, etc.).
- [ ] .gitignore includes rules for transient directories and lock-file backups.
- [ ] Scheduled maintenance task (cron or idle curator) runs weekly/monthly and logs activity.
- [ ] Operator can verify compliance via a simple checklist (documented in WORKSPACE-CLEANUP.md).

## Files

`.gitignore` (or `.git/info/exclude`), `CLAUDE.md` (development workflow section),
`docs/ops/WORKSPACE-CLEANUP.md` (new runbook), `src/workspace-maintenance.ts` (optional new
module for scheduled cleanup), `config/runtime.parity.json` or `src/cron/service.ts` (wire up
maintenance task if code path chosen). No database schema changes.

## Out of scope

Recovering deleted test data (backups provide recovery opportunity; retention policy does not
auto-restore). Auditing why test groups were created in the first place (focus is forward
cleanup + policy). Changing memory compaction or archive strategies (SPEC-05/SPEC-06 if needed).

## Risks / rollback

All deletion is operator-confirmed and backed up. If a purge was too aggressive, restore from
the dated tarball (`tar -xzf ~/backup-fft-nano-hygiene-*.tar.gz -C ~/fft_nano-restore`).
Scheduled cleanup is opt-in (default disabled in config); if it misbehaves, set `maintenance.enabled = false` and rollback commit. No LLM calls or message sends in this path, so worst case is
wasted disk or log noise.
