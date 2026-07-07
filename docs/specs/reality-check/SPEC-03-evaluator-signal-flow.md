# SPEC-03 — Evaluator Signal Flow (verdicts must actually land in SQLite)

**Severity:** HIGH · **Type:** code change · **Status:** Ready for dev

## Problem

`evaluator_verdicts` has exactly one row in the entire history of the live host: a
2026-06-22 cron run (`cron-task-main-knowledge-nightly-lint-1782113953214`, verdict
`fail`, issue "Claimed artifact does not exist: knowledge/raw/2026-06-21_web-ui-lan-fix.md").
The log shows 144 "Running evaluator pass" and 90 "Evaluator verdict" lines but only 1
"Recording verdict outcome" line. The self-improvement feedback loop
(`getEvaluatorStats` → coding-orchestrator learned context) and the WS4.3 degraded-signal
watchdog both depend on this table having rows. With 1 row ever, both are dead: verdict
feed-forward has nothing to feed forward, and the watchdog's `recentSkips > 5` (of the
last 10) trigger can never fire because there has never been a 10-row window, let alone
one with 6 skips in it.

## Evidence

- `evaluator_verdicts`: 1 row total (`src/db.ts:111-123` schema, confirmed via live DB).
- `logs/fft_nano.log`: `"Running evaluator pass"` × 144, `"Evaluator verdict"` × 90,
  `"Recording verdict outcome"` × 1 (live host, 2026-07-07).
- `chat_sample_decision` (WS4.4 chat-sampling path, `src/evaluator.ts:1054-1153`, wired at
  `src/pipeline/message-dispatch-pipeline.ts:1436-1472`) appears only **19** times in the
  live log: 17× `skip (explain-only task)`, 2× `skip (not sampled)`, **0×** `evaluate`.
  `"Chat evaluation completed"` / `"Chat evaluation failed"` both appear **0** times.
- `config/runtime.parity.json` (both the live host and this dev worktree, byte-identical
  on this key) has **no `evaluator` block at all** — `chatSampleRate` silently falls back
  to the hardcoded default (`src/parity-config.ts:238`, `0.1`).
- The live host has restarted **4,254** times (`grep -c "Database initialized"
  logs/fft_nano.log`) across a single unrotated log file, so the 144/90 counts mix
  entries from superseded code (e.g. historical `"always-eval run type: heartbeat"`
  reasons that do not exist anywhere in the current `shouldEvaluate()` — grep confirms
  zero occurrences of the string `"always-eval"` in `src/` or the live `dist/`). Only the
  current gating logic below is relevant to the fix.

## Root cause

The audit's working hypothesis — "chat runs bypass the `recordVerdictOutcome`
chokepoint" — **does not hold up under inspection and should be retired.**
`runSampledChatEvaluation` (`src/evaluator.ts:1054-1153`) calls `recordVerdictOutcome`
unconditionally after every sampled evaluation (line 1128), and this is wired into the
live chat-completion path (`src/pipeline/message-dispatch-pipeline.ts:1436-1472`, shipped
2026-06-10, commit `36f59c0`, present in the running `dist/`). The existing test suite
(`tests/evaluator-chokepoint.test.ts`, `tests/evaluator-eligible-skip.test.ts`) already
covers the chokepoint's internal discrimination logic thoroughly and correctly.

The real gap is upstream of the chokepoint, in **eligibility**, and it has two distinct
causes:

1. **Cron/scheduled runs are structurally excluded from ever reaching a verdict.**
   `shouldEvaluate()` (`src/evaluator.ts:130-137`) rejects any `runType` other than
   `'coding'`/`'subagent'` outright:
   ```
   if (ctx.runType !== 'coding' && ctx.runType !== 'subagent') {
     return { evaluate: false, reason: `${ctx.runType} run type not eligible for evaluation` };
   }
   ```
   This check runs *before* any of the duration/tool-count/output-length heuristics, so a
   cron task that runs for 10 minutes and rewrites half the knowledge wiki is gated out
   exactly the same as a 2-second no-op — unless `forceEvaluate` is set. Both cron
   callers only set `forceEvaluate` when the task was agent-created
   (`task.created_by === 'agent'`, `src/cron/service.ts:441`, `src/task-scheduler.ts:169`
   — mirrored identically in `runLegacyTask`/`runScheduledTaskV2`). The overwhelming
   majority of recurring tasks on a live host are operator/system-scheduled, not
   agent-created, so they are permanently ineligible. The single persisted row belongs to
   the one cron task that happens to be agent-created (`task-main-knowledge-nightly-lint`).
   A rejected-by-runType outcome is a `threshold-skip`, and `recordVerdictOutcome`
   (`src/evaluator.ts:813-824`) treats `threshold-skip` as a hard no-op by design — no
   verdict row, no eligible-skip row, not even a debug-level breadcrumb visible at
   default log levels. This is the dominant cause of the empty table.

