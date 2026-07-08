# SPEC-06 — Scheduling Ownership (a cron that fails alone makes no sound)

**Severity:** SERIOUS · **Type:** code change · **Status:** Ready for dev

## Problem

FFT_nano has exactly one self-maintenance cron task wired up
(`task-main-knowledge-nightly-lint`), and it has been failing silently for most of its
life. It has run daily since 2026-05-05 and **37 of its 64 runs (58%) have errored**,
cycling through four unrelated failure classes, and **zero of those failures has ever
reached the operator** — the task was created with `delivery_mode: 'none'`, and nothing
else in the codebase reads its `consecutive_errors` counter. Meanwhile, the other two
maintenance rituals — `/librarian` and `/reflect` — have no scheduled task at all; they run
only when an operator remembers to type the command (`/reflect`: 0 runs ever;
`/librarian`: 1 manual run on 2026-06-07). There is no single place that answers "what
maintenance should be running right now, and is it healthy?"

*(Note: an earlier pass of this audit reported `scheduled_tasks` as empty and the nightly
task as "gone." Direct inspection of the live `scheduled_tasks` / `task_run_logs` tables
below shows the row has in fact existed continuously since 2026-05-05 and is still
`active` — it was never deleted, it has just been failing invisibly. That is arguably the
more serious finding: a task that looks fine from the outside (`status: 'active'`,
`next_run` correctly computed) while silently broken underneath.)*

## Evidence

- `scheduled_tasks` (live DB, `~/fft_nano/store/messages.db`) has **exactly one row**:
  `task-main-knowledge-nightly-lint`, `schedule_type='cron'`, `schedule_value='17 2 * * *'`,
  `status='active'`, `created_at='2026-05-05T00:12:40.723Z'`,
  `last_run='2026-07-07T07:17:05.020Z'`, `next_run='2026-07-08T07:17:00.000Z'`,
  **`consecutive_errors=15`**.
- `task_run_logs` for that `task_id`: **64 rows total, 27 `success` / 37 `error`**
  (`min(run_at)=2026-05-05T07:17:16Z`, `max(run_at)=2026-07-07T07:17:05Z`). Failure
  history by era, verbatim from `error` column:
  - 2026-05-05 → 05-10 (6 runs): `Model "minimax/MiniMax-M2.7-highspeed" not found. Use
    --list-models to see available models.`
  - 2026-05-11 → 05-18 (8 runs): `429 {"type":"error","error":{"type":"rate_limit_error",
    "message":"usage limit exceeded (2056)"}...}`
  - 2026-05-19 → 06-10 (23 runs): clean, all `success`.
  - 2026-06-11 → ~06-13+ : `Sandbox refusal: run with origin=headless and effective tool
    set [read,bash,edit,write,grep,find,ls,agent] is refused when...`
  - Current streak through 2026-07-07 (≥15 consecutive, matching `consecutive_errors=15`):
    `401 Incorrect API key provided`.
- `deliverTaskOutcome()` (`src/cron/service.ts:203-211`): `if (mode === 'none') return;`
  before any delivery attempt. `getTaskDeliveryMode()` (`src/cron/service.ts:191-197`)
  returns `'none'` unless `delivery_mode` is `'announce'`/`'webhook'`.
  `ensureKnowledgeNightlyTask()` (`src/knowledge-wiki-task.ts:140-167`) hardcodes
  `delivery_mode: 'none'` at creation (line 155) — this task is, by construction,
  incapable of ever notifying anyone of failure through its own run-delivery path.
- `consecutive_errors` is incremented in exactly two places
  (`src/cron/service.ts:323`, `:505`) and is persisted to the row
  (`updateTaskAfterRunV2`) — but a repo-wide search shows **no other reference reads it**.
  `resolveTaskNextRun()` (`src/cron/service.ts:133-180`) always schedules the next natural
  cron occurrence regardless of `consecutiveErrors`; there is no threshold that pauses,
  backs off, or escalates. A cron task can fail every day forever and stay `status:
  'active'` indefinitely — which is exactly what has happened here.
- The only surface that would show this is a manually-invoked command:
  `/tasks` → `formatTasksText()` (`src/telegram-delivery.ts:996-1015`, renders
  `errors=<consecutive_errors>` per row) or `/knowledge status` →
  `nightlyTaskStatus` (`src/telegram-delivery.ts:1428-1435`, reports the DB `status`
  column, which stays `'active'` and says nothing about the error streak). Both are
  pull-only — the exact same "witness" gap SPEC-02 already fixed for the learning-pause
  flag.
