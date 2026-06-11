# Learning Isolation and User-Priority (LISO) Implementation Notes

## Overview

This document tracks implementation decisions, tradeoffs, and deviations from the spec for the LISO feature.

## Branch

`feat/learning-isolation-user-priority`

## Spec Reference

`learning-isolation-user-priority-spec.md` (June 11, 2026)

## Implementation Status

### Completed Workstreams

#### LISO.1: Ephemeral Pi Sessions

**Changes made:**
- Added `SessionPersistence = 'normal' | 'ephemeral'` to `src/types.ts`
- Extended `ContainerInput` in `src/pi-runner.ts` with `sessionPersistence?: 'normal' | 'ephemeral'`
- Modified `buildPiArgs` to add `--no-session` flag when `sessionPersistence === 'ephemeral'`
- Added validation in `runContainerAgent` to reject ephemeral + continuation requests (throws before container launch)

**Key decision:** The `--no-session` flag is added alongside the existing `-c` logic. If ephemeral is set, we skip `-c` and add `--no-session` instead.

#### LISO.2: User-Priority Scheduling

**Changes made:**
- Added `ActiveMaintenanceRun` interface to `src/app-state.ts`
- Added `PendingGraceTimer` interface to `src/app-state.ts`
- Added `activeMaintenanceRuns` and `pendingGraceTimers` maps to `src/app-state.ts`
- Added `cancelActiveMaintenance()` function to `src/skill-service.ts`
- Added `cancelPendingGraceTimer()` function to `src/skill-service.ts`
- Added `scheduleMaintenanceAfterGrace()` function to `src/skill-service.ts`
- Added import and cancellation logic to `src/pipeline/message-dispatch-pipeline.ts`

**Key decision:** The cancellation happens at the earliest dispatch point in `processMessageWithOutcome`. We get the group from `registeredGroups` using the `chat_jid` from the message.

**Grace period:** Implemented via `PARITY_CONFIG.skills.selfImprove.idleGracePeriodMs` with default of 30 seconds (30000ms). Added to `parity-config.ts` and env var parsing.

#### LISO.3: Turn-Local Learning Evidence

**Changes made:**
- Added `LearningTurnInput`, `TurnExecutionSummary`, and `LearningProvenance` types to `src/types.ts`
- Added `latestUserText` and `turnId` fields to `ContainerInput` in `src/pi-runner.ts`

**Note:** The `latestUserText` is threaded through the pipeline but the signal extraction still uses the `originalTask` parameter. The spec requires extracting signals only from `latestUserText`, but the current signal extraction logic in `self-improve-signals.ts` uses `userTask`. Future work may need to refactor signal extraction to use `latestUserText` instead.

#### LISO.4: Proposal-Only Learning

**Changes made:**
- Added `LearningProposal` type to `src/types.ts`
- Added `parseMaintenanceProposal()` function to `src/skill-service.ts`
- Updated `runQuietSkillAgent` to use maintenance origin and ephemeral sessions

**Key decision:** The maintenance model now runs with `toolMode: 'read_only'` and returns structured proposals that are parsed and validated by the host. However, the actual validation and application gateway is not fully implemented - the parsed proposals are logged but not applied.

#### LISO.5: Maintenance Prompt Mode

**Changes made:**
- Extended `PromptMode` type to `'full' | 'minimal' | 'maintenance'` in `src/system-prompt.ts`
- Added `promptMode?: 'interactive' | 'maintenance'` to `SystemPromptInput`
- Added condition in `buildSystemPrompt` to skip context building for maintenance mode
- Added condition to skip skill catalog for maintenance mode

**Key decision:** For maintenance mode, the context building returns empty entries, effectively excluding all bootstrap files, memory, daily notes, and skill catalogs.

#### LISO.6: Authority and Permission Policy