2. **Chat sampling is correctly wired but throttled to near-zero volume**, by the product
   of two independently-reasonable filters that compound badly: `isActionfulChatTask`
   (`src/evaluator.ts:391-417`) discards explain-only turns (89% of the observed sample),
   and `chatSampleRate` then discards 90% of what's left (`src/parity-config.ts:238`,
   silently defaulted because `runtime.parity.json` has no `evaluator` key to override
   it). Net effective sampling rate on *all* chat turns is roughly 1%, which is why 19
   decisions in the live window produced zero evaluations — not a bug, but an
   undocumented, unreviewed default that nobody chose.

Because (1) starves the table of rows for the run types that do the most unattended
work, and (2) starves it for the run type with the most conversational volume, the table
never accumulates the 10-row window the WS4.3 watchdog needs, and `getEvaluatorStats`
(`src/db.ts:1103-1184`) has nothing to feed the coding orchestrator.

## Fix

1. **Extend `shouldEvaluate()` eligibility to `'cron'` and `'scheduled'`, gated by the
   same heuristics `'coding'` already uses**, instead of the current blanket runType
   exclusion. Concretely, change the eligible-runtype set from `{'coding', 'subagent'}` to
   `{'coding', 'subagent', 'cron', 'scheduled'}` in `src/evaluator.ts:130-137`, leaving the
   duration/tool-count/output-length gates (`MIN_DURATION_MS`, `EVAL_DURATION_MS`,
   `EVAL_TOOL_COUNT`, `EVAL_OUTPUT_CHARS`) unchanged and unconditionally applicable to
   both new run types. This does **not** touch `forceEvaluate` behavior (agent-created
   tasks keep bypassing the gate) — it only stops silently discarding substantial
   non-agent-created recurring-task runs.
2. **Make `evaluator.chatSampleRate` an explicit, documented setting.** Add an `evaluator`
   block to `config/runtime.parity.json` (both this dev worktree's template and the
   operator-facing docs) with `chatSampleRate: 0.25` and a one-line rationale comment in
   the accompanying docs (not the JSON itself, which has no comment syntax): recommended
   because `isActionfulChatTask` already discards ~85-90% of turns before sampling ever
   applies, so a rate tuned assuming raw chat volume (0.1) yields a near-zero absolute
   evaluation count on the pre-filtered, highest-signal subset; 0.25 is the smallest bump
   that gets expected monthly evaluated-chat-turn counts into double digits on a
   moderate-traffic group without meaningfully increasing evaluator LLM spend (at most
   +15pp × ~10-15% actionful-turn share ≈ 1.5-3.75% additional evaluator calls over total
   chat volume).
3. **Boot witness for the implicit default.** In `src/parity-config.ts`, export whether the
   loaded file explicitly set `evaluator` (e.g. `EVALUATOR_CONFIG_EXPLICIT: boolean`,
   computed from `readJsonIfExists(PARITY_CONFIG_PATH).evaluator !== undefined`). In
   `main()` (`src/app.ts`), log a one-time WARN at boot when it's `false`, naming the
   effective `chatSampleRate` in use, so operators are never silently running on an
   unreviewed default (same "witness" pattern as SPEC-02; no outbox delivery needed here,
   log-only, since this is an operator-facing config gap, not a user-facing incident).
4. **Confirm the WS4.3 alert is reachable now that rows exist.** No change to the alert
   logic itself (`src/evaluator.ts:894-929`, already correctly tested in
   `tests/evaluator-chokepoint.test.ts` VAL-WS4-010/011) — add one integration-level test
   proving a *cron* run (not the synthetic contexts the existing chokepoint tests use)
   can accumulate real eligible-skip rows and cross the threshold end-to-end.

## TDD plan

Test file: `tests/evaluator-scheduled-eligibility.test.ts` (new). Extends, does not
duplicate, the existing chokepoint-internals coverage in `evaluator-chokepoint.test.ts`
and `evaluator-eligible-skip.test.ts`.

