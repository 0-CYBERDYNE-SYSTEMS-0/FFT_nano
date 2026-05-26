# FFT_nano Simplification — Handoff Document

**Branch:** `feat/fft-simplification-spec`  
**Spec:** `SPEC.md`  
**Status as of handoff:** Milestones 1 (partial), 3 (done), 5 (done). Milestones 2 and 4 not started.  
**Tests:** 665 pass, 0 fail  
**Typecheck:** Clean

---

## What Was Done

### Milestone 5 — COMPLETE ✅
`memory-action-gateway.ts` split from 703 lines into 3 focused files:
- `src/memory-action-validation.ts` (121 lines) — Zod schema, path guards, string helpers
- `src/memory-action-io.ts` (336 lines) — all file read/write, section manipulation, mutation functions
- `src/memory-action-gateway.ts` (181 lines) — orchestration only; `executeMemoryAction` export unchanged

### Milestone 3 — COMPLETE ✅
Config consolidated from 5 sources:
- `src/app-config.ts` (256 lines) — new canonical home: profile detection + all env-var constants
- `src/config.ts` (60 lines) — re-export stub; all existing imports still work unchanged
- `src/parity-config.ts` (400 lines, was 676) — condensed; `PARITY_CONFIG` and `PARITY_CONFIG_PATH` exports unchanged
- `src/profile.ts` (109 lines) — **kept separate** (tests use cache-busting dynamic imports that would break if turned into a re-export stub)
- `src/runtime-config.ts` (321 lines) — untouched per spec

### Milestone 1 — PARTIAL ⚠️
**Target:** index.ts ~1,500 lines. **Current:** 3,039 lines (was 8,030).

New modules extracted and **fully wired** (index.ts delegates to them via thin wrappers):

| Module | Lines | What it contains |
|---|---|---|
| `src/host-coordination.ts` | ~1,094 | `processHostEvent`, `startIpcWatcher`, `processTaskIpc`, `deliverRuntimeAgentMessage`, Telegram stream state helpers |
| `src/heartbeat-service.ts` | ~434 | `runHeartbeatTurn`, `startHeartbeatLoop`, `stopHeartbeatLoop`, `requestHeartbeatNow`, heartbeat config constants |
| `src/update-service.ts` | ~91 | `processPendingUpdateNotifications`, `startUpdateNotificationLoop`, `stopUpdateNotificationLoop` |
| `src/tui-coordination.ts` | ~340 | `emitTuiChatEvent/AgentEvent/ToolEvent`, `buildTuiSessionList`, `getTuiSessionHistory`, `createTuiGatewayAdapters`, `startTuiGatewayService`, `stopTuiGatewayService` |
| `src/web-control-center.ts` | ~600 | `getControlCenter*`, `createWebControlCenterAdapters`, `startWebControlCenterService`, `stopWebControlCenterService` |
| `src/state-persistence.ts` | ~388 | `loadState`, `saveState`, `registerGroup`, `syncGroupMetadata`, `getAvailableGroups`, migrations, `writeJsonAtomic` |
| `src/telegram-group-mgmt.ts` | ~631 | Telegram group approval flow, `approveTelegramGroup`, `promoteChatToMain`, `findMainTelegramChatJid`, group panels |
| `src/agent-runner.ts` | ~905 | `runAgent`, `runCodingTask`, `runCompactionForChat`, `getCodingOrchestrator`, continuity ledger |
| `src/skill-service.ts` | ~545 | `handleSkillManagerCommand`, `handleLibrarianCommand`, `maybeRunSkillManager`, `maybeRunSkillSelfImprovement` |

Two modules extracted **but NOT yet wired** — their functions are imported as `td*`/`ts*` aliases in index.ts but the original full implementations are still in index.ts too:

| Module | Lines | Status |
|---|---|---|
| `src/telegram-delivery.ts` | ~1,030 | Created; `td*` aliases imported in index.ts; **originals not removed** |
| `src/telegram-settings.ts` | ~1,660 | Created; `ts*` aliases imported in index.ts; **originals not removed** |

---

## Remaining Work — Ordered by Priority

---

### 1. Finish Milestone 1: Wire telegram-delivery.ts and telegram-settings.ts

**This is the most urgent item.** ~1,500 lines of dead duplicate code sit in index.ts.

**What exists:**
- `src/telegram-delivery.ts` exports: `sendMessage`, `sendTelegramAgentReply`, `sendAgentResultMessage`, tool progress functions, `sanitizeFileName`, `defaultExtensionForMedia`, `persistTelegramMedia`, `refreshTelegramCommandMenus`, `logTelegramCommandAudit`, `handlePermissionGateRequest`, `handleTelegramCallbackQuery`, `formatStatusText` (with `FormatStatusDeps` parameter), `summarizeTask`, `formatTaskRunsText`, `formatTasksText`, `runGatewayServiceCommand`, `resolveKnowledgeRuntimeSnapshot`, `handleKnowledgeCommand`
- `src/telegram-settings.ts` exports: all `build*Panel` functions, `runPiListModels`, `loadPiModels`, model validation helpers, `getRuntimeConfigEnv`, `getRuntimeConfigSummaryLines`, `buildOnboardingStatus`, `applyWebOnboardingConfig`, `persistRuntimeConfigUpdates`, setup input state functions, all settings panel builders

