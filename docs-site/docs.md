# FFT_nano Developer Documentation

This docs set is implementation-anchored to `src/` and `container/agent-runner/src/`.

Scope:
- Host runtime internals (`src/*.ts`)
- Container runtime internals (`container/agent-runner/src/*.ts`)
- Operational scripts (`scripts/*.sh`)
- Storage contracts (SQLite + IPC + memory files)

Primary entry points:
- `src/index.ts` (host process orchestrator)
- `src/container-runner.ts` (container spawn + mount policy + env passthrough)
- `container/agent-runner/src/index.ts` (in-container pi runtime bridge)

## Quick Navigation

Core guides:
- [Gap Analysis: src vs old docs-site](developer/00-gap-analysis.md)
- [Architecture](developer/01-architecture.md)
- [Runtime Message Flow](developer/02-runtime-message-processing.md)
- [Container Runtime](developer/03-container-runtime.md)
- [Configuration and Env Vars](developer/04-config-env.md)
- [Telegram Integration](developer/05-telegram.md)
- [WhatsApp Integration](developer/06-whatsapp.md)
- [Scheduler and Tasks](developer/07-scheduler-and-tasks.md)
- [IPC Contracts](developer/08-ipc-contracts.md)
- [Memory System](developer/09-memory-system.md)
- [Farm Mode and Home Assistant](developer/10-farm-mode.md)
- [Security Model](developer/11-security-model.md)
- [Coding Delegation](developer/12-coding-delegation.md)
- [Data Models](developer/13-data-models.md)
- [Testing and Release](developer/14-testing-release.md)
- [Container Agent Runner](developer/15-agent-runner.md)
- [Scripts Reference](developer/16-scripts-reference.md)

Module reference pages (one page per source module):
- [Module Index](developer/module-index.md)

## Source-of-Truth Principle

If any statement in docs conflicts with code, code wins.

Validation strategy used in this docs rebuild:
1. Enumerate all modules under `src/`.
2. Enumerate exported APIs per module.
3. Enumerate runtime env variables referenced in code.
4. Map runtime command surfaces (`/help` command set, IPC JSON, scheduler types, farm actions).
5. Document behavior with direct file references.

## Snapshot

Repository baseline in this pass:
- Package: `fft_nano@1.0.1`
- Runtime: `node >=20`
- Host TypeScript LOC (`src/*.ts`): 9,858
- Primary host process: single Node process with Telegram and/or WhatsApp ingress, SQLite persistence, and containerized agent execution.

## Notes

- `docs-site/index.html` is now a navigation shell for this docs set.
- Old docs content was broad but mixed in non-implemented or stale details; see gap analysis for exact deltas.
