# Data Models

Type contracts: `src/types.ts`
Database schema: `src/db.ts`

## Core Host Types

Key interfaces:
- `RegisteredGroup`
- `ContainerConfig`
- `ScheduledTask`
- `TaskRunLog`
- `NewMessage`
- `FarmActionRequest` / `FarmActionResult`
- `MemoryActionRequest` / `MemoryActionResult`

## SQLite Tables

### `chats`
- `jid` (PK)
- `name`
- `last_message_time`

### `messages`
- composite PK (`id`, `chat_jid`)
- `sender`
- `sender_name`
- `content`
- `timestamp`
- `is_from_me`

### `scheduled_tasks`
- task identity + schedule fields + run status fields

### `task_run_logs`
- per-run execution logs linked to `scheduled_tasks`

### `messages_fts` (FTS5 virtual table)
- content-backed index for transcript search
- triggers maintain sync on insert/update/delete

## Chat Runtime State (JSON)

`data/router_state.json`:
- `last_timestamp`
- `last_agent_timestamp` (per chat)
- `chat_run_preferences` (per chat overrides)
- `chat_usage_stats` (usage counters)

`data/registered_groups.json`:
- map from chat JID to group metadata

## Snapshot JSON Contracts

Task snapshot: `data/ipc/<group>/current_tasks.json`
- filtered list (all tasks for main, own tasks for non-main)

Group snapshot: `data/ipc/<group>/available_groups.json`
- full list only for main

Farm state files:
- `data/farm-state/current.json`
- `data/farm-state/alerts.json`
- `data/farm-state/devices.json`
- `data/farm-state/calendar.json`
- `data/farm-state/telemetry*.ndjson`

## Inbound Media Storage

Telegram media path (if accepted):
- `groups/<group>/inbox/telegram/<generated-filename>`

Message content gets augmented with an attachment marker containing workspace path and size.