1. RED: `shouldEvaluate({ runType: 'cron', durationMs: 60_000, toolsInvoked: 5,
   agentOutput: 'x'.repeat(50) })` currently returns
   `{ evaluate: false, reason: 'cron run type not eligible for evaluation' }`; after the
   fix it must return `{ evaluate: true, reason: 'duration 60000ms >= 45000ms' }`.
2. RED: identical assertion for `runType: 'scheduled'`.
3. RED: a *trivial* cron run (`durationMs: 5_000, toolsInvoked: 0, agentOutput:
   'x'.repeat(50)`) must still return `{ evaluate: false, reason: 'trivially short run' }`
   post-fix — proves cron/scheduled now use the graduated heuristic, not a blanket
   bypass.
4. RED: `runScheduledTaskV2` (`src/cron/service.ts:313`) with a mocked
   `runContainerAgent` returning a 60s-equivalent substantial result and
   `task.created_by !== 'agent'` (so `forceEvaluate` is false) currently writes zero rows
   to `evaluator_verdicts`; after the fix, asserts exactly one row with
   `skipped=0` (or `skipped=1`/`skip_reason` on an injected evaluator failure) is written.
5. RED: `EVALUATOR_CONFIG_EXPLICIT` is `false` when `config/runtime.parity.json` has no
   `evaluator` key (current state, both repos) and `true` once the key is added per fix
   #2.
6. RED: boot sequence with `EVALUATOR_CONFIG_EXPLICIT === false` emits exactly one WARN
   log line naming the effective `chatSampleRate`; emits nothing when `true`.
7. RED: end-to-end WS4.3 — seed 6 cron-sourced eligible-skip rows (evaluator-threw) via
   the now-reachable cron path into a 10-row window for one group, assert
   `recordVerdictOutcome`'s next call returns `shouldAlert: true` and a
   `delivery_outbox` row with dedupe key `eval-degraded:<groupFolder>` exists (mirrors
   VAL-WS4-010 but through the cron entry point instead of a synthetic outcome object).
8. GREEN: implement; `npm run typecheck && npm test` clean.

## Acceptance criteria

- [ ] A non-agent-created cron or scheduled task with `durationMs >= 45_000` (or
      `toolsInvoked >= 3` / output `>= 1500` chars) produces a row in
      `evaluator_verdicts` without requiring `forceEvaluate`.
- [ ] A trivial non-agent-created cron/scheduled task still produces zero rows
      (no regression toward noisy over-recording).
- [ ] `config/runtime.parity.json` carries an explicit `evaluator.chatSampleRate` value
      with documented rationale.
- [ ] Boot log names the effective `chatSampleRate` and whether it came from an explicit
      config value or the code default.
- [ ] WS4.3 alert fires (`delivery_outbox` row with `eval-degraded:<group>` dedupe key)
      once 6 of the last 10 rows for a group are skips, reachable through the cron path
      end-to-end, not just through the existing synthetic-outcome unit tests.

## Files

`src/evaluator.ts` (`shouldEvaluate` eligibility set), `src/parity-config.ts`
(`EVALUATOR_CONFIG_EXPLICIT` export), `src/app.ts` (boot witness log),
`config/runtime.parity.json` (explicit `evaluator` block),
`tests/evaluator-scheduled-eligibility.test.ts` (new).

## Out of scope

Changing the evaluator prompt, rubric, or scoring model (any run type). Adding
`'heartbeat'` or `'agent-task'` to the eligible-runtype set — neither currently has a
`runEvaluatorPass` caller in the codebase (grep-confirmed), so there is nothing to fix
there yet; adding eligibility without a caller would be speculative. Changing
`isActionfulChatTask`'s classification heuristic (separate concern, not evaluator
plumbing). The kill-switch witness pattern for `learning_paused` (SPEC-02) — this spec's
boot witness is config-visibility only, not a pause/resume mechanism.

## Risks / rollback

Widening `shouldEvaluate()` eligibility increases evaluator LLM call volume for
cron/scheduled runs that cross the existing thresholds — bounded by the same
`EVAL_DURATION_MS`/`EVAL_TOOL_COUNT`/`EVAL_OUTPUT_CHARS` constants already governing
`'coding'`, so the marginal cost is proportional to how many recurring tasks already do
non-trivial work (visible today via `toolExecutions`/`durationMs` on those runs before
shipping, to size the increase). All changes are additive (new eligible run types, new
config key, new log line); rollback is reverting the `shouldEvaluate` runtype set and the
config key. No schema migration required — `evaluator_verdicts` already has the
`skipped`/`skip_reason` columns live.
