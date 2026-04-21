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

### Active Refactoring (branch: `refactor/architecture-simplification`)

A 4-phase simplification is in progress. Current state:

**Phase 1: Extract modules from index.ts** (IN PROGRESS)
- `src/app-state.ts` — DONE. All global mutable state (20+ Maps), type definitions, and constants extracted. Reassignable `let` vars wrapped in exported `state` object for ESM compatibility.
- `src/chat-preferences.ts` — DONE. Normalizers, queue parsing, preference persistence, usage stats helpers extracted.
- `src/telegram-streaming.ts` — IN PROGRESS. Single-path visible preview registry landed; remaining tool progress/final reply extraction still pending.
- `src/telegram-commands.ts` — PENDING. handleTelegramCommand, settings panels, callback queries (~1200 lines).
- `src/message-dispatch.ts` — PENDING. processMessage, runDirectSessionTurn, queue logic.
- `src/app.ts` — PENDING. main(), startup, shutdown, connectWhatsApp.

**Phase 2: Replace file-based IPC with EventEmitter** — IN PROGRESS
- Host-local preview/final delivery in `pi-runner.ts` now emits runtime events instead of writing `messages/*.json`
- Cross-boundary sandbox IPC files remain in place for agent-authored `messages/`, `tasks/`, `actions/`, and `action_results/`
- `startIpcWatcher()` still owns filesystem IPC polling; host-local event handling now runs beside it

**Phase 3: Simplify draft streaming to one path** — IN PROGRESS
- Native `sendMessageDraft()` is no longer used for host-local preview delivery
- Host preview streaming now uses one visible send+edit path via `TelegramPreviewRegistry`
- Legacy `telegram-draft-ipc.ts` compatibility remains in-tree pending cleanup

**Phase 4: Collapse completion resolver** — IN PROGRESS
- Completion now resolves against preview/completed registry state instead of draft/message dual-mode state
- Final consolidation into a shared message-dispatch helper is still pending

### State Access Pattern

After Phase 1 extraction, modules access shared state via:
```typescript
import { state, activeChatRuns, ... } from './app-state.js';
// Reassignable vars: state.registeredGroups, state.telegramBot, etc.
// Maps: activeChatRuns.get(...), activeChatRuns.set(...)
```

## Key Files

| File | Role |
|---|---|
| `src/index.ts` | Main orchestrator (6809 lines, being decomposed) |
| `src/app-state.ts` | All global mutable state and types |
| `src/pi-runner.ts` | Agent subprocess spawning, snapshots, host runtime event emission |
| `src/telegram-streaming.ts` | Visible Telegram preview registry and completion state |
| `src/pi-runtime-events.ts` | Host-local runtime event hub for preview/final delivery |
| `src/tui/runtime-events.ts` | EventEmitter pattern (34 lines, template for Phase 2) |
| `src/config.ts` | All configuration constants |

## Build & Test

```bash
npm run build          # TypeScript compilation
npm test               # 184 tests via node --test
npx tsc --noEmit       # Type-check without emitting
```

## Conventions

- ESM modules (`"type": "module"` in package.json)
- Import paths use `.js` extensions (TypeScript ESM convention)
- Tests in `tests/` directory, named `*.test.ts`
- No unnecessary comments — code should be self-documenting
- Run tests after every extraction step to catch regressions immediately