- `ensureKnowledgeNightlyTask()` (`src/knowledge-wiki-task.ts:88-177`) is idempotent
  (`getTaskById` short-circuits if the row exists) and **is** wired at every boot and every
  main-group (re)registration via `maybeRunBootMdOnce()`
  (`src/wiring.ts:754-773`, called from `src/app.ts:582`, `:610`, `:662`, and from
  `registerGroupImpl` at `src/wiring.ts:683`). That is a real, working "recreate if
  missing" mechanism — but it is undocumented as a pattern, exists for exactly **one** task
  type, and only fires on rare lifecycle events. If an operator or agent ever cancels this
  task (`/tasks cancel` → `src/telegram-commands.ts:3073`/`:3139`, or the web control
  center → `src/web-control-center.ts:363`), it does not come back until the next service
  restart or main-group re-registration.
- No equivalent "ensure this default task exists" function exists for `/librarian` or
  `/reflect` — `ensureKnowledgeNightlyTask` is the only such function in the codebase
  (verified by search). The idle curator (`startCuratorLoop`, `src/app.ts:156-166`, hourly
  tick, `CURATOR_TICK_INTERVAL_MS = 60 * 60 * 1000`) only ever calls
  `maybeRunSkillManager()` (`src/wiring.ts:1955-1970`) — it has no equivalent hook for
  knowledge/librarian/reflect scheduling health.

## Root cause

Three compounding gaps, not one:

1. **The one seeded maintenance task ships permanently mute.** `delivery_mode: 'none'`
   means no failure of any kind — auth, rate-limit, model-not-found, sandbox-refusal — has
   ever been capable of reaching a human through this task's own delivery path.
2. **`consecutive_errors` is recorded but never consulted.** There is no circuit breaker
   distinguishing "one bad night" from "broken continuously for two months." The counter
   exists in the schema and is faithfully incremented; nothing reads it.
3. **The "ensure a default task exists" pattern was built once, for one task, wired only
   to rare lifecycle events, and never generalized.** There is no single place that
   enumerates "these N maintenance tasks should exist right now" and reconciles reality
   against it periodically — only a one-off idempotent constructor tied to boot/
   registration, and only for the knowledge-lint task.

## Fix

### A — Make failure loud (mirrors the SPEC-02 witness pattern)

1. In `runScheduledTaskV2` (`src/cron/service.ts`), after `consecutiveErrors` is computed
   (line 505; mirror at line 323), add a threshold check independent of the task's own
   `delivery_mode`: when `consecutiveErrors` crosses `FFT_NANO_TASK_ERROR_ALERT_THRESHOLD`
   (default 3) and every `N` after (3, 6, 9…, same escalation shape as SPEC-02's drop
   counter), send one outbox-deduped notice — dedupe key
   `task-error-streak:{task.id}:{consecutiveErrors}` — to the main chat: `"[task.id]
   failed N times in a row (latest: <error, truncated>). Run /tasks for detail."` This is a
   cross-cutting ops witness, deliberately separate from the task's own `delivery_mode`
   (which controls per-run output, not health alerting), so it fires even for tasks
   explicitly configured `delivery_mode: 'none'`.
2. Extend `formatLearningDigest()` (`src/telegram-delivery.ts:1173+`) with a "Scheduled
   maintenance" section: count of active `scheduled_tasks`, any at/above the alert
   threshold (id + consecutive_errors + truncated last error), and an explicit line when
   the table holds **zero** rows while at least one default maintenance task is expected
   (see B) — this is the "empty schedule" alarm the audit asked for, reusing the existing
   digest surface rather than inventing a new command.

### B — Generalize the seed pattern into an owned, periodic default schedule

3. Extract a table-driven `ensureDefaultMaintenanceTasks()` (new file,
   `src/scheduled-maintenance.ts`) listing three entries:
   - **Nightly knowledge lint** — unchanged, `17 2 * * *` (existing
     `KNOWLEDGE_NIGHTLY_DEFAULT_CRON`, `src/knowledge-wiki-task.ts:10`).
   - **Weekly librarian** — `0 3 * * 0` (Sunday 03:00 local). Rationale: runs after a full
     week of nightly-lint passes have accumulated raw captures/wiki drift for it to
     reconcile; Sunday early-morning avoids contending with daytime operator activity.
   - **Weekly reflect** — `30 3 * * 0`, staggered 30 minutes after librarian. Rationale:
     both are heavyweight agent runs against the same main workspace; running them
     back-to-back rather than concurrently avoids two full agent sessions racing on the
     same files.
   Each entry reuses the existing prompt builders (`buildLibrarianAgentPrompt('run', '')`,
   `buildReflectionAgentPrompt('run', '')`, currently closures inside
   `createTelegramCommandHandlers` in `src/telegram-commands.ts:493-591` — export thin
   top-level wrappers so `ensureDefaultMaintenanceTasks()` can call them) so a scheduled
   run behaves identically to a manual `/librarian run` / `/reflect run`. All three ship
   with `delivery_mode: 'none'` (unchanged for lint; consistent for the new two) — per-run
   noise stays off, health alerting comes from fix A.1, not from per-run announcements.
