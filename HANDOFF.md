# HANDOFF — FFT_nano

This file has two parts:
1. **Current handoff** — the Agent Durability & Self-Improvement pass and what's
   left to finish (read this first).
2. **Archived handoff** — the earlier Simplification pass (done + merged), kept
   for historical context.

---

# Part 1 — Agent Durability & Self-Improvement (CURRENT)

Last updated: 2026-05-28. Companion to `MISSION_CONTRACT.md` (the what/why) — this
section is the **how to continue**.

## 1.1 Where things stand

The report-card pass (§1 self-improvement, §2 durability, §6 modes, §7 safety) is
**implemented, tested, merged to `dev`, deployed, and verified live** on the
running `com.fft_nano` service. Grade: C+ → B+. Full suite 683 pass / 0 fail.

What shipped, with file pointers:

| Area | Code | Notes |
|------|------|-------|
| Evaluator verdict store | `src/db.ts` → `evaluator_verdicts` table, `recordEvaluatorVerdict`, `getEvaluatorStats` | New table, additive. |
| Verdict feed-forward | `src/coding-orchestrator.ts` → `formatEvaluatorStatsContext` (~L516), record call (~L1290), context build (~L1043/1075) | Prepends prior pass-rate + recurring issues to each coding/subagent run. |
| Restart triage | `src/db.ts` → `triageActiveAgentRunsOnStartup`, `listRecoverableAgentRuns`, new `agent_runs` columns | Replaces `markActiveAgentRunsFailedOnStartup` (removed). |
| Dispatch validation | `src/pipeline/pipeline-dispatcher.ts` → `validateDispatchRequest` | Pure fn, called in `dispatch`. |
| Bash-guard canonicalization | `src/bash-guard.ts` → `canonicalizeForDetection` | Used by `isDestructiveCommand`. |
| Tests | `tests/{bash-guard,db-evaluator-verdicts,db-agent-runs-recovery,dispatch-validation}.test.ts` | 15 new. |

## 1.2 ⚠️ Critical gaps — plumbed but NOT yet functional

Fix these first or the §2 durability gain is structural-only.

### (a) `worktree_path` is never written → triage always marks runs `dead`
- `triageActiveAgentRunsOnStartup` (`src/db.ts`) decides recoverable vs dead by
  checking whether `agent_runs.worktree_path` exists on disk.
- **Nothing sets `worktree_path`.** `agent_runs` rows are created/updated only by
  `src/long-run-service.ts` (`createAgentRun` ~L483; `updateAgentRun` L186…L528),
  and none of those calls pass `worktree_path`.
- **Result:** every interrupted run currently triages as `failed`/`dead` — same as
  old behavior in practice. The recoverable path is correct but starved of input.
- **To finish:** when a long run is backed by an ephemeral worktree (created in
  `src/coding-orchestrator.ts`; search `worktreePath` / `ephemeral_worktree`),
  thread that path into `long-run-service.ts` and call
  `updateAgentRun(runId, { worktree_path })` at run start.

### (b) No resume consumer for recoverable runs
- `listRecoverableAgentRuns()` exists and is correct, but **nothing calls it.**
  Interrupted runs are preserved and listed, never re-enqueued.
- **To finish:** at startup (after `initDatabaseAtPath`, likely `src/app.ts`
  `main()` or long-run-service init), read `listRecoverableAgentRuns()` and
  re-dispatch each via `message-dispatch` / `coding-orchestrator`, resuming from
  the preserved worktree. Add a max-attempts cap to avoid crash loops.
- This is the single change that turns §2 from B− into a true B.

### (c) Verdict feed-forward is group-scoped, coding/subagent only
- `getEvaluatorStats(groupFolder)` is consumed only by `coding-orchestrator.ts`.
  Chat/cron/heartbeat neither write nor read it (by design — evaluator only runs
  for coding/subagent). No cross-group learning. Confirm `evaluator_verdicts`
  actually populates after a real coding run before assuming the loop closes.

## 1.3 Deferred sections (next contract, by priority)

1. **Resume consumer + `worktree_path` wiring** — §1.2(a)(b). Highest leverage.
2. **§4a memory injection consistency** — cron + subagent get no memory context.
   Wire `buildMemoryContext` (`src/memory-retrieval.ts`) into `src/cron/service.ts`
   and the subagent path. Cheap, no new deps.
3. **§3 outbox delivery queue** — at-least-once + dedupe for finals/cron. ⚠️ Highest
   blast radius: dedupe must be right or it double-posts to Telegram. Tests first.
   Touches `host-events.ts`, `telegram-streaming.ts`, `cron/service.ts`.
4. **§4b semantic memory** — local embedding index behind `memory-backend.ts`
   facade; blend with lexical in `mergeAndRankMemoryHits` (`src/memory-search.ts`).
   Keep lexical fallback. No external API (project rule: no mock/sim).
5. **§5 skill versioning** — snapshot `SKILL.md` to `.history/` before patch; add
   rollback. Lowest leverage, do last.

## 1.4 Branch model & workflow (MUST follow)

Two-track, two-worktree. **They share one `.git` — a branch can only be checked
out in one worktree at a time.**

- **`origin/main`** — blessed/release. PR-gated (0 approvals = self-mergeable),
  force-push blocked. Moves ONLY by merging `dev` + tagging a release.
- **`origin/dev`** — active integration line. Direct (non-PR) pushes allowed,
  force-push blocked (even for admins). This is what the runtime runs.
- **`~/fft_nano-dev`** — edit/build/test worktree. Work on FEATURE branches here,
  never on `dev`.
- **`~/fft_nano`** (= `/Users/scrimwiggins/FFT_nano`, case-insensitive FS) —
  runtime worktree on `dev`. **Never hand-edit.** Builds + restarts the launchd
  service from merged `dev`.