**Current state in index.ts:**
- All functions listed above are imported under `td*` / `ts*` aliases at the top
- But their **full original bodies are still defined in index.ts** (e.g., `sendMessage` at line 2689, `sendTelegramAgentReply` at line 2592, etc.)

**What needs to happen:**
1. For each function in `telegram-delivery.ts` and `telegram-settings.ts`:
   - Find the full body in index.ts
   - **Delete it** (or replace with a 1-line wrapper delegating to `td*`/`ts*`)
   - Ensure all call sites in index.ts use either the function name directly (if it's not being renamed) or the `td*` alias
2. Important: `formatStatusText` signature changed — it now takes a `FormatStatusDeps` object as second argument. Search all call sites in index.ts and supply the deps.
3. Run `npm run typecheck` after each deletion to catch broken call sites
4. Run `npm test` when done — must be 665 pass

**Expected result:** index.ts shrinks by ~1,500 more lines → ~1,500 total, matching the spec target.

---

### 2. Finish Milestone 1: Final index.ts cleanup

After step 1, scan index.ts for any remaining full function bodies that belong in one of the already-created modules. Candidates (check if they're stubs or still full):

- `getTuiSessionPrefs` / `patchTuiSessionPrefs` — should delegate to `tui-coordination.ts`
- `getChatPrefsRuntime`, `updateChatRunPreferences`, `consumeNextRunNoContinue`, `getEffectiveModelLabel`, `formatChatRuntimePreferences`, `updateChatUsage`, `formatUsageText` — thin wrappers to `chat-preferences.ts`; verify they're stubs
- `buildTelegramGroupsPanel` — still at line 729 with a full body; should move to `telegram-group-mgmt.ts`
- `buildReasoningPanel`, `buildDeliveryPanel`, `buildVerbosePanel`, `buildQueuePanel`, `buildSubagentsPanel` — check if these are full bodies (they should be in `telegram-settings.ts`)
- `buildAdminPanelKeyboard`, `resolveTelegramSettingsPanel`, `sendTelegramSettingsPanel`, `editTelegramSettingsPanel`, `promptTelegramSetupInput` — same

**Goal:** index.ts should be pure orchestration — wire modules, start/stop services, `main()`. No panel builders, no message formatting, no Telegram delivery logic.

---

### 3. Milestone 2: Unify Dispatch Systems — NOT STARTED

**Context from SPEC.md:**
- `message-dispatch.ts` (1,900 lines) — full monolithic dispatcher with queue logic, finalization, state management
- Pipeline system: 5 files, 886 lines — `chat-pipeline.ts`, `coding-pipeline.ts`, `cron-pipeline.ts`, `pipeline-dispatcher.ts`, `run-pipeline.ts`
- Both systems manage active runs, request IDs, abort controllers, typing indicators

**Recommended approach (from spec):**
- Pick the pipeline abstraction (clean prepare/execute/deliver pattern) as the canonical path
- Migrate all message-dispatch logic INTO the pipeline classes
- `message-dispatch.ts` becomes a thin router: create the right pipeline and call `pipeline.run()`
- Kill the duplication

**Expected result:** 2,786 lines → ~1,200 lines; eliminates "which system handles this?" confusion.

**Before starting:** Read both `src/message-dispatch.ts` and all files in `src/pipeline/` to map which functions overlap and which are unique to each system.

---

### 4. Milestone 4: IPC Event Type Consolidation — NOT STARTED

**Context from SPEC.md:**
`src/runtime/host-events.ts` (399 lines) defines 17 event kinds. `processHostEvent` in `src/host-coordination.ts` has 17 case branches.

**Current event kinds** (see `src/runtime/host-events.ts`):
1. `telegram_preview_requested` — already removed (PR #99) but still in the type union — **remove**
2. `chat_delivery_requested` — keep
3. `task_requested` — merge → `ipc_request`
4. `action_requested` — merge → `ipc_request`
5. `action_result_ready` — merge → `ipc_result`
6. `file_delivery_requested` — merge → `file_transfer`
7. `file_delivery_completed` — merge → `file_transfer`
8. `host_error` — keep
9. `chat_state_changed` — merge → `run_state`
10. `run_lifecycle_changed` — merge → `run_state`
11. `tool_progress` — keep or merge with `run_progress` → `progress`
12. `run_progress` — see above
13. `assistant_final` — evaluate if still used
14. `run_started / run_finished / run_aborted / run_failed` — merge → `run_lifecycle`
15. `tool_started / tool_finished / tool_failed` — merge → `tool_lifecycle`
16. `chat` — keep
17. `agent` — keep

**Approach:**
1. Read `src/runtime/host-events.ts` and `src/host-coordination.ts` carefully
2. Trace each event kind: who emits it (in `src/pi-runner.ts`, `src/streaming/`) and who consumes it (in `processHostEvent`)
3. Merge event kinds per the spec's recommendation
4. Update all emit sites and the processHostEvent switch
5. Run `npm run typecheck` + `npm test`

**Expected result:** 17 kinds → ~8 kinds; simpler processHostEvent switch.

---

### 5. Verify app-config.ts / profile.ts consolidation

The `src/app-config.ts` was created (256 lines) to merge `config.ts` + `profile.ts`. However `profile.ts` was intentionally kept at 109 lines because tests use cache-busting dynamic imports.

**Verify:** Check if `app-config.ts` is actually being used (is `config.ts` re-exporting from it?) or if it's dead code. Run `grep -r "app-config" src/` to find all usages.

If `config.ts` re-exports from `app-config.ts` and tests still pass — it's working.
If `app-config.ts` is unused — either wire it in or delete it to keep the codebase clean.

---

## Verification Checklist Before Merging

```bash
npm run typecheck          # must be clean
npm test                   # must be 665 pass, 0 fail
npm run release-check      # pre-release gates
npm run secret-scan        # no secrets
npm run validate:skills    # pi skill manifests valid
```

Also: smoke-test the running service after building (`npm run build`) to confirm no runtime regressions.

---

## Architecture Notes for Incoming Devs

### Dependency Injection Pattern
The extracted modules use a `*Deps` interface pattern for functions that need to call back into index.ts or other modules. Example:

```typescript
// In host-coordination.ts
export interface HostCoordinationDeps {
  sendTelegramAgentReply: (chatJid: string, text: string) => Promise<boolean>;
  finalizeTelegramPreviewMessage: (...) => Promise<void>;
  // ...
}
export async function processHostEvent(event: HostEvent, deps: HostCoordinationDeps) { ... }

// In index.ts
function buildHostCoordinationDeps(): HostCoordinationDeps {
  return { sendTelegramAgentReply, finalizeTelegramPreviewMessage, ... };
}
function processHostEvent(event: HostEvent) {
  return hcProcessHostEvent(event, buildHostCoordinationDeps());
}
```

This pattern avoids circular imports and keeps modules testable.

### Module Init Pattern
`agent-runner.ts` uses an `initAgentRunner(deps)` call-once pattern. index.ts calls it during startup:

```typescript
import { initAgentRunner } from './agent-runner.js';
// During startup:
initAgentRunner({ statusTelemetry, getSessionKeyForChat, emitTuiToolEvent, ... });
```

### Shared State
All global mutable state lives in `src/app-state.ts`. All extracted modules import from there directly — no need to pass state through deps.

### ESM
All imports use `.js` extensions. No exceptions.

---

## File Size Summary (Current State)

| File | Lines | Status |
|---|---|---|
| `src/index.ts` | 3,039 | Target: ~1,500. Blocked on wiring telegram-delivery/settings |
| `src/message-dispatch.ts` | 1,900 | Untouched — Milestone 2 |
| `src/telegram-delivery.ts` | ~1,030 | Created, NOT wired into index.ts yet |
| `src/telegram-settings.ts` | ~1,660 | Created, NOT wired into index.ts yet |
| `src/agent-runner.ts` | ~905 | Done ✅ |
| `src/skill-service.ts` | ~545 | Done ✅ |
| `src/host-coordination.ts` | ~1,094 | Done ✅ |
| `src/heartbeat-service.ts` | ~434 | Done ✅ |
| `src/tui-coordination.ts` | ~340 | Done ✅ |
| `src/web-control-center.ts` | ~600 | Done ✅ |
| `src/state-persistence.ts` | ~388 | Done ✅ |
| `src/telegram-group-mgmt.ts` | ~631 | Done ✅ |
| `src/update-service.ts` | ~91 | Done ✅ |
| `src/memory-action-gateway.ts` | 181 | Done ✅ (was 703) |
| `src/memory-action-validation.ts` | 121 | Done ✅ |
| `src/memory-action-io.ts` | 336 | Done ✅ |
| `src/parity-config.ts` | 400 | Done ✅ (was 676) |
| `src/config.ts` | 60 | Done ✅ (was 294, re-exports from app-config.ts) |
| `src/app-config.ts` | 256 | Done ✅ (verify it's wired, see note above) |
| `src/runtime/host-events.ts` | 399 | Untouched — Milestone 4 |
| `src/pipeline/` (5 files) | 885 | Untouched — Milestone 2 |
