# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `/update` now preserves dirty local checkouts by stashing tracked and untracked
  changes, pulling upstream, reapplying the stash, then rebuilding/restarting.

## [0.2.2] - 2026-05-11

### Added

- `/delivery append` Telegram mode sends progress and final replies as separate
  messages, avoiding edits or deletes after text has been printed.
- Setup now installs a pinned `~/.local/bin/fft` launcher and PATH block so `fft tui`,
  `fft web`, and service commands work from any directory after onboarding.

### Fixed

- Pi JSON parsing now distinguishes tool-use assistant preambles from terminal final
  answers, preventing "let me research..." text from being delivered as the completed
  response.
- Empty terminal assistant turns after tool use now remain empty so the host retry/
  diagnostic path runs instead of leaking earlier progress text.

## [0.2.0] - 2026-05-10

### Added

- Universal evaluator pass for all long-running agent actions (`src/evaluator.ts`).
  A threshold-gated second `pi` call independently verifies every qualifying run
  actually accomplished its task, addressing self-evaluation bias in autonomous operation.
  - Heartbeat, scheduled, and cron runs: always evaluated (no human watching)
  - Coding execute runs: blocking evaluation when files are changed; up to 2 refinement
    passes with targeted feedback before delivering best result
  - Chat and subagent runs: evaluated when duration ≥45s, tools ≥3, or output ≥1500 chars;
    non-blocking follow-up sent only when issues are found
  - `isEvaluatorRun` flag on `ContainerInput` prevents recursive evaluation
- `RunType` union type added to `src/types.ts` for evaluator context typing.

### Fixed

- Long-horizon stability for multi-day autonomous operation:
  - `process.on('unhandledRejection')` and `'uncaughtException'` handlers registered
    at startup so silent async failures surface in logs instead of disappearing
  - `pruneStaleState()` on a stored, cancellable 6-hour interval caps unbounded Map
    growth in `activeChatRuns`, `activeCoderRuns`, `telegramSettingsPanelActions`,
    `telegramSetupInputStates`, `telegramToolProgressRuns`, and `tuiMessageQueue`
  - `tuiMessageQueue` hard-capped at 50 entries per chat with oldest-drop eviction
  - Group-sync and heartbeat `setInterval` handles stored and cancelled at shutdown;
    `unref()` prevents them from blocking process exit
  - `hostEventBus.subscribe()` return value captured and torn down during shutdown
  - Parent timeout handle cleared before entering provider fallback loop so a stale
    parent timer cannot kill the fallback child process
- `finalizeCompletedRun` now sends a structured diagnostic when result is empty/null/
  whitespace: `LLM produced no user-visible final response | run=X | provider=Y`.
  `externallyCompleted` no longer suppresses the diagnostic — it appends
  `external_delivery=yes` instead.
- Telegram draft preview now publishes `Working on your reply...` immediately when a
  tool call starts before any assistant text has been produced.

## [0.1.0] - 2026-04-30

### Reset

- Reset versioning to semver-conventional 0.1.0 starting point.
- Previous releases v1.0.1 through v1.7.2 have been removed from the release page.
- All existing code and features are preserved — this is a version label change only.

## [1.7.2] - 2026-04-22

### Added

- `/update` command support across Telegram, TUI, and web control surfaces.
- Bidirectional Telegram file delivery flow for agent/operator file exchange.
- Pi autoresearch extension and paired runtime skills for create/finalize workflows.

### Changed

- Skill validator policy now aligns with skill-creator guidance.

## [1.7.1] - 2026-04-21

### Fixed

- Telegram model overrides now validate against available runtime models, and invalid
  persisted model preferences are cleared automatically.
- Pi model-list stderr fallback parsing now requires a valid table header, reducing
  malformed fallback results.
- Native Telegram draft streaming is now limited to private chats.

### Changed

- Clarified authoritative local development and release workflow guidance for
  `main` and worktree usage.

## [1.7.0] - 2026-04-19

### Added

- Browser-first onboarding handoff: setup can now complete from a browser session before
  Telegram registration is required, with automatic handoff into the main-chat flow.
- Pulse telemetry for `/status`: rich structured output with incident history and live
  health signals; telemetry buffer is capped to prevent unbounded growth.
- `/models` now opens the model picker panel directly instead of rendering a text list,
  with a matching add-model panel flow.

### Fixed

- Telegram main-chat onboarding gap after browser-first handoff — registration is now
  unblocked correctly at the end of the browser flow.
- OpenClaw defaults replaced; Telegram main-chat onboarding no longer stalls on
  provider-specific default values.
- POSIX-compatible `tr` call in `onboard-all.sh` for Alpine/busybox compatibility.
- Host runtime installs now bundle the `pi` CLI correctly.
- Interactive host runtime selection is honored and no longer overridden by the installer.
- Installer runtime selection flow repaired for edge cases that caused the wrong runtime
  to be selected silently.
- Main chat is restored correctly after a coder cancel or resume operation.
- Fallback aborted coder/subagent runs now classified and reported correctly.
- Terminal bookend messages guaranteed for all coder run outcomes.
- Empty-result acknowledgment sent instead of silently dropping delivery.

## [1.6.1] - 2026-04-08

### Fixed

- End-to-end message delivery success/failure tracking across all send paths.
- Delivery confirmation handling for heartbeat, cron task outcomes, and error reply paths.
- `SchedulerDependencies.sendMessage` return type corrected to `Promise<boolean>` so delivery results propagate correctly through the scheduler.

### Changed

- Expanded Pi-Native Project Skills documentation in AGENTS.md with explicit skill directory layout, two-layer architecture explanation, mirroring semantics, and personal skill setup instructions.

## [1.5.0] - 2026-04-02

### Added

