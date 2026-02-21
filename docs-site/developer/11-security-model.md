# Security Model

This page documents host-enforced controls implemented in code.

## 1. Runtime Isolation Boundary

Agent runs in container (`apple` or `docker`) and never directly in host process.

Host process controls:
- mounted paths
- env vars exposed to container
- IPC routing and authorization

## 2. Single-Instance Lock

`acquireSingletonLock(data/fft_nano.lock)` prevents multiple host processes from concurrent polling.

Behavior:
- stale lock cleanup if pid dead
- hard exit if active pid exists

## 3. Mount Allowlist (External, Tamper-Resistant)

Allowlist file path:
- `~/.config/fft_nano/mount-allowlist.json`

Why external:
- file is outside mounted project tree, so in-container agent cannot edit allowlist policy.

Validation checks (`src/mount-security.ts`):
- container path must be relative (no `..`, no absolute)
- host path must exist and resolve to real path
- blocked pattern rejection (`.ssh`, `.env`, credentials, keys, etc.)
- host path must fall under allowlisted root
- non-main read-only enforcement when configured

## 4. Group Isolation via IPC Namespaces

Each group has dedicated IPC dir:
- `data/ipc/<group>/...`

Host authorization gates:
- non-main source cannot send IPC message to another group's chat
- non-main source cannot schedule/control tasks for other groups
- non-main source cannot register groups or force group refresh
- non-main source cannot perform cross-group memory access

## 5. Main-Only Admin Controls

Main chat restrictions enforced in command and action paths:
- Telegram admin commands gated to main chat
- farm actions require `isMain=true`
- delegation commands (`/coder*`) are main-only

## 6. Production Farm Control Gate

For `FARM_MODE=production`, control actions are blocked until profile validation passes:
- `FARM_PROFILE_PATH` must exist
- JSON parse must succeed
- `validation.status` must equal `pass`

## 7. Memory File Access Guard

Memory action file reads are constrained to:
- `MEMORY.md`
- `memory/*.md`

Traversal attempts are rejected via normalized relative-path checks and resolved-path workspace containment checks.

## 8. Telegram Safety Guards

- chunked outbound sends within Telegram limits
- HTML parse failure fallback to plain text
- retry with backoff for transient API errors
- inbound media size enforcement before persistence

## 9. Graceful Abort and Timeout

Container runs:
- max runtime timeout
- user abort support via `/stop` and `/subagents stop`
- escalation from SIGTERM to SIGKILL if needed

These controls bound runaway model execution and hanging containers.
