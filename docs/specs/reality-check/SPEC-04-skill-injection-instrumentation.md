# SPEC-04 — Skill Injection Instrumentation (efficacy needs a numerator)

**Severity:** MEDIUM · **Type:** code change · **Status:** Ready for dev

## Problem

`learning_injections` has 2,244 rows spanning 2026-06-10 → 2026-07-06, and every single
one has `kind='memory'`. `kind='skill'` has never been written, ever. The skill-efficacy
query (`getSkillEfficacy`, `src/db.ts:1260-1284`) joins `learning_injections` (filtered to
`kind='skill'`) against `evaluator_verdicts` on `request_id` — with zero `kind='skill'`
rows to join, the query is permanently empty, regardless of how good or bad the evaluator
signal itself is (see SPEC-03). Skills are injected into every run today
(`buildSkillCatalogEntries`, `src/pi-runner.ts:1170-1176`) but that injection is only
recorded in a side-channel, file-based usage counter (`noteSkillCatalogUse`,
`src/skill-lifecycle.ts:571-589`) that has no join key back to a run's outcome — it can
tell you a skill was listed N times, never whether the runs it was listed in passed or
failed.

## Evidence

- `learning_injections`: 2,244 rows, 100% `kind='memory'`, 100% `group_folder='main'`,
  0 rows with `kind='skill'` (live DB, 2026-07-07).
- `getSkillEfficacy` (`src/db.ts:1260-1284`) — the join `FROM learning_injections li JOIN
  evaluator_verdicts ev ON li.request_id = ev.request_id WHERE li.kind = 'skill'` has an
  empty left side by construction; the function always returns an empty `Map` on this
  host, independent of `evaluator_verdicts` row count.
- The only place skill "usage" is currently recorded at all is
  `noteSkillCatalogUse(mountedSkillsDir, skillCatalog.map(e => e.name))`
  (`src/pi-runner.ts:1173-1176`), which increments a per-skill `use_count`/`last_used_at`
  in a JSON file next to the skills directory (`loadSkillUsage`/`saveSkillUsage`,
  `src/skill-lifecycle.ts`) — this file has no `request_id`, so it cannot be joined to
  `evaluator_verdicts` and cannot answer "did runs where skill X was available pass more
  or less often than baseline."
- By contrast, the `kind='memory'` path (`src/pi-runner.ts:1136-1152`) stamps one
  `learning_injections` row per *selected* memory item, keyed by the run's own
  `request_id`, at the exact point memory context is assembled into the prompt — this is
  the pattern to mirror.

## Root cause

Nobody wired a `recordLearningInjection({ kind: 'skill', ... })` call at the skill
injection point. The memory path (WS5.1, `src/pi-runner.ts:1136-1152`) and the
coder-learnings/verdict-issues path (WS5.1, `src/coding-orchestrator.ts:1088-1121`) both
got instrumented when `learning_injections` was introduced; the skill-catalog path
(`src/pi-runner.ts:1161-1176`, same function, ~30 lines below the memory block) did not.
This isn't a bug in gating or eligibility (unlike SPEC-03) — the injection happens on
every run unconditionally, it is simply never stamped to SQLite.

One structural difference from memory matters for the fix: memory injection is
*retrieval-narrowed* (`memory.selectedItems` is a top-K subset chosen per-prompt by the
memory backend), whereas the skill catalog is *unfiltered* — `buildSkillCatalogEntries`
lists every skill under the budget cap (`skillCatalogMaxChars`,
`src/pi-runner.ts:1170-1172`) on every run, not a subset relevant to that specific task.
Mirroring the memory pattern exactly (one row per catalog entry per run) is still the
right first step — it is the only way to get `skill_name`-level granularity out of the
existing query at all — but it means `kind='skill'` rows will have much higher
per-run cardinality than `kind='memory'` rows, and every row will correlate with
whichever verdict that run happens to produce whether or not the agent actually invoked
that skill. This is a real noise source, not just a volume concern, and is addressed
explicitly below rather than left implicit.

## Fix

1. In `src/pi-runner.ts`, immediately alongside the existing `noteSkillCatalogUse` call
   (lines 1173-1176), add a best-effort stamp per catalog entry, matching the memory
   block's try/catch-and-log shape (lines 1136-1152) exactly:
   ```
   for (const entry of skillCatalog) {
     try {
       recordLearningInjection({
         requestId: reqId,
         groupFolder: group.folder,
         kind: 'skill',
         item: entry.name,
       });
     } catch (err) {
       logger.warn({ err, requestId: reqId, groupFolder: group.folder }, 'Failed to record skill injection stamp');
     }
   }
   ```
   using the same `reqId` fallback (`input.requestId ?? \`run-${Date.now()}\``) already
   established for the memory block, so both `kind='memory'` and `kind='skill'` rows for
   the same run always share one `request_id` and both join cleanly to the same
   `evaluator_verdicts` row.
2. **Exclude evaluator meta-runs from noise.** `runContainerAgent` is also the entry point
   the evaluator itself uses for its own read-only QA pass
   (`buildEvaluatorContainerInput`, `src/evaluator.ts:578-605`, `isEvaluatorRun: true`).
   That pass never sets `requestId`, so today it would fall back to a synthetic
   `run-<timestamp>` id that never matches any real `evaluator_verdicts.request_id` —
   harmless (orphaned, non-joining) but pure noise. Gate the new stamp (and, while
   touching this code, the pre-existing memory stamp for consistency — flag only, no
   separate spec) behind `!input.isEvaluatorRun` so evaluator meta-runs never populate
   `learning_injections` at all.
