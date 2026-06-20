# HANDOFF — FFT_nano

This file has two parts:
1. **Current handoff** — the Control Center Revamp and what's left to finish
   (read this first).
2. **Archived handoff** — the Agent Durability & Self-Improvement pass
   (done + merged) and the earlier Simplification pass, kept for context.

---

# Part 1 — Control Center Revamp (CURRENT)

Last updated: 2026-06-20. Branch: `feat/control-center-revamp` (off `dev`,
1 commit ahead, ready to fast-forward). Companion: this section is the **how
to deploy + verify**; the "what" is the audit report the user asked for in
the prior turn (now in this session's history).

## 1.1 Why

The live control center on `dev` was a 9-panel always-open page rendered
as a single scroll. Every section was visible at once, nothing collapsed.
The Setup / System / Tasks / Pipelines / Memory / Knowledge tabs (the
global configuration surface) were never in the live bundle — they only
existed in tracked source. The chat window rendered assistant text as a
`<pre>` block, even though the stylesheet shipped classes for
`message-paragraph`, `message-inline-code`, `message-code-wrap`,
`message-link` that the React code never used. No onboarding gate fired
when the host was unconfigured.

Audit report: see this session's prior messages. The headline: a
configurable shell, a rich chat window, and a collapse-everything design
language, with the existing API surface — no new dependencies.

## 1.2 What shipped (commit `ede75f3`)

| Area | Files | Notes |
|------|-------|-------|
| Onboarding gate (modal + banner) | `web/control-center/src/onboarding.tsx` (new, 438 LOC), wrapped at top of `App.tsx` return | Reads `/api/onboarding/status`; full-screen modal while `!configComplete && !dismissed`; persistent top banner after dismiss; never shown once `configComplete: true`. Submits via `/api/onboarding/configure` (already wired by the host). All three surfaces (web / CLI / Telegram) now agree on the same `configComplete` state. |
| Collapsible panel shell | `web/control-center/src/collapse.ts` (new, 105 LOC) + `PanelHeader` in `App.tsx` + ~400 LOC of CSS | Every `<article class="panel">` got a `[−]/[+]` toggle backed by `localStorage.fft.panel.*`. Defaults: primary panels open, secondary collapsed. |
| View state persistence | `useViewState()` in `collapse.ts` | `localStorage.fft.view` saves `{ layout, chatFocus }`. Two layouts: `dock` (current 3-col) and `stacked` (full-width chat + side panels below). `Chat focus` checkbox hides everything except the live chat panel. |
| Rich chat markdown | `web/control-center/src/markdown.tsx` (new, 289 LOC) | Inline parser; GFM tables, fenced code, inline code, bold/italic, links, lists, headings. ~150 LOC of CSS already in styles.css for the message classes finally got used. |
| Streaming caret + message border | CSS only | `message--streaming` border + blinking `▍` caret on the active run. Replaces the "wall of monospace text" feel. |
| Service + Session Controls | New panel in the chat tab's right column, uses existing WebSocket methods | `sessions.patch` (per-session provider/model/think/reasoning) and `sessions.reset`. `service.gateway` for status/doctor/restart. Both gateway methods already existed in `tui/gateway-server.ts`; this is the first UI consumer. |
| File Editor | New `Files` tab, ~150 LOC in App.tsx + ~50 LOC CSS | `/api/files/roots` for root list, `/api/files/tree` for browsing, `/api/files/read` + `/api/files/write` for editing. Includes filter, breadcrumb, dirty-state detection, up/root nav, inline create, reload, save. |
| Skills tab filter | Client-side filter in the existing Skills panel | Same as the live dist had. Avoids refetching the catalog. |
| Empty states + composer hint | App.tsx | "No sessions loaded", "No messages yet", "⌘+Enter to send" — small UX wins from the audit. |

## 1.3 What was NOT touched

- **No new dependencies.** `web/control-center/package.json` still has
  `react`, `react-dom`, `vite`, `typescript`, and types only. The markdown
  renderer is hand-rolled, not `react-markdown`. No `cmdk`, no
  `react-resizable-panels`, no Radix/shadcn, no syntax highlighter.
- **No backend changes.** All new UI surfaces use existing endpoints
  (`/api/onboarding/{status,configure}`, `/api/files/{roots,tree,read,write}`,
  WebSocket `sessions.patch`, `sessions.reset`, `service.gateway`). The
  TUI gateway already exposed `patchSessionPrefs` and `getSessionPrefs`
  adapters; the web now uses them.
- **No design language change.** Brutalist Swiss is preserved: 3px black
  borders, hard 6px drop-shadow, Menlo monospace headings, orange #ff4f00
  + teal #0e6f7b on cream #ece9df.
- **No source/dist drift fix.** The live dist that was being served
  before this change was 167KB; the new bundle is 186KB JS + 17KB CSS
  (gzip 57KB). The tracked source on `dev` is now what the bundle is
  built from, so future builds won't drift.

## 1.4 How to deploy (when user approves)

```bash
# In the cc worktree (already on feat/control-center-revamp):
git push origin feat/control-center-revamp:dev   # fast-forward dev

# In the runtime checkout (~/fft_nano, on dev):
cd ~/fft_nano
git pull --ff-only origin dev
npm run web:build                                # rebuild bundle
npm run build                                    # rebuild host (just in case)
launchctl kickstart -k gui/$(id -u)/com.fft_nano
# Verify:
launchctl list | grep com.fft_nano
lsof -nP -iTCP:28990 -sTCP:LISTEN
cat ~/fft_nano/data/fft_nano.lock
```

## 1.5 How to verify (operator checklist)

1. `http://127.0.0.1:28990` loads, no console errors.
2. **Onboarding:** if you unset `TELEGRAM_BOT_TOKEN` and `ZAI_API_KEY`
   in `.env`, restart → first page load shows the full-screen onboarding
   modal. Click "Later" → top banner appears. Click "Resume setup" →
   modal reopens. Complete it → no modal, no banner after refresh.
3. **Collapse:** every panel has `[−]/[+]` in the header. State survives
   a hard refresh.
4. **View toggle:** top masthead has "Dock" / "Stacked" + "Chat focus"
   checkbox. State survives refresh.
5. **Chat:** send a prompt in `main`. The assistant message renders
   headings, code blocks, lists, tables. Streaming messages show a
   blinking caret and an orange border.
6. **Service + Session Controls:** change Think to `medium`, click
   `Apply Prefs`, the events panel shows `sessions.patch main`.
7. **Files tab:** pick the `workspace` root, navigate into `skills/`,
   open a `SKILL.md`, edit one line, click `Save`. The events panel
   shows the file write; the breadcrumb reflects the new path.
8. **All previous tabs still work:** Overview, Setup, System, Skills,
   Tasks, Pipelines, Memory, Knowledge, Logs — each collapsible.

## 1.6 What's left (operator decisions)

- **Promote to `dev` and `main`:** see §1.4. The user has not yet
  approved deployment.
- **Persist view preset names** ("Operator", "On-call", "Debug"): the
  `useViewState` hook stores the current layout; presets are a small
  follow-up if the operator wants them.
- **Inline docs / help tooltips:** the audit flagged "no inline help
  on Think/Reasoning/Provider". The current state has a "files-path"
  hint line under the Service + Session controls but no tooltips. Add
  on demand.
- **Syntax highlighting in code blocks:** the brutalist style says
  "no decoration" and the inline code blocks already convey structure
  with the `▎language` label and the dark backdrop. A highlighter is
  a 30KB dep the user explicitly said not to add. Skip.

---

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

## 2.2 Critical gaps — NOW CLOSED ✅

All three were resolved on branch `feat/durability-resume-and-followups`.

### (a) `worktree_path` now written at run start ✅
- `src/long-run-service.ts` gained a `resolveWorkspacePath` dep; `runLongAgentRun`
  records the run's durable workspace dir as `agent_runs.worktree_path` when it
  flips to `running`. A long run executes in its group's persistent workspace
  (not an ephemeral worktree), which survives a restart — so triage now
  correctly classifies interrupted long runs `recoverable`.

### (b) Resume consumer implemented ✅
- `longRunService.resumeRecoverableRuns()` reads `listRecoverableAgentRuns()` and
  re-enqueues each as a fresh continuation run with a resume preamble. A per-run
  `resume_attempts` counter (new `agent_runs` column) caps revivals
  (`FFT_NANO_LONG_RUN_MAX_RESUMES`, default 2) so a run that crashes the host on
  every boot is abandoned. The source is marked `recovery_state='resumed'` up
  front, making startup idempotent. Wired into `app.ts main()` after channels
  come up (so resumed runs can deliver). New recovery state: `'resumed'`.

### (c) Verdict feed-forward confirmed wired ✅
- Verified `recordEvaluatorVerdict` is reached at `coding-orchestrator.ts:1324`
  for non-skipped verdicts; read back at L1074 via `getEvaluatorStats`. Remains
  group-scoped, coding/subagent only by design. No code change needed.

## 2.3 Follow-up sections — ALL COMPLETE ✅

1. **Resume consumer + `worktree_path` wiring** — §2.2(a)(b). DONE.
2. **§4a memory injection consistency** — DONE. `shouldBuildRetrievedMemoryContext`
   (`src/pi-runner.ts`) now returns true for `isScheduledTask`/`isSubagent` too,
   so cron + subagent runs build memory context like main chat (same env gate).
3. **§3 outbox delivery queue** — DONE. New `delivery_outbox` table + `src/outbox.ts`
   (`createOutboxDeliverer`) give at-least-once + dedupe (UNIQUE `dedupe_key`).
   Cron announces deliver via the outbox (`cron:{id}:{run}` key); startup flush
   re-attempts entries left undelivered by a crash. Interactive chat streaming was
   intentionally NOT rerouted (no stable dedupe key → double-post risk).
4. **§4b semantic memory** — DONE (opt-in). `src/memory-embeddings.ts` re-ranks the
   top lexical candidates by a blend of normalized lexical score + embedding cosine
   from a LOCAL Ollama model (`MEMORY_SEMANTIC_ENABLED`, default off). Lexical stays
   recall + fallback; disabled = byte-identical prior behavior. No external API, no
   new npm deps. Requires the operator run Ollama with an embed model
   (`MEMORY_SEMANTIC_MODEL`, default `nomic-embed-text`) to take effect.
5. **§5 skill versioning** — DONE. `src/skill-history.ts` snapshots `SKILL.md` to
   `.history/` before every patch (bounded to 10); new `skill_rollback` IPC action
   restores the prior version (reversible).

# Part 2 — Agent Durability & Self-Improvement (ARCHIVED)

Last updated: 2026-05-28. Companion to `MISSION_CONTRACT.md` (the what/why) — this
section is the **how to continue**.

## 2.1 Where things stand

Two-track, two-worktree. **They share one `.git` — a branch can only be checked
out in one worktree at a time.**

- **`origin/main`** — blessed/release. PR-gated (0 approvals = self-mergeable),
  force-push blocked. Moves ONLY by merging `dev` + tagging a release.
- **`origin/dev`** — active integration line. Direct (non-PR) pushes allowed,
  force-push blocked (even for admins). This is what the runtime runs.
- **`~/fft_nano-dev`** — edit/build/test worktree. Work on FEATURE branches here,
  never on `dev`.
- **`~/fft_nano`** (= `/Users/username/FFT_nano`, case-insensitive FS) —
  runtime worktree on `dev`. **Never hand-edit.** Builds + restarts the launchd
  service from merged `dev`.

**Loop:** edit in `fft_nano-dev` on a feature branch → push → merge into
`origin/dev` (direct fast-forward push allowed) → in `~/fft_nano`:
`git pull --ff-only origin dev` → `npm run build` → restart → verify → when
blessed, PR `dev → main` + tag.

## 2.5 Build / test / deploy / verify

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

## 2.6 Gotchas

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

## 2.7 Cold-start orientation

1. Read `MISSION_CONTRACT.md`, then Part 1 of this file.
2. `CLAUDE.md` (repo root) = architecture, message flow, key files.
3. All §2.2 gaps and §2.3 follow-ups are now implemented + tested on branch
   `feat/durability-resume-and-followups` (full suite 705 tests, 703 pass / 2
   skip / 0 fail). Remaining work is deploy + live verification per §2.5, and
   (optional) enabling semantic memory by running Ollama with an embed model.

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
