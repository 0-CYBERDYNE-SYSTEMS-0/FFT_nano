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
- **Memory subsystem**: Lexical search across transcript + document stores; `memory-backend.ts` is the unified facade; `memory-paths.ts` owns directory layout. Optional **semantic re-rank** (`memory-embeddings.ts`) blends a local Ollama embedding cosine with the lexical score — off by default, lexical fallback always.
- **TUI** (`src/tui/`): Separate gateway server/client pair bridging the terminal UI to the host event bus over WebSocket.

### Durability & Self-Improvement

These subsystems close the agent's reliability/learning loops. All are additive and degrade safely.

- **Long-run durability** (`src/long-run-service.ts` + `agent_runs` table): a long run records its durable workspace as `worktree_path` at start. On restart, `triageActiveAgentRunsOnStartup` (`db.ts`) marks in-flight runs `interrupted`/`recoverable`; `resumeRecoverableRuns()` re-enqueues them at boot with a `resume_attempts` cap (`FFT_NANO_LONG_RUN_MAX_RESUMES`, default 2). Wired in `app.ts main()` after channels are up.
- **Delivery outbox** (`src/outbox.ts` + `delivery_outbox` table): at-least-once delivery with a UNIQUE `dedupe_key` so a re-emitted final never double-posts. Cron announces deliver through it (`cron:{id}:{run}` key); `flushPending()` runs at startup and on every cron tick so transient outages self-heal. Interactive chat streaming is intentionally NOT routed through it (no stable dedupe key).
- **Self-improvement loop** (`evaluator.ts` → `evaluator_verdicts` table → `coding-orchestrator.ts`): evaluator verdicts are persisted; `getEvaluatorStats(group)` feeds the rolling pass-rate + recurring issues into each subsequent coding/subagent run. Group-scoped, coding/subagent only.
- **Memory injection consistency**: `shouldBuildRetrievedMemoryContext` (`pi-runner.ts`) builds retrieved-memory context for main chat **and** cron (`isScheduledTask`) and subagent (`isSubagent`) runs.
- **Skill versioning** (`src/skill-history.ts`): every skill mutation snapshots `SKILL.md` to `.history/` (bounded to 10) before overwriting; the `skill_rollback` IPC action restores the prior version reversibly.
- **Skill self-improvement signals** (`src/self-improve-signals.ts` → `src/skill-service.ts`): a deterministic, lexical `extractLearningSignals({ userTask, agentOutput, toolExecutions })` flags high-value learning (`remember`/`correction`/`fail-then-fix` → `full` priority; `multi-step-procedure` → `light`). A `full` signal fires the quiet skill reviewer immediately, bypassing the turn/tool counters; a per-group min-interval debounce (`selfImprove.minIntervalMinutes`, default 15, env `FFT_NANO_SKILL_SELF_IMPROVE_MIN_INTERVAL_MINUTES`) caps how often the pi subprocess spawns. Every pass — including no-ops — appends one JSONL line to `groups/<group>/logs/self-improve-events.jsonl` (`recordSelfImproveEvent`). No DB migration, no extra LLM call.
- **Idle skill curator** (`shouldRunSkillManager` idle gate + `startCuratorLoop` in `app.ts`): `state.lastInboundAt` is stamped on every user-origin inbound; the curator runs only after the host has been idle for `minIdleHours`. An hourly unref'd loop drives `maybeRunSkillManager` via an injected `runCuratorTick`, so curation happens independent of user traffic. `minIdleHours` is now real scheduling behavior.

### State Access Pattern

```typescript
import { state, activeChatRuns, hostEventBus } from './app-state.js';
// Reassignable vars live on `state` object (ESM compatibility)
// Maps: activeChatRuns.get(...), activeChatRuns.set(...)
```

## Development Workflow (Authoritative)

Two-track, two-worktree model. **The two worktrees share one `.git`; a branch can be checked out in only one at a time.**

- **`origin/main`** — canonical deployment line. All PRs merge here. The runtime
  worktree tracks `main`. Direct fast-forward pushes to your own feature branch
  are allowed; **force-push to `main` is forbidden** (cherry-pick or revert for
  rollback). `origin/dev` is retired; merge it in or stop pushing to it.
- **`~/fft_nano-dev`** — edit/build/test worktree. Work on FEATURE branches
  here, never on `main`.
- **`~/fft_nano`** (= `/Users/username/FFT_nano`, case-insensitive FS) — runtime
  worktree on `main`; **never hand-edit**. Builds + restarts the launchd service.

**Ship loop:** feature branch in `fft_nano-dev` → PR to `main` → merge →
in `~/fft_nano`: `git pull --ff-only origin main` → `npm run build` →
`launchctl kickstart -k gui/$(id -u)/com.fft_nano` → verify new PID + clean
`logs/fft_nano.log`. **The service runs `dist/`, so a build is mandatory after
every pull.** Live DB: `~/fft_nano/store/messages.db`.

