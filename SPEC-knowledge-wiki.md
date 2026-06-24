# SPEC — Full-Spectrum Knowledge Base / Wiki Realignment

Follow-up to `e7fb0f3` ("realign knowledge/ as a Karpathy-style source library").
That commit fixed the **instructions** (schema templates, librarian prompts, system
prompt) but did not fix the **already-bootstrapped data** or the **starved intake
engine**. This spec finishes the job.

> Note: the repo's existing `SPEC.md` is an unrelated Hermes-simplification document
> and is intentionally left untouched. This is a separate, focused spec.

---

## 1. Problem

`e7fb0f3` redefined `knowledge/` as a Karpathy-style source library — pages describe
what the agent has *read* (operator-curated sources in `knowledge/raw/`), with
frontmatter, per-claim `[raw/...]` citations, contradictions, and cross-references.
The agent's own working memory lives elsewhere (`canonical/`, `MEMORY.md`,
`memory/YYYY-MM-DD.md`).

But three gaps remain, and together they mean the fix is currently cosmetic on the
live system:

1. **The new templates never reach existing workspaces.** `writeFileIfMissing`
   (`src/knowledge-wiki.ts:185`) uses `flag: 'wx'` and returns early if the file
   exists. `ensureKnowledgeWikiScaffold` only ever creates *missing* files. Every
   already-bootstrapped workspace keeps its old `README.md` and `qualia-schema.md`
   forever.

2. **The existing wiki content is memory-shaped, not source-shaped.** It was written
   under the old schema and old prompts and must be triaged, not just reformatted.

3. **The intake pipe is starved.** `knowledge/raw/` is empty of live captures, so the
   nightly librarian had nothing legitimate to integrate and instead curated the
   agent's own context into wiki pages — the exact failure mode `e7fb0f3` forbade
   going forward, but which already happened ~2 months deep.

## 2. Root cause

The deepest cause is documented in the source material itself
(`raw/_archived/2026-05-03_karpathy-llm-wiki.md`):

> "Our intake pipe was disconnected — raw/ never got written to despite curation
> logic being correct. The missing piece is active ingestion where sources touch
> 10-15 wiki pages each."

The curation logic was correct; the **ingestion** half of the loop (source → `raw/`)
was never wired to anything that actually fills `raw/`. With no raw sources, a nightly
"curate from raw/" job degenerates into "curate from whatever's in context" = memory.
`e7fb0f3` closed the instruction loophole but left the engine without fuel and left
two months of memory-shaped pages in place.

## 3. Current-state evidence

Captured from the live main workspace `~/nano/knowledge` on 2026-06-23:

| Signal | Value |
|---|---|
| `schema/qualia-schema.md` | still old `# Qualia Schema` (Scope/Facts/Decisions/Open Questions/Sources) |
| `README.md` | still old wording ("maintain high-signal operational knowledge") |
| `wiki/*.md` pages | 21 |
| `raw/*.md` live captures | 0 (48 sit in `raw/_archived/`) |
| Representative pages | `agent-honesty-protocol.md`, `skill-creation-discipline.md` — agent self-reflection / operator corrections = memory, not read sources |
| Other live workspaces with `knowledge/` | none under `~/fft_nano/groups/*` (scope is contained to `~/nano`) |

The shallow lint (`runKnowledgeWikiLint`, `src/knowledge-wiki.ts:418`) only checks
path existence, `wikiDocCount >= 3`, `rawCaptureCount > 0`, and progress freshness. It
cannot detect schema drift, memory-shaped content, missing frontmatter, or uncited
claims, so it reports the misaligned wiki as healthy.

## 4. Goals

1. Existing workspaces converge on the new (v2) scaffold files without destroying
   curated content.
2. The 21 existing wiki pages are triaged: source-derived pages reformatted to the v2
   schema; memory-shaped pages relocated out of `knowledge/`.
3. The raw-intake half of the loop is reconnected so `raw/` is the only thing the
   librarian ever curates from.
4. Lint is hardened to detect drift the current lint misses, so this class of
   regression is caught automatically next time.
5. A scaffold version stamp exists so future template changes propagate (or are at
   least detectable) instead of silently going stale on existing workspaces.

## Non-goals

- No change to where memory lives (`canonical/`, `MEMORY.md`, `memory/`) — only to
  what wrongly leaked into `knowledge/`.
- No automated LLM rewrite of page bodies in this spec. Page-body reformatting is a
  librarian (agent) task driven by the now-correct prompts; this spec wires the
  mechanics and does the triage routing, not the prose.
- No deletion of `raw/_archived/` — those 48 captures are the legitimate source
  corpus to re-ingest from.

---

## 5. Work items

Ordered by dependency. Each has explicit acceptance criteria.

### W1 — Scaffold version stamp + non-destructive upgrade path (CRITICAL)

**Why first:** without this, every later fix to templates repeats gap #1.

- Add a `SCAFFOLD_VERSION` constant in `src/knowledge-wiki.ts` and write it into a
  small `knowledge/.scaffold-version` (or frontmatter line in `README.md`).
- Add an `upgradeKnowledgeWikiScaffold({ workspaceDir })` that, when the stamped
  version is behind `SCAFFOLD_VERSION`, rewrites **only the operator-owned static
  files** (`README.md`, `schema/qualia-schema.md`, and the index *header* above the
  `## Pages` line) to the current templates, backing up the prior file to
  `knowledge/reports/migration-<ts>/` before overwrite.
