# Security Model

This page documents host-enforced controls implemented in code.

## 1. Runtime Isolation Boundary

Default runtime is Docker; optional host runtime exists only with explicit opt-in.

- Docker runtime: agent execution is isolated by mounts and container boundaries.
- Host runtime: no Docker isolation; host process still enforces routing, mount policy, IPC authorization, and env allowlists.

Host process controls:
- mounted paths
- env vars passed to runtime
- IPC routing and authorization

## 2. Single-Instance Lock

`acquireSingletonLock(data/fft_nano.lock)` prevents concurrent host polling loops.

Behavior:
- stale lock cleanup when pid no longer exists
- startup rejection when lock holder is alive

## 3. Mount Allowlist (External, Tamper-Resistant)

Allowlist path:
- `~/.config/fft_nano/mount-allowlist.json`

Why external:
- file lives outside mounted project tree, so runtime agent cannot modify policy through workspace access.

Validation checks (`src/mount-security.ts`):
- container path policy (no traversal, no absolute target escapes)
- host path existence + resolved realpath checks
- blocked-pattern rejection (`.ssh`, `.env`, credentials, key material)
- allowlisted-root containment
- non-main read-only enforcement when configured

## 4. Group Isolation via IPC Namespaces

Each group gets dedicated IPC namespace:
- `data/ipc/<group>/...`

Host authorization gates block cross-group control from non-main groups.

## 5. Main-Only Admin Controls

Main chat restrictions enforced in command/action paths:
- Telegram admin commands
- farm actions (`isMain=true` required)
- coding delegation (`/coder*`)

## 6. Production Farm Control Gate

For `FARM_MODE=production`, farm control actions are blocked unless profile validation is `pass`.

## 7. Memory File Access Guard

Memory action file reads are constrained to:
- `MEMORY.md`
- `memory/*.md`

Traversal attempts are rejected through normalized relative-path checks and base-dir containment checks.

## 8. Telegram Safety Guards

- message chunking within Telegram limits
- retry with bounded backoff for transient API errors
- inbound media size enforcement before persistence

## 9. Abort and Timeout Controls

Runtime runs are bounded with timeout and abort semantics:
- timeout via configured limits
- user abort support (`/stop`, subagent stop paths)
- escalation from `SIGTERM` to `SIGKILL` when needed
