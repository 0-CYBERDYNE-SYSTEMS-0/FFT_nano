# Generalized Subagent System

## Objective

Build a type-registered, configurable subagent system that runs alongside (not replacing) the existing `/coder` system. Seven registered subagent types (eval, nightly-analyst, photo-analyst, researcher, compliance-auditor, data-sync, general) each with fixed tool sets, workspace modes, prompt templates, timeouts, and result delivery options. The `/coder` command remains completely untouched.

## Architecture Overview

```
/coder, /coder-plan, auto-detect  →  CodingOrchestrator (unchanged)
/subagents spawn <type> <task>   →  SubagentOrchestrator (new)
cron jobs                        →  SubagentOrchestrator (new, optional)
main agent delegation            →  SubagentOrchestrator (new, optional)

Both use runContainerAgent() as the underlying primitive.
Both track runs in activeCoderRuns (shared Map).
```

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Separate from CodingOrchestrator | Yes, new module | `/coder` works, don't touch it |
| Type registry | Static config in subagent-types.ts | Explicit, auditable, no dynamic types |
| Prompt templates | Markdown files in config/subagent-prompts/ | Iteratable without code changes |
| Fire-and-forget | Supported via `blocking: false` | Nightly analyst, data-sync need this |
| Result delivery | chat, file, or none | Per-type configurable |
| Model selection | Always main model (Phase 1) | No cheaper models until tested/verified |
| Cron integration | New cron task type `subagent` | Cron can spawn typed subagents |
| Workspace modes | worktree, path, none | Per-type, not hardcoded to worktree |

## Implementation Plan

### Phase 1: Subagent Type Registry

- [ ] Create `src/subagent-types.ts` with `SubagentTypeConfig` interface and the 7 registered types (eval, nightly-analyst, photo-analyst, researcher, compliance-auditor, data-sync, general). Each type defines: label, tools, workspaceMode, promptTemplate, timeout, resultDelivery, blocking, description. Export `SUBAGENT_TYPE_REGISTRY` Map and `getSubagentType(name)` resolver.

### Phase 2: Prompt Templates

- [ ] Create `config/subagent-prompts/` directory with markdown prompt templates for each type:
  - [ ] `eval.md` -- "You are evaluating a skill. Read SKILL.md, follow its instructions against test prompts, report structured results."
  - [ ] `nightly-analyst.md` -- "You are the nightly farm analyst. Review telemetry, weather data, observations from the past 24 hours. Update crop stages, refine thresholds, generate morning briefing."
  - [ ] `photo-analyst.md` -- "You are a crop diagnostic specialist. Analyze the provided image for pests, diseases, nutrient deficiencies."
  - [ ] `researcher.md` -- "You are an agricultural research assistant. Search for information, summarize findings."
  - [ ] `compliance-auditor.md` -- "You are a compliance auditor. Review spray logs, check for gaps against NOP/GAP requirements."
  - [ ] `data-sync.md` -- "You are a data synchronization agent. Fetch data from external APIs and write to farm-state/."
  - [ ] `general.md` -- "You are a general-purpose task worker. Complete the assigned task."
- [ ] Create `src/subagent-prompts.ts` with `loadSubagentPrompt(typeName)` that reads the markdown file and returns the prompt string. Fallback to a minimal default if file not found.

### Phase 3: Subagent Orchestrator