4. Call `ensureDefaultMaintenanceTasks()` (idempotent, same `getTaskById` guard as today)
   from the same two lifecycle call sites `ensureKnowledgeNightlyTask` already uses
   (`maybeRunBootMdOnce`, `src/wiring.ts:754`) **and** from the hourly `runCuratorTick`
   (`src/wiring.ts:1955-1970`, already ticking regardless of user traffic). This is the
   concrete fix for "cancelled once, gone until restart": reconciliation now happens at
   most an hour after any of the three tasks goes missing, not only at the next service
   restart.

### C — Ownership, made explicit

5. `ensureDefaultMaintenanceTasks()` becomes the single source of truth for "what
   maintenance schedule should exist." An operator who cancels one of these three tasks
   via `/tasks cancel` should expect it to **reappear within one curator tick (≤1h)** —
   removing an entry permanently requires a code change to the table in
   `src/scheduled-maintenance.ts`, not just a Telegram command. This is documented here so
   the next operator who cancels a stuck task isn't surprised it comes back, and so the
   next engineer who wants a task gone permanently knows where to remove it.

Config: `FFT_NANO_TASK_ERROR_ALERT_THRESHOLD` (default 3, 0 disables witness #1 only —
the default schedule and reconciliation in B are unaffected).

## TDD plan

Test file: `tests/scheduled-maintenance.test.ts` (new).

1. RED: `ensureDefaultMaintenanceTasks()` on an empty `scheduled_tasks` table creates
   exactly 3 rows with the expected ids/`schedule_type='cron'`/`schedule_value`s; calling
   it again creates 0 additional rows (idempotent) and does not mutate
   `consecutive_errors`/`status` on existing rows.
2. RED: error-streak witness — simulate three consecutive error runs (via
   `resolveTaskNextRun`/the alert-check helper, fixture task with `consecutive_errors`
   stepping 1→2→3) → exactly one outbox row at 3 with dedupe key
   `task-error-streak:<id>:3`; re-simulating the same count → still one row; stepping to 4
   → still one row (not a multiple of 3 yet); stepping to 6 → a second row.
3. RED: curator-tick reconciliation — delete one of the three seeded tasks from a fixture
   DB, invoke the reconciliation call the curator tick makes → the deleted task
   reurfaces with its original id and schedule; the two untouched tasks are unchanged
   (no duplicate rows).
4. RED: `formatLearningDigest()` (or its maintenance-section helper in isolation) — feed a
   fixture task at `consecutive_errors=5` (above default threshold 3) → digest text
   contains the task id and error count; feed zero scheduled tasks → digest text flags
   the empty-schedule case explicitly (distinct string from "0 skill mutations" etc.).
5. GREEN: implement; `npm run typecheck && npm test` clean.

## Acceptance criteria

- [ ] `ensureDefaultMaintenanceTasks()` seeds nightly-lint + weekly-librarian +
      weekly-reflect idempotently; test 1 green.
- [ ] Three consecutive task errors produce exactly one outbox-deduped alert, with correct
      escalation cadence; test 2 green.
- [ ] A cancelled default maintenance task reappears within one curator tick via the same
      reconciliation call boot uses; test 3 green.
- [ ] `/learning` digest reports unhealthy (error-streak) and missing (empty-table)
      schedule states; test 4 green.
- [ ] Zero behavior change for a task with `consecutive_errors` below threshold (no new
      log lines, no digest changes) — covered by the "below threshold" branch of test 2.

## Files

`src/cron/service.ts`, `src/scheduled-maintenance.ts` (new), `src/knowledge-wiki-task.ts`
(export cron constant reuse only, no behavior change), `src/telegram-commands.ts` (export
`buildLibrarianAgentPrompt`/`buildReflectionAgentPrompt` wrappers), `src/wiring.ts`
(wire `ensureDefaultMaintenanceTasks()` into `maybeRunBootMdOnce` and `runCuratorTick`),
`src/telegram-delivery.ts` (`formatLearningDigest` maintenance section),
`src/app-config.ts` (new env), `tests/scheduled-maintenance.test.ts`.

## Out of scope

Diagnosing or fixing the current `401 Incorrect API key provided` failure itself — that is
an operational credential-rotation action against whichever provider the nightly-lint
task's configured model uses, not a code change; this spec's job is making that class of
failure impossible to miss, not curing this instance of it. Auto-retry with a fallback
model/provider on error (a reasonable follow-up, not required to close this gap). A full
historical audit trail of every schedule change (large; `task_run_logs` already gives
enough forensic signal for the acceptance criteria above).

## Risks / rollback

All changes are additive. The error-streak witness only fires above a configurable
threshold (default behavior for healthy tasks is unchanged). The curator-tick
reconciliation call is guarded by the existing `getTaskById` idempotency check, so it is a
silent no-op whenever all three default tasks already exist — no risk of duplicate rows.
`delivery_mode` for all three tasks stays `'none'`; this spec does not change per-run
announcement behavior. Rollback = revert commit; no schema change, no data migration.
