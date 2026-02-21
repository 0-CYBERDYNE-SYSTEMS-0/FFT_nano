# IPC Contracts

IPC root on host: `data/ipc/<source-group>/`

Mounted inside container as: `/workspace/ipc`

Per-group subdirectories:
- `messages/`
- `tasks/`
- `actions/`
- `action_results/`

Error quarantine:
- `data/ipc/errors/`

## Message IPC (`messages/*.json`)

Writer: in-container agent
Reader: host `startIpcWatcher()`

Payload:
```json
{
  "type": "message",
  "chatJid": "telegram:123456",
  "text": "status update"
}
```

Authorization:
- main source group can message any registered chat
- non-main source group can message only chats mapped to same folder

## Task IPC (`tasks/*.json`)

### schedule_task
```json
{
  "type": "schedule_task",
  "prompt": "Check moisture",
  "schedule_type": "cron",
  "schedule_value": "0 * * * *",
  "context_mode": "isolated",
  "groupFolder": "main"
}
```

### pause/resume/cancel
```json
{ "type": "pause_task", "taskId": "task-..." }
{ "type": "resume_task", "taskId": "task-..." }
{ "type": "cancel_task", "taskId": "task-..." }
```

### refresh_groups (main only)
```json
{ "type": "refresh_groups" }
```

### register_group (main only)
```json
{
  "type": "register_group",
  "jid": "telegram:123456",
  "name": "Team Chat",
  "folder": "telegram-123456",
  "trigger": "@FarmFriend"
}
```

## Action IPC (`actions/*.json`)

Two action families are supported.

### Farm actions
`type: "farm_action"`

Required fields:
- `requestId`
- `action`
- `params`

Supported actions:
- `ha_get_status`
- `ha_call_service`
- `ha_set_entity`
- `ha_restart`
- `ha_apply_dashboard`
- `ha_capture_screenshot`
- `ha_dashboard_get`
- `ha_dashboard_patch`
- `ha_dashboard_validate`
- `ha_canvas_get_spec`
- `ha_canvas_set_spec`
- `ha_canvas_patch_spec`
- `farm_state_refresh`

Farm action parameter highlights:

- `ha_dashboard_get`
  - `{ dashboardFile?: string, viewPath?: string }`
  - default `dashboardFile`: `/workspace/dashboard/ui-lovelace-staging.yaml`
- `ha_dashboard_validate`
  - `{ dashboardFile?: string, content?: string, checkEntities?: boolean }`
  - exactly one of `dashboardFile` or `content` is required
- `ha_dashboard_patch`
  - `{ dashboardFile?: string, operations: DashboardPatchOp[], dryRun?: boolean }`
  - patch ops: `add_view|update_view|remove_view|add_card|update_card|remove_card|move_card|set_theme`
- `ha_apply_dashboard`
  - `{ stagingFile, targetFile?: string, backup?: boolean }`
  - default target file: `/workspace/dashboard/ui-lovelace.yaml`
  - default backup: `true`
- `ha_capture_screenshot`
  - `{ dashboard?: string, view?: string, zoom?: number, width?: number, height?: number, waitMs?: number, selector?: string }`
  - defaults: `width=1920`, `height=1080`, `waitMs=1200`
- `ha_canvas_get_spec`
  - `{ specFile?: string }`
- `ha_canvas_set_spec`
  - `{ specFile?: string, spec: CanvasSpec, title?: string }`
- `ha_canvas_patch_spec`
  - `{ specFile?: string, operations: CanvasPatchOp[] }`
  - patch ops: `add_card|update_card|remove_card|move_card|set_layout|set_title`

### Memory actions
`type: "memory_action"`

Supported actions:
- `memory_search`
- `memory_get`

Search params:
- `query`
- `topK`
- `sources` (`memory|sessions|all`)
- optional `groupFolder` (main only for cross-group)

Get params:
- `path` (allowed: `MEMORY.md` or `memory/*.md`)
- optional `groupFolder`

## Action Result Files

Result path:
- `action_results/<requestId>.json`

Farm result envelope:
```json
{
  "requestId": "req-1",
  "status": "success",
  "result": {},
  "executedAt": "2026-..."
}
```

Memory result envelope:
```json
{
  "requestId": "req-2",
  "status": "success",
  "result": {
    "hits": []
  },
  "executedAt": "2026-..."
}
```

## Snapshot Files (Host -> Container)

- `/workspace/ipc/current_tasks.json`
- `/workspace/ipc/available_groups.json` (main only contains data)

These are rewritten by host before runs and refresh operations.