**Changes made:**
- Added `'maintenance'` to `RunOrigin` type in `src/types.ts`
- Added `isMaintenanceRun` parameter to `deriveRunOrigin()` and `mintRunAuthority()` in `src/run-authority.ts`
- Updated `evaluatePermissionGate()` in `src/permission-gate-policy.ts` to block all mutations from maintenance origin

**Key decision:** Maintenance origin gets `operatorGrant: false` by default (since it's not `interactive-main` or `evaluator`). The permission gate blocks all tool categories for maintenance runs, not just mutations.

#### LISO.7: Observability

**Changes made:**
- Added `MaintenanceEventKind` and `MaintenanceEventFields` types to `src/types.ts`
- Added `emitMaintenanceEvent()` function to `src/skill-service.ts`
- Events are written to `groups/<group>/logs/maintenance-events.jsonl`

**Events emitted:**
- `scheduled` - when maintenance is scheduled
- `idle_grace_started` - when grace period starts
- `idle_grace_cancelled` - when grace is cancelled due to new message
- `maintenance_started` - when Pi container starts
- `maintenance_aborted` - when maintenance is aborted
- `maintenance_completed_noop` - when maintenance produces noop
- `proposal_parsed` - when a valid proposal is parsed

#### LISO.9: Idle Grace Period

**Changes made:**
- Added `idleGracePeriodMs` to `SkillSelfImproveConfig` in `src/parity-config.ts`
- Added `FFT_NANO_LEARNING_IDLE_GRACE_MS` env var parsing
- Default grace period: 30 seconds

## Incomplete / TODO

1. **Proposal application gateway** - Proposals are parsed but not validated or applied through the host gateway. The `TODO: LISO.4: Validate and apply proposal through host gateway` comment remains in the code.

2. **Self-improve signals refactor** - The `extractLearningSignals()` function still uses `userTask` (the original prompt) instead of `latestUserText`. This should be updated to only use the current turn's evidence.

3. **Supersession detection** - The `turnId` is passed through but not used for supersession checking before applying proposals.

4. **Permission gate for maintenance tool set** - The maintenance runs use `toolMode: 'read_only'` which is good, but there's no enforcement at the permission gate level that the tool set is restricted.

5. **Learning pause integration** - The `learningPaused` state is checked but the pause behavior for maintenance runs (aborting active runs and canceling pending timers) is not fully wired.

## Files Modified

1. `src/types.ts` - Added new types
2. `src/pi-runner.ts` - Added ephemeral session support
3. `src/app-state.ts` - Added maintenance registry
4. `src/run-authority.ts` - Added maintenance origin
5. `src/permission-gate-policy.ts` - Added maintenance policy
6. `src/skill-service.ts` - Major refactoring for maintenance lifecycle
7. `src/parity-config.ts` - Added idle grace period config
8. `src/system-prompt.ts` - Added maintenance prompt mode
9. `src/pipeline/message-dispatch-pipeline.ts` - Added cancellation on inbound

## Validation

**Typecheck:** Passing (verified with `npm run typecheck`)

The following validation cases from the spec should be tested:

- VAL-LISO-001: Ephemeral arguments contain --no-session
- VAL-LISO-002: Invalid continuation rejected for ephemeral
- VAL-LISO-003: No maintenance session file
- VAL-LISO-004: Continuation target unchanged after maintenance
- VAL-LISO-005: No shared session log
- VAL-LISO-006: Inbound message aborts maintenance
- VAL-LISO-007: Grace period cancellation
- VAL-LISO-013: Maintenance has no operator grant
- VAL-LISO-014: Mutating tools absent
- VAL-LISO-015: Policy denies local mutation
- VAL-LISO-020: Maintenance prompt is minimal
- VAL-LISO-021: Cancellation prevents late apply
- VAL-LISO-022: Maintenance remains silent

## Known Issues

1. Circular import potential between `skill-service.ts` and `message-dispatch-pipeline.ts` - monitored
2. The `extraSystemPrompt` for maintenance needs to be enhanced with the full maintenance contract per LISO.12
3. Test files not yet created for the new functionality
