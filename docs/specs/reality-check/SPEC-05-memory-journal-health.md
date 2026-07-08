# SPEC-05 — Memory Journal Health (the corpus is stale, and nothing notices)

**Severity:** SERIOUS · **Type:** code change + operational (ritual) fix · **Status:** Ready for dev

## Problem

The daily-journal / MEMORY.md / canonical-tier maintenance rituals prescribed in
`HEARTBEAT.md` do not execute. Every daily journal file in the live main workspace
(`~/nano/memory/*.md`) is the untouched 149-byte scaffold — zero session notes, zero
decisions, zero open questions have ever been appended. Retrieval still "works" in the
sense that `searchDocumentMemory` returns results, but with the daily corpus empty it has
nothing to serve except two long-lived files, so **2,244 learning-injection events since
2026-06-10 are dominated by exactly two documents**, one of them a five-week-old snapshot.
No host code currently distinguishes "the ritual ran and there was nothing to report" from
"the ritual never ran," so this has been invisible.

## Evidence

- `resolveGroupWorkspaceDir('main')` (`src/memory-paths.ts:143-145`) resolves the main
  group workspace to `~/nano` (`MAIN_WORKSPACE_DIR`) — confirmed live.
- `~/nano/memory/`: **15 dated journal files** (`2026-06-23.md` … `2026-07-07.md`), every
  single one **exactly 149 bytes** — byte-for-byte identical to `buildDailyJournalBody()`
  (`src/memory-paths.ts:180-192`), i.e. 100% pristine, 0% written-to (verified via `wc -c`
  on the live directory, 2026-07-07).