- [ ] Create `src/subagent-orchestrator.ts` with `SubagentOrchestrator` class:
  - [ ] Constructor takes `SubagentOrchestratorDeps` (activeRuns Map, runContainerAgent, publishEvent, sendChatMessage)
  - [ ] `spawnSubagent(request)` method that:
    - Resolves type config from registry
    - Validates request (type exists, tools are subset of allowed, etc.)
    - Creates `ActiveCodingRunState` entry in shared `activeCoderRuns` Map
    - Resolves workspace based on type's `workspaceMode` (worktree, path, none)
    - Loads prompt template and constructs full prompt with task context
    - Builds `ContainerInput` with type-appropriate settings (toolMode, workspaceDirOverride, isSubagent, noContinue, timeout)
    - Calls `runContainerAgent()` with constructed input
    - Handles result delivery based on type config (chat message, file write, or silent)
    - For fire-and-forget (`blocking: false`): returns immediately with tracking ID, result delivered async
    - For blocking (`blocking: true`): awaits result and returns it
    - Publishes host events (run_started, run_finished, run_aborted) consistent with coding orchestrator
    - Cleans up active run on completion (finally block)
  - [ ] `abortSubagent(requestId)` method
  - [ ] `listActiveRuns()` method
  - [ ] `resolveWorkspace(typeConfig, request)` helper that handles:
    - `worktree` mode: creates ephemeral worktree (reuse `createDefaultEphemeralWorktree` from coding-orchestrator)
    - `path` mode: resolves to a specified directory (e.g., skill dir, farm-state dir)
    - `none` mode: uses default group workspace

### Phase 4: CLI Integration -- Extend /subagents

- [ ] Extend `src/telegram-commands.ts` `/subagents spawn` handler to support typed spawning:
  - [ ] Parse `/subagents spawn <type> <task>` where `<type>` is the subagent type name
  - [ ] Validate type exists in registry, show available types if not recognized
  - [ ] Show type description and workspace mode in "Starting subagent run..." confirmation message
  - [ ] For blocking types: await result and deliver (existing behavior)
  - [ ] For fire-and-forget types: return immediately with tracking ID, deliver result when complete
  - [ ] Add `/subagents types` subcommand that lists all registered types with descriptions
- [ ] Extend `/subagents list` output to show subagent type alongside existing metadata (mode, state, age, etc.)
- [ ] Add type-specific help text when user runs `/subagents spawn` without arguments

### Phase 5: Cron Integration

- [ ] Extend `src/cron/types.ts` to add `subagent` as a new task execution kind (alongside existing `agent` kind)
- [ ] Extend `src/cron/service.ts` to support spawning subagents from cron:
  - [ ] When task has `execution_kind: 'subagent'`, call `subagentOrchestrator.spawnSubagent()` instead of `runContainerAgent()`
  - [ ] Pass subagent type and task from cron task definition
  - [ ] Result delivery follows the type's config (file for nightly-analyst, announce for others)
- [ ] Add cron task creation helper that makes it easy to schedule subagent runs (e.g., nightly analyst at 2am)

### Phase 6: Wiring in index.ts

- [ ] Create `SubagentOrchestrator` instance in `src/index.ts` alongside existing `CodingOrchestrator`
- [ ] Wire dependencies: activeRuns (shared Map), runContainerAgent, publishEvent, sendChatMessage
- [ ] Expose `runSubagent` and `abortSubagent` through the deps object for telegram-commands and cron access
- [ ] Add host event bus subscriber for fire-and-forget result delivery (when async subagent completes, deliver result to chat)

### Phase 7: Testing

- [ ] Create `tests/subagent-types.test.ts`:
  - [ ] All 7 types are registered with required fields
  - [ ] `getSubagentType()` returns correct config for valid names
  - [ ] `getSubagentType()` returns null for unknown names
  - [ ] Each type has valid tools list (subset of known pi tools)
  - [ ] Each type has valid workspaceMode
  - [ ] Each type has valid resultDelivery
  - [ ] General type has all tools enabled
  - [ ] Eval type has read-only tools only
- [ ] Create `tests/subagent-orchestrator.test.ts`:
  - [ ] Spawn with valid type returns result
  - [ ] Spawn with unknown type throws error
  - [ ] Spawn creates entry in activeRuns
  - [ ] Spawn removes entry from activeRuns on completion
  - [ ] Spawn removes entry on error
  - [ ] Abort sets state to aborted
  - [ ] Fire-and-forget returns immediately with tracking ID
  - [ ] Blocking awaits result
  - [ ] Result delivery to chat (mock)
  - [ ] Result delivery to file (mock)
- [ ] Create `tests/subagent-prompts.test.ts`:
  - [ ] Each type has a corresponding prompt template file
  - [ ] `loadSubagentPrompt()` returns non-empty string for each type
  - [ ] `loadSubagentPrompt()` returns fallback for missing file