- `ensureKnowledgeWikiScaffold` stays create-only (unchanged contract). Upgrade is a
  distinct, explicit call.

**Acceptance:** on a workspace seeded with old templates, `upgradeKnowledgeWikiScaffold`
replaces the three static files with v2 content, leaves all `wiki/*.md` page bodies
untouched, writes backups, and stamps the new version. Re-running is a no-op.

### W2 — Wiki page triage routing (CRITICAL)

Classify each of the 21 pages into one of:

- **Source-derived** (summarizes an external article/repo/doc) → keep in `knowledge/wiki/`,
  flag for librarian reformat to v2 schema.
- **Memory-shaped** (agent self-reflection, operator corrections, internal incidents,
  business/ops plans) → move out of `knowledge/`. Target by content:
  - operator/agent behavior protocols → `memory/` or `canonical/constraints.md`
  - campaign/deal/ops plans → `projects/` or `canonical/projects.md`
- **Ambiguous** → list for operator decision; do not move silently.

Deliver as a triage manifest (`knowledge/reports/triage-<ts>.md`) listing each page,
its classification, evidence, and proposed destination — *then* execute moves only for
the unambiguous categories. Cross-link updates in `index.md` follow each move.

**Acceptance:** manifest covers all 21 pages; every non-ambiguous move is executed with
`index.md` updated and no dangling links; ambiguous pages are surfaced for the operator,
not moved.

### W3 — Reconnect raw intake (HIGH)

The curation logic is correct; ingestion is missing.

- Audit callers of `captureKnowledgeRawNote` (`src/knowledge-wiki.ts:375`). Confirm
  what (if anything) is supposed to write `raw/` and why it never fires.
- Wire a real ingestion path: at minimum a `/capture` (or equivalent) operator action
  and/or the web/research skills writing their fetched sources into `raw/` as immutable
  captures, mirroring the `2026-05-03_karpathy-llm-wiki.md` format.
- Seed the loop by moving (or symlinking) the legitimate `raw/_archived/*` captures back
  into active `raw/` for re-ingestion, or pointing the librarian at `_archived/` for the
  first reconciliation pass.

**Acceptance:** there is a documented, exercised path by which an external source lands
in `knowledge/raw/` as an immutable capture; a nightly/manual librarian run integrates
at least one archived capture into a v2-schema page with `[raw/...]` citations.

### W4 — Harden the lint (HIGH)

Extend `runKnowledgeWikiLint` to validate v2 conformance so drift can't pass silently:

- README/schema match (or are not behind) the current `SCAFFOLD_VERSION`.
- Each `wiki/*.md` page (excluding `index/progress/log`) has required v2 frontmatter
  (`type`, `sources`, `updated`, `confidence`, `tags`).
- Each page has a `## Sources` section and at least one `[raw/...]` citation, OR is
  explicitly flagged as un-migrated.
- Warn on memory-style heading vocabulary (`## Decisions`, `## Open Questions` as
  top-level sections) — the same signal the new tests pin.

Keep it warnings-not-errors for legacy pages during migration; promote to errors once
W2 completes.

**Acceptance:** running lint on the pre-migration wiki produces specific warnings naming
the non-conforming pages; running it post-migration on a correctly reformatted page is
clean.

### W5 — Tests (MEDIUM)

- `upgradeKnowledgeWikiScaffold` upgrades old → v2 static files, preserves page bodies,
  writes backups, is idempotent (W1).
- Lint flags missing frontmatter / missing citations / memory-style headings, and
  passes a conformant fixture (W4).
- Extend the existing pinning tests in `tests/knowledge-wiki.test.ts` to cover the
  version stamp.

**Acceptance:** new tests pass; existing 26 targeted tests still pass; `npm run typecheck`
clean.

---

## 6. Migration runbook (live `~/nano`)

Mechanical execution after W1–W4 land and build on `dev`:

1. Back up `~/nano/knowledge` (`cp -a` to a timestamped dir).
2. Run `upgradeKnowledgeWikiScaffold` against `~/nano` (W1) — static files to v2.
3. Generate the triage manifest (W2), review, execute unambiguous moves, surface
   ambiguous pages to the operator.
4. Reconnect intake and re-ingest archived captures (W3).
5. Run hardened lint (W4); confirm warnings now point only at pages pending librarian
   reformat.
6. Let one nightly (or manual `/librarian`) pass reformat the source-derived pages.
7. Re-lint; expect clean.

## 7. Priority order

1. **W1** scaffold version + upgrade path — unblocks everything; stops the gap recurring.
2. **W2** page triage — removes the memory-shaped content the fix was about.
3. **W3** reconnect intake — refuels the engine so the loop is real, not cosmetic.
4. **W4** harden lint — makes the realignment self-policing.
5. **W5** tests — locks it.

## 8. Definition of done

- New workspaces scaffold to v2 (already true via `e7fb0f3`).
- Existing workspaces upgrade to v2 static files non-destructively, with backups.
- `~/nano` wiki contains only source-derived pages; memory-shaped content relocated.
- `raw/` has a live, exercised ingestion path; at least one capture re-ingested.
- Lint detects schema/citation/memory-shape drift and reports the live wiki clean
  post-migration.
- Tests green; typecheck clean.
