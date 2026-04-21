# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# FFT_nano — Project Instructions

## Architecture

Single Node.js host process: receives chat messages (Telegram/WhatsApp), runs `pi` agent subprocess, returns responses. SQLite for persistence.

## Development Workflow (Authoritative)

Use a two-checkout model:

1. Do implementation in the dev checkout/worktree (for example `fft_nano-dev`).
2. Merge via PR to `origin/main`.
3. Fast-forward the local runtime/release checkout on `main`.
4. Build/restart the installed service from that local `main` checkout.

This is intentional so runtime behavior matches what end users install from `main`.

Interpretation rules:
- Dev-checkout path and service-checkout path being different is expected.
- A checkout mismatch is only a problem when the runtime checkout is not `main` or is behind merged `origin/main`.
- Runtime debugging should begin from the active service checkout (`.env`, logs, launchd/systemd state), then fixes are implemented in the dev checkout and promoted through PR/merge.

## CI/CD (Required Gates)

Before release/tag promotion, run:

```bash
npm run release-check
npm run secret-scan
```

GitHub Actions gates:
- `.github/workflows/release-readiness.yml`: typecheck, tests, secret-scan, validate:skills, release-check
- `.github/workflows/skills-only.yml`: validate:skills for skills-only changes

### Active Refactoring

A 4-phase decomposition of `index.ts` is in progress:

**Phase 1: Extract modules from index.ts** — DONE
- `src/app-state.ts` — All global mutable state (20+ Maps), type definitions, constants. Reassignable `let` vars wrapped in `state` object for ESM compatibility.
- `src/chat-preferences.ts` — Normalizers, queue parsing, preference persistence, usage stats.
- `src/telegram-streaming.ts` — Single-path visible preview registry and completion state.
- `src/telegram-commands.ts` — `handleTelegramCommand`, settings panels, callback queries.
- `src/message-dispatch.ts` — `processMessage`, `runDirectSessionTurn`, queue logic.
- `src/app.ts` — `main()`, startup, shutdown, `connectWhatsApp`.

**Phase 2: Replace file-based IPC with EventEmitter** — IN PROGRESS
- Host-local preview/final delivery in `pi-runner.ts` now emits runtime events instead of writing `messages/*.json`
- Cross-boundary sandbox IPC files remain for agent-authored `messages/`, `tasks/`, `actions/`, `action_results/`
- `startIpcWatcher()` still owns filesystem IPC polling; host-local event handling runs beside it

**Phase 3: Simplify draft streaming to one path** — IN PROGRESS
- Native `sendMessageDraft()` no longer used for host-local preview delivery
- Host preview streaming uses one visible send+edit path via `TelegramPreviewRegistry`
- Legacy `telegram-draft-ipc.ts` compatibility remains in-tree pending cleanup

**Phase 4: Collapse completion resolver** — IN PROGRESS
- Completion resolves against preview/completed registry state instead of draft/message dual-mode state
- Final consolidation into a shared message-dispatch helper still pending

### State Access Pattern

```typescript
import { state, activeChatRuns, ... } from './app-state.js';
// Reassignable vars: state.registeredGroups, state.telegramBot, etc.
// Maps: activeChatRuns.get(...), activeChatRuns.set(...)
```

## Key Files

| File | Role |
|---|---|
| `src/index.ts` | Remaining orchestrator logic (~5700 lines, still being decomposed) |
| `src/app-state.ts` | All global mutable state and types |
| `src/app.ts` | Startup, shutdown, WhatsApp connection |
| `src/message-dispatch.ts` | Message processing, session turns, queue logic |
| `src/telegram-commands.ts` | Telegram command handling, settings panels, callback queries |
| `src/pi-runner.ts` | Agent subprocess spawning, snapshots, runtime event emission |
| `src/telegram-streaming.ts` | Visible Telegram preview registry and completion state |
| `src/runtime/host-events.ts` | `HostEventBus` — typed EventEmitter hub for host-local delivery |
| `src/config.ts` | All configuration constants |

## Build & Test

```bash
npm run build          # TypeScript compilation
npm run dev            # Run with tsx (no build step)
npm test               # All tests via node --test
npm run typecheck      # Type-check without emitting

# Run a single test file
node --import tsx --test tests/<name>.test.ts

npm run format         # Prettier write
npm run format:check   # Prettier check (CI)
```

## Conventions

- ESM modules (`"type": "module"` in package.json)
- Import paths use `.js` extensions (TypeScript ESM convention)
- Tests in `tests/` directory, named `*.test.ts`
- No unnecessary comments — code should be self-documenting
- Run tests after every extraction step to catch regressions immediately