- Project-aware coder workspace resolution, including explicit project targeting and text-based project creation flows.
- Permission-gate policy plumbing and operator approval paths for interactive coding escalation.
- Canonical durable-memory coverage across retrieval, prompt assembly, and memory-action test surfaces.
- Expanded developer reference material for message dispatch, prompt construction, permission UI, and runtime modules.

### Changed

- Main-chat coding requests now prefer approval/suggestion flows with resolved workspace targets instead of blind execution.
- Runtime prompt assembly now handles canonical memory, daily staging notes, and stronger non-main durable-memory fallbacks.
- Profile/runtime docs, onboarding references, and skill layout were updated for the current OpenClaw/FarmFriend host model.

### Fixed

- Restored reliable RPC prompt transport and extension-UI handling for interactive `pi` runs.
- Added startup grace so fresh interactive runs are not stale-killed before first output.
- Restored compatibility for legacy memory layout, cron/subagent task rows, and Telegram draft-preview edge cases.

## [1.4.0] - 2026-03-31

### Added

- Capability inventory generation and a new `/capabilities` command so operators can inspect what the host can already do before reaching for new code.
- Active-run diagnostics for runtime status surfaces, including progress age, run identity, and pi process metadata for stuck-run debugging.
- Regression coverage for stale resumed pi runs and stdin-closure behavior in the runner lifecycle tests.

### Changed

- Routing now follows a capability-first policy: direct help, existing skills/capabilities, explicit commands/subagents, then coder fallback.
- Natural-language coder detection now recognizes farmer-style automation requests and treats coder as a fallback builder instead of the primary hammer.
- Interactive pi lifecycle policy now uses stale-run detection, shorter watchdog budgets, and fresh-session retry fallback for wedged resumed runs.
- Main prompt/skill guidance now explicitly prefers path-of-least-resistance behavior and surfaces the runtime capability map to the agent.

### Fixed

- Fixed a hang where `pi` could stall indefinitely when spawned with stdin left open, which caused rolling Telegram typing indicators and missing replies.
- Fixed stuck interactive runs so stalled resumed sessions are aborted, cleaned up, and retried with a fresh session instead of hanging for hours.
- Fixed Telegram/operator visibility gaps by exposing active run details through the control center and TUI runtime status APIs.

## [1.3.0] - 2026-03-30

### Added

- Canonical workspace contract centered on `NANO.md`, `SOUL.md`, `TODOS.md`, `HEARTBEAT.md`, `MEMORY.md`, and first-run `BOOTSTRAP.md`.
- Prompt-input logging and diagnostics for direct-session runs.
- Developer reasoning/autonomy benchmark at `docs/benchmarks/reasoning-autonomy-benchmark.md`.
- Local `gitleaks` scanning integrated into the tracked-file secret-scan flow.

### Changed

- Main workspace bootstrap, onboarding, and templates now treat `NANO.md` as the operating contract and keep `SOUL.md` focused on identity and tone.
- Runtime prompt/message handling and Telegram preview flow were simplified and consolidated for more deterministic behavior.
- Operator-facing docs and release docs now reflect the current install, onboarding, and workspace contract.

### Fixed

- Prevented infinite self-trigger loops and stale abort timestamps in direct-session handling.
- Fixed multiple Telegram preview and delivery edge cases, including duplicate replies, edit-failure fallback, long-text handling, and visible tool progress behavior.
- Corrected memory/runtime drift so `NANO.md` is indexed and patchable as operational guidance while `SOUL.md` remains stable.
- Improved bootstrapping consistency across seeded templates and onboarding defaults.

### Security

- Hardened OSS release hygiene with tracked-file secret scans, personal-path detection, and pack-content checks that exclude runtime state and local secrets from shipped artifacts.

## [1.2.0] - 2026-03-23

### Added

- **Architecture Simplification**: Major refactoring extracting modules from `index.ts`:
  - `src/app-state.ts` - All global mutable state, type definitions, and constants
  - `src/chat-preferences.ts` - Normalizers, queue parsing, preference persistence
  - `src/message-dispatch.ts` - Message processing and queue logic
  - `src/telegram-streaming.ts` - Visible Telegram preview registry
  - `src/telegram-commands.ts` - Telegram command handling and settings panels
  - `src/telegram-attachments.ts` - Telegram file attachment handling
  - `src/pi-runner.ts` - Pi subprocess spawning, sandbox wrapping, snapshots
  - `src/sandbox.ts` - Optional `bwrap`/Docker isolation for Pi runs
- **Runtime Event System**: Host-local event emission replacing file-based IPC for host-local operations
- **Developer Documentation**: `CLAUDE.md` with architecture overview and conventions
- **Command Spec System**: Type-safe command specification and parsing

### Changed

- Replaced `container-runner.ts` with unified `pi-runner.ts` + `sandbox.ts`
- Replaced `container/agent-runner/` with in-repo `src/` modules
- Architecture docs updated to reflect new module structure

### Fixed

- **Heartbeat**: Prevent streaming to Telegram to stop "HEARTBEAT_OK" message leak
- **Verbose Mode**: `/verbose/new` now shows only tool names without paths or arguments
- **Empty Output Policy**: Handle runs with tool side effects that return empty output

## [1.0.1] - 2026-02-15

### Added

- Release readiness workflow with secret scanning and release checks.
- Local release scripts (`secret-scan`, `release-check`, checksum generation).
- GitHub release template and release process documentation.

### Changed

- Canonicalized skill paths to `skills/setup` and `skills/runtime`.
- Updated skill PR workflow to validate `skills/` paths.

### Security

- Added tracked-file secret scanning gate.
- Added pack-content policy checks to prevent shipping local runtime/state files.

## [1.0.0] - 2026-02-15

### Added

- First public release baseline.
