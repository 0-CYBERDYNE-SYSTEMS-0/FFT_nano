# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
