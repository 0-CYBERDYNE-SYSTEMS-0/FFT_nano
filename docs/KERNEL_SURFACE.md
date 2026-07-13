# Kernel Surface (Frozen)

This document is the growth contract for FFT_nano’s **host kernel**.

The host is a small operating system for a sandboxed coding agent. The kernel
owns a fixed surface. Product capability grows as **skills** and **scheduled
tasks**, not as new host subsystems.

Canonical code: `src/kernel-surface.ts`.

## Frozen primitives

| Surface | What is frozen | Extension path |
|--------|----------------|----------------|
| **Prompt layers** | `stable`, `session_bootstrap`, `ephemeral` | Adjust *content* of layers; do not add a fourth layer without kernel review |
| **Prompt modes** | `full`, `minimal`, `maintenance` | New modes are kernel changes |
| **Run origins** | `interactive-main`, `subagent`, `headless`, `evaluator`, `maintenance` | New origins require authority + gate updates |
| **IPC envelope kinds** | `message`, `task`, `action`, `action_result` | New kinds need watcher + boundary types |
| **IPC directories** | `messages`, `tasks`, `actions`, `action_results`, `deliver_files` | New dirs need host polling/processing |
| **IPC payload `type`s** | Listed in `KERNEL_IPC_PAYLOAD_TYPES` | Schema details can live in skills; type names are ABI |
| **Workspace contract files** | `NANO.md`, `SOUL.md`, `TODOS.md`, `HEARTBEAT.md`, `BOOT.md`, `BOOTSTRAP.md`, `MEMORY.md` | Put new guidance *inside* these files (or skills) |

## Prompt layer rules

- **stable** — identity/safety kernel + `SOUL.md` only (cacheable prefix).
- **session_bootstrap** — `NANO.md`, `MEMORY.md`, skill catalog, canonicals, daily memory (fresh/rebase only).
- **ephemeral** — inbound metadata, host overlay, `TODOS.md`, `HEARTBEAT.md`, retrieved memory (every turn).

## Growth rule

**Prefer:**

- New or improved skills under `skills/runtime/`
- Operator/agent scheduled tasks
- Workspace markdown content (NANO, TODOS, HEARTBEAT, memory)

**Avoid without an explicit kernel PR:**

- New prompt layers or modes
- New run origins
- New IPC envelope kinds or top-level payload type strings
- New top-level workspace contract filenames
- New always-on host loops for product features (use cron/tasks + skills)

## Related host modules (consumers)

- `src/system-prompt.ts` — prompt layers
- `src/run-authority.ts` — run origins / grants
- `src/runtime/boundary-ipc.ts` — envelopes
- `src/workspace-bootstrap.ts` — workspace file seeds
- `src/host-coordination.ts` — IPC watcher
