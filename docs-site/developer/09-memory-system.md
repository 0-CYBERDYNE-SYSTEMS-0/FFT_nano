# Memory System

Primary files:
- `src/memory-paths.ts`
- `src/memory-maintenance.ts`
- `src/memory-retrieval.ts`
- `src/memory-search.ts`
- `src/memory-action-gateway.ts`
- transcript FTS in `src/db.ts`

## Canonical Files

Per group:
- `MEMORY.md` (canonical durable memory)
- `memory/*.md` (additional memory notes)
- `SOUL.md` (identity/policy context, not compaction log store)

Main group workspace:
- by default `~/nano` mounted as `/workspace/group`

Non-main groups:
- `groups/<group-folder>/...`

Global memory:
- `groups/global/MEMORY.md` and `groups/global/memory/*.md`

## Migration Rules

On startup:
- legacy `CLAUDE.md` -> `SOUL.md` migration when needed
- compaction sections (`## Session Compaction ...`) are moved from `SOUL.md` into `MEMORY.md`

Compaction append target:
- `appendCompactionSummaryToMemory(groupFolder, summary, timestamp)`

## Retrieval-Gated Injection

`buildMemoryContext({groupFolder, prompt})`:
1. load chunks from group + global memory docs
2. tokenize prompt tail (chat-log aware stripping)
3. score chunks lexically
4. choose top `MEMORY_TOP_K` within `MEMORY_CONTEXT_CHAR_BUDGET`
5. inject into container input as `memoryContext`

If retrieval is disabled, host sends no injected memory snippets.

## Transcript Episodic Memory (SQLite FTS)

`db.ts` creates `messages_fts` virtual table with triggers syncing `messages` rows.

Search path:
- `searchMessagesByFts(chatJids, query, limit)`
- used by `searchTranscriptMemory` in `memory-search.ts`

Ranking:
- transcript scores transform from FTS `bm25` rank to normalized positive score.

## Memory Search API

`executeMemoryAction` supports:
- `memory_get`: read allowed memory file
- `memory_search`: merge document + session hits and rank

Cross-group rules:
- non-main cannot request another group folder
- main may request explicit `groupFolder`

Path guard:
- allowed paths only:
  - `MEMORY.md` / `memory.md`
  - `memory/<name>.md`
- traversal blocked by workspace-relative resolution checks

## `/compact` Command Behavior

In `src/index.ts`:
1. runs dedicated compaction prompt via model
2. stores summary markdown in `MEMORY.md`
3. sets `nextRunNoContinue=true` so next session starts fresh

Return text includes compaction request id and preview snippet.