3. **No backfill.** The catalog composition at injection time (which skills were mounted
   and under what budget) is not preserved anywhere retroactively — `noteSkillCatalogUse`'s
   JSON file only holds a running counter, not a per-request snapshot. The 2,244 existing
   `kind='memory'` rows and the single `evaluator_verdicts` row predate this change and
   cannot be paired with skill data after the fact. State this explicitly to the team so
   nobody spends time trying to reconstruct historical skill efficacy — `getSkillEfficacy`
   will only become meaningful for runs that occur after this fix (and after SPEC-03,
   since it also needs `evaluator_verdicts` to have rows to join against).
4. **Cardinality is bounded, not unbounded**, by the existing `skillCatalogMaxChars`
   budget (`PARITY_CONFIG.prompt.skillCatalogMaxChars`, default per
   `config/runtime.parity.json:prompt.skillCatalogMaxChars`) that already caps how many
   skills `buildSkillCatalogEntries` can return — no new cap is needed. The existing
   sample floor in `getSkillEfficacy` (`>= 5` matching non-skipped rows before a skill's
   efficacy is published, `src/db.ts:1248`) already absorbs early noisy/low-n skills; no
   change needed there either.

## TDD plan

Test file: `tests/pi-runner-skill-injection.test.ts` (new). Complements, does not
duplicate, `tests/learning-injection.test.ts` (which covers the `memory`/`verdict-issues`
kinds) and `tests/db-skill-efficacy.test.ts` (which covers the join/query logic against
synthetic rows, not the injection call site).

1. RED: a run with a 3-entry `skillCatalog` and `isEvaluatorRun` unset/false currently
   writes zero `kind='skill'` rows; after the fix, writes exactly 3, one per catalog
   entry, `item` equal to each entry's `name`, all sharing the run's `request_id`.
2. RED: a run with an empty `skillCatalog` ([]) writes zero `kind='skill'` rows (no
   spurious empty-item row).
3. RED: a run with `isEvaluatorRun: true` and a non-empty `skillCatalog` writes zero
   `kind='skill'` rows post-fix (meta-run exclusion).
4. RED: two runs sharing one `request_id` (memory-flush sub-run pattern, see
   `src/pi-runner.ts:1249` `flushRequestId`) — verify `kind='memory'` and `kind='skill'`
   rows for the *same* run share the same `request_id` as asserted in
   `tests/learning-injection.test.ts`'s existing "share the same request_id" test
   (VAL-WS5-002/003), extended to cover `kind='skill'`.
5. RED: `recordLearningInjection` throwing (synthetic failure, same harness as
   `tests/learning-injection.test.ts` VAL-WS5-002/003/004) does not abort the run or
   propagate — caught and logged, matching the memory/verdict-issues behavior.
6. RED: end-to-end — a run with 2 catalog skills followed by a recorded
   `evaluator_verdicts` row for the same `request_id` makes `getSkillEfficacy(groupFolder)`
   (`src/db.ts:1260`) return a non-empty result once the `>= 5` sample floor is reached
   across 5 such runs (proves the fix actually unblocks the pre-existing query, not just
   that rows get written).
7. GREEN: implement; `npm run typecheck && npm test` clean.

## Acceptance criteria

- [ ] Every non-evaluator run with a non-empty skill catalog writes one `kind='skill'`
      `learning_injections` row per catalog entry, sharing that run's `request_id`.
- [ ] Evaluator meta-runs (`isEvaluatorRun: true`) write zero `kind='skill'` rows.
- [ ] `getSkillEfficacy` returns non-empty results once 5+ runs for a skill have
      corresponding `evaluator_verdicts` rows (requires SPEC-03 also landed for
      non-coding/subagent run types to reach that volume in practice).
- [ ] No change to `noteSkillCatalogUse`'s existing file-based counter — this is an
      additive SQLite stamp alongside it, not a replacement.
- [ ] Zero backfill attempted or claimed; the team is explicitly told historical rows
      cannot be reconstructed.

## Files

`src/pi-runner.ts` (skill-catalog injection stamp, `isEvaluatorRun` gate),
`tests/pi-runner-skill-injection.test.ts` (new).

## Out of scope

Narrowing the skill catalog to a retrieval-relevant subset before injection (that would
change prompt-assembly behavior, not just instrumentation, and is a separate design
question about whether skills should be presented full-catalog or top-K like memory).
Replacing or removing `noteSkillCatalogUse`'s file-based counter. Fixing
`evaluator_verdicts` volume (SPEC-03) — this spec only makes the join's left side
non-empty; the right side's scarcity is a separate, already-specified problem. Recording
*actual* skill invocation (i.e., whether the agent's subprocess loaded/executed a given
skill mid-run, as opposed to it being listed as available) — no host-visible signal for
that currently exists in `PiToolExecution`/tool-call logs; adding one would require a
protocol change to the pi subprocess boundary and is a larger effort than this
instrumentation gap.

## Risks / rollback

Additive only: new `recordLearningInjection` calls at an existing, already-executing code
path, wrapped in the same best-effort try/catch already used for `kind='memory'`. Volume
increase to `learning_injections` is bounded by `skillCatalogMaxChars` and run frequency —
size it before shipping by multiplying current run rate by typical catalog size (visible
today via `noteSkillCatalogUse`'s existing per-skill `use_count`). Rollback is reverting
the new stamp block; no schema change, no migration, nothing else reads `kind='skill'`
today so there is no downstream consumer to break by removing it again.