A drift witness (`src/drift-witness-service.ts`) fires at boot and on every
heartbeat. If `~/fft_nano` is more than `FFT_NANO_DRIFT_THRESHOLD` commits
(default 4) behind `main` for more than 2 days, it warns in the log and enqueues
a dedupe-keyed Telegram notice (`drift-witness:<local>:<remote>`). Threshold
of `0` disables drift detection entirely. Set `FFT_NANO_CANONICAL_BRANCH` to
override `main` for forks / branched deployments.

- Runtime worktree (`~/fft_nano`) must stay clean. Before pushing changes, verify:
  `git status` → working tree clean (no untracked files, no modifications).
  - Use `git stash push -u` to shelve untracked files.
  - Do not commit lock files or `reports/`; these are excluded by `.gitignore`.
  - Test artifacts should be isolated to `~/fft_nano-dev`, not `~/fft_nano`.
  - The companion runbook at `docs/ops/WORKSPACE-CLEANUP.md` documents the
    one-time sweep for the historical debris — the actual cleanup remains
    operator-confirmed; do not auto-purge without using that runbook.

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
| `src/index.ts` | Orchestrator wiring (~2,100 lines): constructs services (`longRunService`, `outboxDeliverer`, scheduler, `appRuntime`) and `*Deps` objects |
| `src/app.ts` | `main()`, startup/shutdown, `connectWhatsApp`; boot-time outbox flush + long-run resume |
| `src/app-state.ts` | All global mutable state, type definitions, `hostEventBus` singleton |
| `src/message-dispatch.ts` | Thin re-export; canonical dispatch lives in `src/pipeline/message-dispatch-pipeline.ts` (`processMessage`, `runDirectSessionTurn`) |
| `src/telegram-commands.ts` | Telegram command handling, settings panels, callback queries |
| `src/pi-runner.ts` | Agent subprocess spawning, runtime event emission, memory-context gate |
| `src/agent-runner.ts` | `runAgent()` — workspace resolution, host-context, run lifecycle |
| `src/telegram-streaming.ts` | Visible Telegram preview registry and completion state |
| `src/runtime/host-events.ts` | `HostEventBus` — typed EventEmitter hub for host-local delivery |
| `src/runtime/boundary-ipc.ts` | Cross-boundary envelope parsing, evaluator verdict leak guard |
| `src/evaluator.ts` | Post-run quality scoring; verdict persistence |
| `src/coding-orchestrator.ts` | Plan/execute worker routing; ephemeral worktrees; verdict feed-forward |
| `src/long-run-service.ts` | Durable `agent_runs`; restart triage + `resumeRecoverableRuns()` |
| `src/outbox.ts` | At-least-once delivery deliverer (dedupe + retry) over `delivery_outbox` |
| `src/cron/service.ts` + `src/task-scheduler.ts` | Scheduled task engine; scheduler injects the outbox deliverer |
| `src/memory-backend.ts` / `src/memory-search.ts` / `src/memory-embeddings.ts` | Memory facade / lexical search / opt-in semantic re-rank |
| `src/skill-lifecycle.ts` / `src/skill-history.ts` | Skill IPC actions / `.history` versioning + rollback |
| `src/permission-gate-policy.ts` / `src/bash-guard.ts` | Tool permission decisions / destructive-command classification |
| `src/db.ts` | SQLite schema + queries; idempotent `ALTER TABLE` migrations at startup |
| `src/config.ts` → `src/app-config.ts` | Config constants + env defaults (`config.ts` re-exports `app-config.ts`) |

## Status

The `index.ts` decomposition (8,030 → ~2,100 lines) and the host-local EventEmitter delivery migration are complete; extracted modules use a `*Deps` injection pattern (`buildXDeps()` in `index.ts`, thin wrappers delegate). The Agent Durability & Self-Improvement pass (resume, outbox, evaluator feedback, cron/subagent memory, semantic memory, skill versioning) shipped and runs live on `dev` — see `MISSION_CONTRACT.md` / `HANDOFF.md`.

## Conventions

- ESM modules (`"type": "module"`); import paths use `.js` extensions.
- Tests in `tests/`, named `*.test.ts`. Run after every extraction step.
- `src/skills/` and `skills/` contain pi skill manifests; validate with `npm run validate:skills`.
- `config/runtime.parity.json` controls parity feature flags (`PARITY_CONFIG`).
- Git hooks in `hooks/` (pre-commit, pre-push) — do not bypass with `--no-verify`.
- Semantic memory is opt-in: `MEMORY_SEMANTIC_ENABLED=1` plus a local Ollama (`OLLAMA_BASE_URL`, default `http://localhost:11434`) running `MEMORY_SEMANTIC_MODEL` (default `nomic-embed-text`). Tunables: `MEMORY_SEMANTIC_WEIGHT`, `MEMORY_SEMANTIC_CANDIDATES`, `MEMORY_SEMANTIC_QUERY_BUDGET_MS`. Absent/disabled → pure lexical.