### Phase 8: Documentation

- [ ] Update `AGENTS.md` with subagent types section: list all 7 types, their purpose, tools, workspace mode, and when they're used
- [ ] Update `CLAUDE.md` with subagent architecture notes for AI agents working on the codebase

## Verification Criteria

- All existing 309 tests continue to pass (zero regressions)
- `/coder` and `/coder-plan` work exactly as before (untouched)
- `/subagents spawn eval <skill-name>` spawns a read-only eval subagent
- `/subagents spawn general <task>` spawns a full-tool general subagent
- `/subagents types` lists all 7 registered types
- `/subagents list` shows type alongside existing metadata
- Fire-and-forget subagents complete and deliver results without blocking chat
- Cron can schedule a nightly-analyst subagent run
- Typecheck, build, secret-scan all clean

## Potential Risks and Mitigations

1. **Shared activeCoderRuns Map**: Both CodingOrchestrator and SubagentOrchestrator write to the same Map. Mitigation: use prefixed requestIds (`coder-` vs `subagent-`) to avoid collisions. The existing `/subagents list` and `/subagents stop` already work on any entry in the Map regardless of origin.

2. **Worktree cleanup for non-coding types**: Eval and researcher types don't need worktrees. Mitigation: `workspaceMode: 'none'` skips worktree creation entirely. Only `worktree` mode creates ephemeral worktrees.

3. **Fire-and-forget result delivery after chat context is gone**: User may have sent other messages by the time a background subagent completes. Mitigation: deliver as a new message (not a reply), clearly labeled with the subagent type and task description.

4. **Prompt template loading failure**: If a template file is missing, the subagent gets a generic prompt. Mitigation: `loadSubagentPrompt()` falls back to a minimal default that includes the type name and task. Log a warning.

5. **Cron subagent spawning during service restart**: If a cron-triggered subagent is running when the service restarts, it will be killed. Mitigation: this is existing behavior for all cron tasks. The subagent's work (if any) is lost. For the nightly analyst, this is acceptable since it will run again the next night.

## Files to Create

| File | Purpose |
|---|---|
| `src/subagent-types.ts` | Type registry with 7 configs |
| `src/subagent-prompts.ts` | Prompt template loader |
| `src/subagent-orchestrator.ts` | Spawn/abort/list orchestrator |
| `config/subagent-prompts/eval.md` | Eval prompt template |
| `config/subagent-prompts/nightly-analyst.md` | Nightly analyst prompt template |
| `config/subagent-prompts/photo-analyst.md` | Photo analyst prompt template |
| `config/subagent-prompts/researcher.md` | Researcher prompt template |
| `config/subagent-prompts/compliance-auditor.md` | Compliance auditor prompt template |
| `config/subagent-prompts/data-sync.md` | Data sync prompt template |
| `config/subagent-prompts/general.md` | General purpose prompt template |
| `tests/subagent-types.test.ts` | Type registry tests |
| `tests/subagent-orchestrator.test.ts` | Orchestrator tests |
| `tests/subagent-prompts.test.ts` | Prompt loader tests |

## Files to Modify

| File | Change |
|---|---|
| `src/telegram-commands.ts` | Extend `/subagents spawn` for typed spawning, add `/subagents types` |
| `src/cron/types.ts` | Add `subagent` execution kind |
| `src/cron/service.ts` | Support subagent spawning from cron |
| `src/index.ts` | Create SubagentOrchestrator, wire deps |
| `AGENTS.md` | Document subagent types |
| `CLAUDE.md` | Architecture notes |

## Files NOT Modified

| File | Why |
|---|---|
| `src/coding-orchestrator.ts` | `/coder` stays untouched |
| `src/coding-delegation.ts` | `/coder` detection stays untouched |
| `src/message-dispatch.ts` | Coding auto-detection stays untouched |
| `src/pi-runner.ts` | Already has all needed primitives |
| `src/extensions/fft-permission-gate.ts` | Already handles isSubagent |
