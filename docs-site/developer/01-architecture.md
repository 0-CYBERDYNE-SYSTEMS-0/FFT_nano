# Architecture

## System Shape

`fft_nano` is a single host Node.js runtime that:
1. Receives inbound messages from Telegram and/or WhatsApp.
2. Persists chat/task data in SQLite.
3. Builds prompt context and starts a containerized agent run.
4. Sends response text back to originating chat.
5. Handles host-side task scheduling, memory actions, and farm actions through IPC.

Primary orchestrator: `src/index.ts`.

## Core Runtime Components

Host modules:
- `src/index.ts`: lifecycle, message loops, Telegram commands, IPC watcher, scheduler startup, heartbeat, delegation routing.
- `src/container-runner.ts`: mounts, env passthrough, container command args, output parsing, error/timeout handling.
- `src/db.ts`: SQLite schema + query helpers + transcript FTS.
- `src/task-scheduler.ts`: due-task polling + task execution loop.
- `src/telegram.ts`: Telegram Bot API poll/send/download abstraction.
- `src/farm-state-collector.ts`: periodic Home Assistant snapshots and telemetry files.
- `src/farm-action-gateway.ts`: allowlisted farm action dispatcher with production gates.
- `src/memory-*.ts`: retrieval, search, paths, maintenance, IPC memory actions.

Container modules:
- `container/agent-runner/src/index.ts`: reads JSON stdin, assembles system prompt, runs `pi`, emits JSON output markers.
- `container/agent-runner/src/coder-worker.ts`: delegated coding worker flow.
- `container/agent-runner/src/memory-tool.ts`: IPC helper CLI for memory search/get.

## Runtime Topology

```text
Telegram/WhatsApp -> src/index.ts
                   -> src/db.ts
                   -> src/container-runner.ts
                   -> container runtime (apple|docker)
                   -> container/agent-runner/src/index.ts -> pi
                   -> src/index.ts sendMessage()
                   -> Telegram/WhatsApp
```

## Data and State Directories

Host paths:
- `store/messages.db`: chat/messages/task/task_run_logs + FTS index.
- `data/router_state.json`: last processed timestamps + chat runtime prefs + usage stats.
- `data/registered_groups.json`: jid -> registered group metadata.
- `data/ipc/<group>/...`: per-group IPC queues and snapshots.
- `groups/<group>/...`: per-group memory/log/inbox workspace for non-main groups.
- main workspace: `~/nano` by default (`FFT_NANO_MAIN_WORKSPACE_DIR` override).

## Main vs Non-Main Isolation

Main group (`folder=main`):
- Gets project root mounted at `/workspace/project`.
- Gets main workspace mounted at `/workspace/group`.
- Can execute admin-only commands and cross-group actions.

Non-main groups:
- Only group folder mounted at `/workspace/group`.
- Global memory mounted read-only at `/workspace/global`.
- Restricted by trigger policy and IPC authorization checks.

## Startup Sequence (Simplified)

From `main()` in `src/index.ts`:
1. Register shutdown handlers.
2. Acquire singleton lock (`data/fft_nano.lock`).
3. Ensure container runtime availability.
4. Initialize DB.
5. Load persisted runtime state.
6. Migrate legacy memory/compaction files.
7. Optionally start farm-state collector.
8. Start Telegram (if configured).
9. Start scheduler, IPC watcher, heartbeat, and message loop.
10. Connect WhatsApp (if enabled).

## Availability and Reliability Behaviors

- At-least-once message processing semantics via timestamp progression only after successful processing.
- Container run timeout guard (`CONTAINER_TIMEOUT`).
- Optional Apple Container self-heal restart on network timeout-like failures.
- Single-instance lock to prevent parallel polling conflicts.