- `~/nano/memory/trash/`: 70 files, real (non-scaffold) content, sizes up to 15,890 bytes —
  proof the compaction ritual worked correctly in the past. **Newest trash mtime is
  2026-06-20** — no compaction has moved a file since, even though `memory/` has held
  15+ files (well over HEARTBEAT.md's ">7" trigger) for the entire window since.
- `~/nano/memory/review-summary-2026-05-30-pass3.md`: 2,541 bytes, last modified 2026-05-30
  — the file `learning_injections` keeps re-serving five weeks later.
- `~/nano/MEMORY.md`: 14 bytes, literal contents `##MEMORY.md\n\n\n` — this matches
  **neither** the pristine scaffold (`DEFAULT_MEMORY_BODY`, `src/memory-paths.ts:73-93`,
  which is a multi-paragraph template) **nor** any plausible curated content. Something
  wrote a broken stub over it at some point; the "MEMORY.md Tier Review" ritual
  (`HEARTBEAT.md:17-18`, live workspace) has not run a proper pass since.
- `~/nano/canonical/`: `_hot.md` (71B), `commitments.md` (62B), `identity.md` (55B) are
  byte-identical to `DEFAULT_CANONICAL_BODIES` and untouched since creation (2026-04-02
  mtime). `constraints.md` (1,058B) and `projects.md` (1,563B) **were** updated
  2026-06-26 — so canonical promotion partially works, just never for `_hot`/
  `commitments`/`identity`.
- **Host-side bug, independently confirmed**: `buildHeartbeatChecklist()`
  (`src/heartbeat-checklist.ts:60-64`) computes `memoryTodayPath` with
  `now.toISOString().slice(0, 10)` — a **UTC** calendar date — while every journal file is
  keyed by **local-timezone** date via `getLocalDateKey()` (`src/time-context.ts:40-43`,
  used by `ensureDailyMemoryJournal`, `src/memory-paths.ts:195-218`). Live `TIMEZONE`
  resolves to `America/Los_Angeles` (`src/app-config.ts:400-401`, confirmed via
  `Intl.DateTimeFormat().resolvedOptions().timeZone`). Direct proof: live checklist
  artifact `~/nano/heartbeat/checks/heartbeat-1783390455029-w2hkm.json` has
  `createdAt: "2026-07-07T02:14:25.624Z"` (= 2026-07-06 19:14 PDT — local date is still
  **July 6**) but checked `memoryToday.path` = `.../memory/2026-07-07.md` (the *next*
  local day) and reported `"exists": false` — while `memory/2026-07-06.md` (the correct
  file for that moment) already existed on disk. The one host-side journal-presence check
  that exists is wrong for roughly 7-8 hours of every day.
- `searchDocumentMemory`'s ranking (`src/memory-search.ts:295-377`) has **no recency
  factor at all**. `lexicalScore()` (line 177-202) is pure token-overlap/density, and
  `pathBonus` (line 315-328) is a static per-path-type constant (`memory/` = +0.08,
  `MEMORY.md` = +0.12, `canonical/*` = +0.18 to +0.5) with no decay by file age. A long,
  keyword-dense one-off file competes on equal footing with today's journal forever —
  and since the journals are empty, there is currently nothing to compete *with*.

## Root cause

Two independent problems, one host-code and testable, one agent/ritual and only
artifact-verifiable — they must not be conflated:

1. **Host-code bug (testable):** `heartbeat-checklist.ts`'s `memoryToday` check uses UTC
   date math instead of the same local-tz key every other part of the system uses. This
   makes the only automated journal-presence signal unreliable, so even if the ritual
   fixes below land, nothing yet correctly measures compliance.
2. **Ritual non-compliance (agent-side, not host-fixable by tests):** writing to
   `memory/YYYY-MM-DD.md`, promoting to `canonical/*.md`, and tiering `MEMORY.md` are, by
   design (`NANO.md` memory policy, `src/memory-paths.ts:16-42`), exclusively agent
   responsibilities — the host only ever scaffolds the empty template
   (`ensureDailyMemoryJournal`, `src/memory-paths.ts:195-218`) and never appends content
   itself. `HEARTBEAT.md` prescribes the compaction/tier-review/promotion rituals
   correctly, but they stopped executing around 2026-06-20 (last trash move) even though
   heartbeat itself keeps reporting `HEARTBEAT_OK`. The host has no way to *make* the
   agent comply — it can only be made to *notice and count* noncompliance, which today it
   does not do at all (`memoryToday.exists` is the only signal, and it's broken per #1).

The monoculture in `learning_injections` is a downstream symptom of #2 (nothing else to
retrieve) compounded by the ranking gap in `memory-search.ts` (no recency decay, no
per-source diversity cap) — even once journals start getting written again, a five-week
snapshot with equal lexical score to today's entry would keep winning indefinitely.

## Fix

### A — Host-code, testable

1. **Fix the timezone bug** in `src/heartbeat-checklist.ts`: compute `memoryTodayPath`
   using `getLocalDateKey(now, getEffectiveTimezone())` (same helpers `memory-paths.ts`
   already uses), not `now.toISOString().slice(0, 10)`.
2. **Detect pristine-vs-written, not just exists/missing.** Add
   `isJournalScaffoldContent(dateKey: string, content: string): boolean` to
   `src/memory-paths.ts`, mirroring the existing `isCanonicalScaffoldContent()`
   (line 289-296): compare trimmed content to `buildDailyJournalBody(dateKey)` (export it,
   currently module-private). Extend `HeartbeatChecklistResult.checks.memoryToday` with a
   `writtenToday: boolean` field (`exists && !isJournalScaffoldContent(...)`).
3. **Count consecutive pristine days.** Persist a simple counter (same pattern as
   SPEC-02's drop counter — a small JSON/state field, no DB migration) that increments
   when `writtenToday` is false and resets on true. Surface the count on the checklist
   result so SPEC-07's heartbeat alert tiering (or a SPEC-02-style witness) has something
   concrete to escalate on — this spec only makes the fact observable, it does not
   duplicate SPEC-07's alerting mechanics.
4. **Recency-aware ranking** in `src/memory-search.ts`: for chunks whose `relPath` matches
   `memory/YYYY-MM-DD.md`, derive an age-in-days from the filename and apply a multiplicative
   decay to the combined score (e.g. `1 / (1 + age_days / 30)`) so a 35-day-old journal
   entry scores meaningfully lower than an equally keyword-dense fresh one. Files outside
   that naming pattern (canonical/*, MEMORY.md) are unaffected — this only corrects the
   one location the current audit shows dominating retrieval.
5. **Anti-monoculture cap** in `mergeAndRankMemoryHits()` (`src/memory-search.ts:409-416`):
   when truncating to `topK`, cap the number of hits contributed by any single `relPath`
   to `Math.max(1, Math.ceil(topK / 2))` before backfilling from the remaining pool, so one
   file cannot structurally occupy the entire result set when other relevant content exists.

### B — Ritual / prompt fix (verifiable via artifacts only, not unit-testable)

6. `HEARTBEAT.md` (live workspace file, `~/nano/HEARTBEAT.md` — edited operationally, not
   part of this repo) already states the compaction/tier-review/promotion rituals
   correctly; the fix here is to make the host's new `writtenToday` /
   `consecutivePristineDays` signal (A2/A3) part of the heartbeat run's own injected
   context, so the agent is shown "journal not written N days running" as a fact rather
   than being expected to infer it. This closes the loop between what the host now
   observes and what the agent is told, without the host ever writing journal/MEMORY.md
   content itself (that responsibility stays with the agent by design). Acceptance for
   this half of the fix is artifact-based: after deployment, successive
   `~/nano/heartbeat/checks/*.json` files should show `writtenToday: true` on days with
   real activity, and `~/nano/memory/` file count should trend back toward the ≤7 the
   ritual targets.

## TDD plan

Test file: `tests/memory-journal-health.test.ts` (new).

1. RED: `isJournalScaffoldContent('2026-07-07', buildDailyJournalBody('2026-07-07'))` →
   `true`; the same content with one appended bullet under `## Session Notes` → `false`.
2. RED: build a heartbeat checklist with `now` set to `2026-07-06T19:14:00-07:00` (11:14pm
   UTC-equivalent, local date still July 6) and a fixture journal file only at
   `memory/2026-07-06.md` — assert `checks.memoryToday.path` ends in `2026-07-06.md` (not
   `2026-07-07.md`) and `exists: true`. Repeat with only the scaffold template written →
   `writtenToday: false`.
3. RED: consecutive-pristine counter — feed 3 pristine days in a row → counter reads 3;
   a written day resets it to 0.
4. RED: `searchDocumentMemory` recency — two fixture chunks with identical raw
   lexical+path score, one from `memory/2026-05-30-x.md` (35+ days old relative to a fixed
   `now`), one from `memory/<today>.md` → the fresher chunk ranks first.
5. RED: `mergeAndRankMemoryHits` diversity cap — 10 hits from one `relPath` and 2 from
   another, `topK=6` → merged result contains at most `ceil(6/2)=3` hits from the
   dominant path when the other path has qualifying candidates.
6. GREEN: implement; `npm run typecheck && npm test` clean.

## Acceptance criteria

- [ ] `heartbeat-checklist.ts` resolves `memoryTodayPath` via local-tz key; test 2 green.
- [ ] `isJournalScaffoldContent` correctly distinguishes scaffold from written content;
      test 1 green.
- [ ] Checklist result exposes `writtenToday` and a consecutive-pristine-day count; test 3
      green.
- [ ] `searchDocumentMemory` applies recency decay to `memory/YYYY-MM-DD.md` chunks; test 4
      green.
- [ ] `mergeAndRankMemoryHits` caps single-path dominance in merged top-K; test 5 green.
- [ ] (Operational, artifact-verified, not a unit test) Within 7 days of deploying A + the
      HEARTBEAT.md context-injection change, at least one live
      `~/nano/heartbeat/checks/*.json` shows `writtenToday: true` and `~/nano/memory/`
      file count has decreased from its pre-fix high via real compaction (not manual
      cleanup).

## Files

`src/memory-paths.ts`, `src/heartbeat-checklist.ts`, `src/memory-search.ts`,
`tests/memory-journal-health.test.ts`. Operational-only (live workspace, not this repo,
no test coverage possible): `~/nano/HEARTBEAT.md` context-injection wording.

## Out of scope

Making the host write journal/MEMORY.md/canonical content itself (rejected — breaks the
existing agent-curates/host-observes separation `NANO.md` establishes; also see SPEC-07 for
heartbeat failure/alert-tier mechanics, which this spec deliberately does not duplicate).
Repairing the already-corrupted `MEMORY.md` stub content (an operational one-time cleanup,
not a code change — track separately; consider extending `src/skill-history.ts`-style
versioning to `MEMORY.md` in a future spec so a destructive rewrite like this one is
reversible).

## Risks / rollback

All host-code changes are additive (new checklist fields, new ranking factor, new cap) and
degrade to prior behavior if reverted. The recency decay and diversity cap change ranking
order for `searchDocumentMemory`/`mergeAndRankMemoryHits` callers — covered by existing
`memory-retrieval.test.ts` / `memory-maintenance.test.ts` regression suites, run those
alongside the new file. Rollback = revert commit; no schema or on-disk format changes.