**Loop:** edit in `fft_nano-dev` on a feature branch → push → merge into
`origin/dev` (direct fast-forward push allowed) → in `~/fft_nano`:
`git pull --ff-only origin dev` → `npm run build` → restart → verify → when
blessed, PR `dev → main` + tag.

## 1.5 Build / test / deploy / verify

```bash
# Edit worktree (~/fft_nano-dev), feature branch:
npm run typecheck
npm test                         # node --test, ~14s, expect 683 pass / 2 skip
npm run release-check            # typecheck + tests + secret-scan + pack-check

# Deploy (in ~/fft_nano, on dev):
git pull --ff-only origin dev
npm run build                    # service runs prebuilt dist/ — BUILD IS REQUIRED
launchctl kickstart -k "gui/$(id -u)/com.fft_nano"

# Verify live:
launchctl list | grep com.fft_nano                   # new PID = restarted
tail -20 ~/fft_nano/logs/fft_nano.log                # clean startup
sqlite3 ~/fft_nano/store/messages.db ".schema evaluator_verdicts"
sqlite3 ~/fft_nano/store/messages.db "PRAGMA table_info(agent_runs);"
```

## 1.6 Gotchas

- **The service runs `dist/`, not `src/`.** `git pull` without `npm run build`
  deploys nothing. Always rebuild.
- **DB migrations run at startup** (`initDatabaseAtPath`, `src/db.ts`) as
  idempotent `ALTER TABLE` in try/catch. Additive + nullable. Live DB:
  `~/fft_nano/store/messages.db` (`STORE_DIR`, `src/app-config.ts:107`).
- **Worktree branch lock:** "already checked out at …" means the other worktree
  holds that branch. Switch it off first.
- **`origin/dev` force-push is blocked even for admins** — to reset its history,
  lift protection in GitHub settings first (`enforce_admins` on).
- **Commit hygiene:** no `claude`/Anthropic references, no `Co-Authored-By`. Hooks
  in `hooks/` — don't bypass with `--no-verify`.
- **Rollback floor:** tagged releases / `release/0.3.1`. To roll back live: check
  out the tag in `~/fft_nano`, `npm run build`, restart.

## 1.7 Cold-start orientation

1. Read `MISSION_CONTRACT.md`, then Part 1 of this file.
2. `CLAUDE.md` (repo root) = architecture, message flow, key files.
3. Start with §1.2(a)+(b) — most valuable unfinished piece, well-scoped.

---

# Part 2 — FFT_nano Simplification (ARCHIVED — done + merged)

**Branch:** `feat/fft-simplification-spec` · **Spec:** `SPEC.md`
**Status:** Milestones 1–5 complete; merged into `main`/`dev`.
**Tests at handoff:** 665 pass, 0 fail, 2 skipped · Typecheck clean · Release check passed

## What Was Done

### Milestone 5 — COMPLETE ✅
`memory-action-gateway.ts` split from 703 lines into 3 focused files:
- `src/memory-action-validation.ts` (121 lines) — Zod schema, path guards, string helpers
- `src/memory-action-io.ts` (336 lines) — file read/write, section manipulation, mutation
- `src/memory-action-gateway.ts` (181 lines) — orchestration only; `executeMemoryAction` unchanged

### Milestone 3 — COMPLETE ✅
Config consolidated from 5 sources:
- `src/app-config.ts` (256 lines) — canonical home: profile detection + env-var constants
- `src/config.ts` (60 lines) — re-export stub; existing imports still work
- `src/parity-config.ts` (400 lines, was 676) — condensed; exports unchanged
- `src/profile.ts` (109 lines) — kept separate (tests use cache-busting dynamic imports)
- `src/runtime-config.ts` (321 lines) — untouched per spec

### Milestone 1 — COMPLETE ✅
index.ts reduced from 8,030 → ~2,071 lines. Modules extracted and wired via thin
wrappers: `host-coordination.ts`, `heartbeat-service.ts`, `update-service.ts`,
`tui-coordination.ts`, `web-control-center.ts`, `state-persistence.ts`,
`telegram-group-mgmt.ts`, `agent-runner.ts`, `skill-service.ts`,
`telegram-delivery.ts`, `telegram-settings.ts`.

### Milestone 2 — COMPLETE ✅
- `src/pipeline/message-dispatch-pipeline.ts` (1,900 lines) — canonical dispatch
- `src/message-dispatch.ts` (9 lines) — compatibility re-export

### Milestone 4 — COMPLETE ✅
Host IPC event types consolidated in `src/runtime/host-events.ts` (17 → ~8 kinds):
`ipc_request`, `ipc_result`, `file_transfer`, `run_state`; stale kinds removed.
Emitters/consumers updated across `host-coordination.ts`, `coding-orchestrator.ts`,
`tui-coordination.ts`, and tests.

## Architecture Notes for Incoming Devs

### Dependency Injection Pattern
Extracted modules use a `*Deps` interface for callbacks into index.ts/other
modules. `buildXDeps()` in index.ts constructs them; thin wrappers delegate. Avoids
circular imports, keeps modules testable.

### Module Init Pattern
`agent-runner.ts` uses `initAgentRunner(deps)` call-once at startup.

### Shared State
All global mutable state lives in `src/app-state.ts`; extracted modules import it
directly (not via deps).

### ESM
All imports use `.js` extensions. No exceptions.

## Open verification note (from that pass)
Confirm `app-config.ts` is wired (is `config.ts` re-exporting from it?) vs dead
code: `grep -r "app-config" src/`. If `config.ts` re-exports and tests pass, it's
working; if unused, wire or delete to keep the tree clean.
