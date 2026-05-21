# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# FFT_nano — Project Instructions

## Architecture

Single Node.js host process: receives chat messages (Telegram/WhatsApp), runs `pi` (coding agent) as a subprocess, returns responses. SQLite for persistence.

### Message Flow

```
Telegram/WhatsApp → message-dispatch.ts → pi-runner.ts (spawns pi subprocess)
                                        ↓
                              HostEventBus (host-events.ts)
                                        ↓
                      telegram-streaming.ts / file-delivery.ts
```

- **Host-local delivery** (preview/final): `pi-runner.ts` emits `HostEvent`s on `hostEventBus` — never writes files for this path.
- **Cross-boundary IPC** (agent-authored actions): `pi` subprocess writes JSON to `messages/`, `tasks/`, `actions/`, `action_results/` directories; `startIpcWatcher()` in `index.ts` polls these.
- **Evaluator loop**: After agent completes, `evaluator.ts` runs a second `pi` pass to score output quality; verdict JSON must never leak to users (see `boundary-ipc.ts:isInternalEvaluatorVerdictText`).
- **Cron service** (`src/cron/service.ts`): Drives scheduled tasks via SQLite, calls `runContainerAgent` and `runEvaluatorPass` directly.
- **Coding orchestrator** (`src/coding-orchestrator.ts`): Manages plan/execute worker routing for coding tasks; uses ephemeral worktrees and evaluator refinement loops.
- **Permission gate** (`src/permission-gate-policy.ts`): Blocks destructive bash commands for subagents or headless runs; `bash-guard.ts` classifies commands.
- **Memory subsystem**: Lexical search across transcript + document stores; `memory-backend.ts` is the unified facade; `memory-paths.ts` owns directory layout.
- **TUI** (`src/tui/`): Separate gateway server/client pair bridging the terminal UI to the host event bus over WebSocket.

### State Access Pattern

```typescript
import { state, activeChatRuns, hostEventBus } from './app-state.js';
// Reassignable vars live on `state` object (ESM compatibility)
// Maps: activeChatRuns.get(...), activeChatRuns.set(...)
```

## Development Workflow (Authoritative)

Use a two-checkout model:

1. Implement in the dev checkout/worktree (e.g. `fft_nano-dev`).
2. Merge via PR to `origin/main`.
3. Fast-forward the runtime/release checkout on `main`.
4. Build and restart the installed launchd service from that `main` checkout.

- Dev-checkout path and service-checkout path being different is expected.
- Runtime debugging starts from the active service checkout (`.env`, logs, launchd state); fixes land in the dev checkout and are promoted via PR.

## Build & Test

```bash
npm run build                                    # TypeScript → dist/
npm run dev                                      # Run via tsx (no build step)
npm test                                         # All tests via node --test
npm run typecheck                                # Type-check without emitting

# Run a single test file
node --import tsx --test tests/<name>.test.ts

npm run format                                   # Prettier write
npm run format:check                             # Prettier check (CI)
npm run validate:skills                          # Validate pi skill manifests
npm run doctor                                   # Diagnose runtime env
```

## CI/CD (Required Gates)

Before release/tag promotion:

```bash
npm run release-check
npm run secret-scan
```

GitHub Actions:
- `.github/workflows/release-readiness.yml`: typecheck, tests, secret-scan, validate:skills, release-check
- `.github/workflows/skills-only.yml`: validate:skills for skills-only changes

## Key Files

| File | Role |
|---|---|
| `src/index.ts` | Remaining orchestrator logic (~5700 lines, still being decomposed) |
| `src/app-state.ts` | All global mutable state, type definitions, `hostEventBus` singleton |
| `src/app.ts` | `main()`, startup, shutdown, `connectWhatsApp` |
| `src/message-dispatch.ts` | `processMessage`, `runDirectSessionTurn`, queue logic |
| `src/telegram-commands.ts` | Telegram command handling, settings panels, callback queries |
| `src/pi-runner.ts` | Agent subprocess spawning, snapshots, runtime event emission |
| `src/telegram-streaming.ts` | Visible Telegram preview registry and completion state |
| `src/runtime/host-events.ts` | `HostEventBus` — typed EventEmitter hub for host-local delivery |
| `src/runtime/boundary-ipc.ts` | Cross-boundary envelope parsing, evaluator verdict leak guard |
| `src/evaluator.ts` | Post-run quality scoring; `shouldEvaluate()` threshold guard |
| `src/coding-orchestrator.ts` | Plan/execute worker routing for coding tasks |
| `src/cron/service.ts` | Scheduled task execution engine |
| `src/permission-gate-policy.ts` | Tool permission decisions for subagents/headless runs |
| `src/memory-backend.ts` | Unified memory search/retrieval facade |
| `src/config.ts` | All configuration constants and env var defaults |

## Active Refactoring

4-phase decomposition of `index.ts` is in progress:

- **Phase 1** (DONE): Extract `app-state`, `chat-preferences`, `telegram-streaming`, `telegram-commands`, `message-dispatch`, `app`.
- **Phase 2** (IN PROGRESS): Replace file-based IPC with EventEmitter for host-local delivery. Cross-boundary sandbox IPC files remain.
- **Phase 3** (IN PROGRESS): Consolidate draft streaming to one path via `TelegramPreviewRegistry`; `telegram-draft-ipc.ts` pending cleanup.
- **Phase 4** (IN PROGRESS): Collapse completion resolver to use preview/completed registry state; shared message-dispatch helper pending.

## Conventions

- ESM modules (`"type": "module"`); import paths use `.js` extensions.
- Tests in `tests/`, named `*.test.ts`. Run after every extraction step.
- `src/skills/` and `skills/` contain pi skill manifests; validate with `npm run validate:skills`.
- `config/runtime.parity.json` controls parity feature flags (`PARITY_CONFIG`).
- Git hooks in `hooks/` (pre-commit, pre-push) — do not bypass with `--no-verify`.
