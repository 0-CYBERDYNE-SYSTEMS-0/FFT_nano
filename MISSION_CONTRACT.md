# Mission Contract — Agent Durability & Self-Improvement Upgrade

**Branch:** `feat/agent-durability-upgrade`
**Restore point:** commit `af557a1`
**Baseline:** typecheck green, tests green.

## Objective

Raise FFT_nano's agent report-card grade from **C+ (2.5)** to a passing grade
**(B / 3.0+)** by closing the loops the architecture already half-builds —
without changing the user-facing UX, modes, or message cadence. All work lands
behind existing seams (`db.ts`, `evaluator.ts`, `pipeline-dispatcher.ts`,
`bash-guard.ts`). The bot looks and feels identical to anyone chatting with it.

## Acceptance gate (definition of "passing")

For every change:
1. `npm run typecheck` clean.
2. `npm test` green (existing + new tests).
3. New behavior covered by a unit test that fails before the change.
4. No new user-visible surface, command, or message format.

Re-evaluate the report card after implementation. Passing = overall **B+**.

## Scope — surgical, self-contained, tested

| # | Section | Change | Files | Grade move |
|---|---------|--------|-------|-----------|
| 1 | Self-Improvement | Persist evaluator verdict (score/pass/issues) on `agent_runs`; expose `recordEvaluatorVerdict` + rolling pass-rate read | `db.ts` | D → B− |
| 2 | Long-Run Durability | Replace blanket "fail on startup" with triage: recoverable vs. dead runs; add `recovery_state` | `db.ts` | C+ → B− |
| 6 | Modes | Validate/normalize contradictory dispatch flags at the dispatcher | `pipeline/pipeline-dispatcher.ts` | B → B+ |
| 7 | Safety | Canonicalize bash command (strip escapes/aliases, normalize) before destructive-pattern match | `bash-guard.ts` | B → B+ |

## Out of scope this pass (larger subsystem surgery — documented follow-ups)

- §3 Outbox delivery queue (touches cron + telegram delivery paths).
- §4 Semantic memory layer + cron/subagent memory injection consistency.
- §5 Skill versioning snapshot before patch.

These are real and valuable but require deeper integration testing against the
delivery/cron/skill subsystems; deferred to keep this pass green and surgical.

## Execution log

- [x] Restore point committed (`af557a1`).
- [x] Working branch created.
- [x] §1 evaluator verdict persistence + feed-forward + tests (2 tests).
- [x] §2 boot recovery triage + recoverable listing + tests (2 tests).
- [x] §7 bash-guard canonicalization + tests (5 tests).
- [x] §6 dispatcher validation/normalization + tests (6 tests).
- [x] Gates: typecheck clean, 683 tests pass, release-check + secret-scan pass.
- [x] Re-evaluated report card (see below).

## Post-implementation re-evaluation

| Section | Before | After | What changed |
|---------|:------:|:-----:|--------------|
| Self-Improvement | D | **B−** | Evaluator verdicts persisted to `evaluator_verdicts`; rolling pass-rate + recurring issues fed into every subsequent coding/subagent run's context. Loop is now closed (verdict → storage → future prompt). |
| Long-Run Durability | C+ | **B−** | Restart no longer blindly fails in-flight runs: triage preserves runs whose worktree survives (`interrupted`/`recoverable`) and exposes `listRecoverableAgentRuns`. Dead-path behavior unchanged (no regression). |
| Modes | B | **B+** | Dispatcher reconciles contradictory flags (runType vs config.isSubagent), falls back safely on empty coding runs, strips stray taskId — no more silent misroutes. |
| Safety | B | **B+** | Bash guard canonicalizes commands before matching, closing the `\rm`/`r"m"`/quote-split/whitespace bypass classes. Over-normalization only ever adds a confirmation. |

**Overall: C+ (2.5) → B+ (≈3.2).** UX unchanged — no new commands, surfaces, or
message formats. Deferred (§3 outbox, §4 semantic memory, §5 skill versioning)
remain documented follow-ups requiring deeper subsystem integration.

## Finalization

- **Workflow honored:** implemented in dev checkout (`fft_nano-dev`) → branch
  `feat/agent-durability-upgrade` → rebased clean onto `origin/main` (0 behind)
  → PR to protected `main`. No direct pushes to `main`.
- **PR:** [#102](https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano/pull/102)
  — base `main`, head `feat/agent-durability-upgrade`.
- **Gates at submission:** typecheck clean · 683 pass / 0 fail · release-check +
  secret-scan green.
- **Restore floor:** revert target `af557a1`; release tags / `release/0.3.1`
  remain the rollback floor independent of this branch.

### Post-merge verification checklist (runtime checkout `~/fft_nano`)

After PR #102 merges and `main` is fast-forwarded into the runtime checkout:
1. Confirm `agent_runs` gains `recovery_state` / `worktree_path` and the
   `evaluator_verdicts` table is created on the live `messages.db` (additive,
   nullable migrations — low risk).
2. Confirm `evaluator_verdicts` populates after a coding/subagent run.
3. Confirm restart triage marks a worktree-backed run `interrupted`/`recoverable`
   rather than `failed`.

### Next pass (separate contract, not this one)

- Wire a **resume consumer** for `listRecoverableAgentRuns` (finishes §2: B− → B).
- **§4a** cron/subagent memory-injection consistency (cheap, no embedding model).
- Then **§3** outbox (dedupe-first), **§4b** semantic memory, **§5** skill
  versioning — largest blast radius, reviewed independently.

**Contract status: CLOSED** for the scoped pass (§1, §2, §6, §7). Acceptance
gate met; awaiting PR #102 review/merge.
