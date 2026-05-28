# FFT_nano Simplification Spec — Lessons from Hermes-Agent

After completing the streaming simplification (PR #99), we audited FFT_nano's entire architecture against hermes-agent's primitives. Hermes runs 19 platforms with ~200K core lines using flat procedural patterns. FFT_nano runs 2 platforms with ~18K core lines but significantly more abstraction layers.

This document identifies the **top areas where hermes's simpler approach would benefit FFT_nano**, ranked by impact.

---

## Completed: Streaming Layer (PR #99)

**Problem**: 7 interlocking systems (TelegramPreviewRegistry, RunProgressReporter, TelegramToolProgress, HostEventBus routing, index.ts event listener, finalization bridge) to stream progress to users. Hermes does it with 1 class + 1 adapter interface across 19 platforms.

**Solution**: `StreamConsumer` + `PlatformAdapter` pattern in `src/streaming/`. Pi-runner decoupled from hostEventBus. Dead `telegram_preview_requested` handler removed.

**Status**: Merged. 665 tests pass. Net -36 lines from index.ts.

---

## 1. index.ts — The God Object (CRITICAL)

**FFT_nano**: 8,030 lines, 214+ functions, imports 50+ modules. Contains app bootstrap, WhatsApp setup, Telegram setup, group management, permission gate UI, TUI events, chat preferences, onboarding, heartbeat, task scheduling, memory actions, farm state, skill lifecycle, long-run orchestration, evaluator wiring, file delivery, update management, state persistence.

**Hermes**: `gateway/run.py` is large too (~18K lines), BUT it's mostly slash-command handlers (40+). The core routing loop (`_handle_message`) is ~200 lines of flat procedural code.

**The lesson**: Hermes keeps the message handling loop tiny and puts command handlers next to it. FFT_nano mixes orchestration with implementation.

**Recommended split**:

| New module | Lines | Responsibility |
|---|---|---|
| `src/app-bootstrap.ts` | ~300 | Entry point, init sequence, env validation |
| `src/whatsapp-integration.ts` | ~800 | Socket setup, message handling, delivery |
| `src/telegram-integration.ts` | ~1,200 | Bot creation, group approval, settings panels |
| `src/chat-runtime.ts` | ~500 | Run tracking, session management, preferences |
| `src/host-coordination.ts` | ~300 | HostEventBus listeners, TUI emission |
| `src/task-coordination.ts` | ~400 | Scheduler integration, long-run service wiring |
| `src/index.ts` | ~1,500 | Pure orchestration: wire modules, start/stop |

**Impact**: Highest. Every other simplification is harder while index.ts is a monolith.

---

## 2. Message Dispatch + Pipeline — Redundant Dispatch Systems (HIGH)

**FFT_nano**: Two parallel systems:
- `message-dispatch.ts` (1,900 lines) — full monolithic dispatcher with queue logic, finalization, state management
- Pipeline system (5 files, 886 lines) — ChatPipeline, CodingPipeline, CronPipeline with prepare/execute/deliver pattern

Both manage active runs, request IDs, abort controllers, typing indicators, TUI events. 

**Hermes**: One function — `_handle_message()` — classifies, routes, calls agent, delivers. No pipeline abstraction. No separate dispatcher.

**The lesson**: Hermes proves a flat dispatcher works. FFT_nano has TWO dispatchers that partially overlap. 

**Recommendation**: Pick one. The pipeline abstraction is good (clean prepare/execute/deliver), so:
- Migrate all message-dispatch logic INTO the pipeline classes
- message-dispatch.ts becomes a thin router that creates the right pipeline and calls `pipeline.run()`
- Kill the duplication

**Impact**: High — reduces 2,786 lines to ~1,200 and eliminates the "which system handles this?" confusion.

---

## 3. Configuration Fragmentation (HIGH)

**FFT_nano**: 5 config files, 1,896 lines:
- `config.ts` (294 lines) — 50+ exported constants from env vars
- `runtime-config.ts` (321 lines) — provider presets
- `chat-preferences.ts` (496 lines) — per-chat runtime state
- `parity-config.ts` (676 lines) — feature flags from JSON file
- `profile.ts` (109 lines) — FFT_PROFILE detection

**Hermes**: One dataclass (`GatewayConfig`) + one YAML file. No per-chat model overrides. No parity config. No profile detection.

**The lesson**: Hermes has ONE config object. FFT_nano has 5 config sources that all get imported separately everywhere.

**Recommendation**:
- Merge `config.ts` + `runtime-config.ts` + `profile.ts` into a single `AppConfig` class
- Replace 50+ const exports with a typed config object passed via dependency injection
- Keep `chat-preferences.ts` separate (it's runtime state, not config)
- Simplify `parity-config.ts` — 676 lines for reading a JSON file is excessive

**Impact**: High — every file in the codebase imports from these. Unifying them reduces coupling.

---

## 4. IPC Event Type Sprawl (MEDIUM)

**FFT_nano**: `host-events.ts` defines **17 event kinds** with discriminated unions. Each has its own payload type. `processHostEvent` in index.ts has 17 case branches.

**Hermes**: No event bus. Direct function calls. Platform adapters have 3 methods (send, edit, delete).

**The lesson**: The HostEventBus was originally needed for cross-boundary IPC between the pi subprocess and the host. But many of the 17 event kinds are host-internal and don't need pub/sub.

**Recommendation**: Consolidate to ~8 event kinds:
- `telegram_preview_requested` — **already removed** (PR #99)
- `chat_delivery_requested` — keep
- `task_requested` + `action_requested` + `action_result_ready` — merge to `ipc_request`/`ipc_result`
- `file_delivery_requested` + `file_delivery_completed` — merge to `file_transfer`
- `run_lifecycle_changed` + `chat_state_changed` — merge to `run_state`
- `tool_progress` + `run_progress` — already simplified, could merge to `progress`

**Impact**: Medium — reduces cognitive load, simplifies processHostEvent.

---

## 5. Memory Action Gateway (MEDIUM)

**FFT_nano**: 8 files, 2,555 lines for the memory subsystem. `memory-action-gateway.ts` alone is 703 lines mixing action validation, file I/O, schema parsing, and TODOS management.

**Hermes**: SQLite + single memory provider interface. ~500 lines total for session persistence.

**The lesson**: Hermes keeps memory simple — store messages in SQLite, provide FTS5 search. FFT_nano has lexical search, document stores, claim verification, knowledge wiki, action gateways.

**Recommendation**: Not a full simplification — FFT_nano's memory features are genuinely useful. But:
- Split `memory-action-gateway.ts` (703 lines) into: validation (~150), file ops (~200), orchestration (~200)
- Evaluate whether `knowledge-wiki.ts` (430 lines) is a parallel system to memory-backend or can be unified

**Impact**: Medium — reduces the biggest file in the memory subsystem.

---

## What's Already Good (No Changes Needed)

| Area | Files | Lines | Why it's fine |
|---|---|---|---|
| Permission gates | 3 | 294 | Lean, focused, clear single responsibility |
| Evaluator | 1 | 695 | Single file, clear purpose, good boundary |
| Coding orchestrator | 1 | 1,381 | Complex domain justifies the size |
| Streaming (post-PR #99) | 5 | 1,000 | Just simplified — clean adapter + consumer pattern |

---

## Priority Order

1. **Split index.ts** — everything else is harder while it's a monolith
2. **Unify dispatch systems** — message-dispatch + pipelines into one path
3. **Consolidate config** — 5 sources into 1 typed config object
4. **Simplify IPC events** — 17 kinds down to 8
5. **Split memory-action-gateway** — 703 lines into 3 focused files

## Estimated Impact

| Metric | Before | After |
|---|---|---|
| index.ts | 8,030 lines | ~1,500 lines |
| Dispatch systems | 2 (2,786 lines) | 1 (~1,200 lines) |
| Config sources | 5 (1,896 lines) | 2 (~800 lines) |
| IPC event kinds | 17 | ~8 |
| Total core LOC | ~18,274 | ~12,000 |

---

## Future Work: Skill Surface Optimization For Agent Performance

After the host simplification work, the next performance/capability improvement is not adding more tools. It is making the skill and tool surface easier for the agent to route.

**Problem**: Main/admin runs can see both repo runtime skills and personal skills. This is powerful, but it creates overlap:
- Multiple skills can mean "search the web" or "research this".
- Browser/page inspection skills overlap with browser automation skills.
- Personal skills can override repo skills by name, which is useful only when intentional.
- A large always-visible catalog increases routing hesitation and prompt noise.

**Goal**: Keep maximum capability while making the default choice obvious.

### Recommended skill layers

1. **Core repo skills** — always visible, versioned, small:
   - `web-search`
   - `rapid-research`
   - `agent-browser`
   - `fft-debug`
   - `fft-coder-ops`
   - `fft-telegram-ops`
   - `skill-ops`

2. **Repo library skills** — available, but surfaced only when relevant:
   - setup and onboarding skills
   - farm skills when `FFT_PROFILE=farm`
   - dashboard skills when dashboard work is requested
   - autoresearch skills only when explicitly requested

3. **Personal/private skills** — main/admin only:
   - domain-specific integrations
   - media/document workflows
   - writing/design preferences
   - experimental model/tool integrations

The mounted pi skills directory can remain flat for compatibility, but each skill should carry metadata that lets prompt construction rank it:

```yaml
priority: core | library | personal | experimental
scope: global | main-only | farm | web | media | coding
```

### Web capability routing

Make this hierarchy explicit in the system prompt and/or core web skills:

1. Public URL fetch: use `curl` first.
2. Quick search: use `ddgs` via `web-search`.
3. Multi-source synthesis: use `rapid-research`.
4. Interactive website or web app validation: use `agent-browser`.
5. Visual web QA: use `agent-browser` screenshots.
6. Domain-specific recon: use a matching personal/domain skill only after the basic search/browser route is insufficient.

### Duplicate-name policy

Avoid duplicate skill names across repo and personal layers unless the override is deliberate and documented.

Risky examples:
- repo `agent-browser` plus personal `agent-browser`
- repo `rapid-research` plus personal `rapid-research`

Recommended alternatives:
- keep repo `agent-browser`; name personal variants `browser-harness` or `personal-browser-harness`
- keep repo `rapid-research`; name personal variants `research-briefing` or `domain-research`
- if overriding is intended, place it under an obvious personal override convention and document why

### Expected benefit

- Faster skill choice.
- Less prompt noise.
- Fewer accidental overrides.
- Better default behavior for web/search/browser tasks.
- Same maximum capability, but with a smaller always-visible decision surface.
