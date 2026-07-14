---
name: fft-host-ipc
description: Host IPC ABI for outbound messages, scheduler control, memory/skill actions, subagents, and file delivery. Use when writing JSON into the group IPC directories or when unsure of payload shapes.
---

# FFT Host IPC

The agent talks to the host only through filesystem IPC under the run's IPC
directory (see system prompt Workspace section for the path). Write atomically
(temp file then rename). Wait for `action_results/<requestId>.json` with
`status=success` before reporting completion for request/response actions.

## When to use this skill

- Sending proactive chat messages or run_progress updates
- Pausing/resuming/cancelling scheduled tasks or registering groups
- memory_search / memory_get / memory_write
- skill_list / skill_view / skill_create / skill_patch / skill_rollback
- Spawning a subagent
- Delivering files/photos back to Telegram

## When not to use this skill

- Ordinary file edits in the workspace (use tools directly)
- Reading SOUL/NANO/TODOS/MEMORY (already injected or on disk)
- Coding work that belongs in fft-coder-ops

## Messaging (`messages/*.json`)

Proactive message:

```json
{"type":"message","chatJid":"<jid>","text":"<text>"}
```

Run progress (no separate chat bubble):

```json
{"type":"run_progress","chatJid":"<jid>","requestId":"<current request_id>","text":"Run status: ...","phase":"thinking|tool_running|stale","detail":"..."}
```

## Scheduler (`current_tasks.json` + task JSON)

Read `current_tasks.json` when needed. Control tasks with:

- `{"type":"pause_task","taskId":"..."}`
- `{"type":"resume_task","taskId":"..."}`
- `{"type":"cancel_task","taskId":"..."}`
- Main-only: `{"type":"refresh_groups"}`
- Main-only: `{"type":"register_group","jid":"...","name":"...","folder":"...","trigger":"@AssistantName"}`

Task management scheduling is host-owned; prefer host/task surfaces over inventing new schedule formats.

## Memory actions (`actions/*.json` → `action_results/<requestId>.json`)

```json
{"type":"memory_action","action":"memory_search","requestId":"<id>","params":{"query":"...","topK":8,"sources":"all"}}
```

```json
{"type":"memory_action","action":"memory_get","requestId":"<id>","params":{"path":"MEMORY.md"}}
```

```json
{"type":"memory_action","action":"memory_write","requestId":"<id>","params":{"intent":"todo_upsert_task","payload":{"entryId":"T1","text":"...","status":"PENDING"}}}
```

For writes, wait for `status=success` before telling the user it stuck.

## Skill actions (`actions/*.json` → `action_results/<requestId>.json`)

Use skill_list/skill_view before reinventing a workflow. Mutations are host-gated
to agent-created runtime skills; repo and personal source skills are read-only.

```json
{"type":"skill_action","action":"skill_list","requestId":"<id>","params":{"includeArchived":false}}
```

```json
{"type":"skill_action","action":"skill_view","requestId":"<id>","params":{"name":"skill-name"}}
```

```json
{"type":"skill_action","action":"skill_create","requestId":"<id>","params":{"name":"short-skill-name","description":"When to use...","content":"---\nname: short-skill-name\ndescription: ...\n---\n\n# ..."}}
```

```json
{"type":"skill_action","action":"skill_patch","requestId":"<id>","params":{"name":"skill-name","content":"complete replacement SKILL.md"}}
```

```json
{"type":"skill_action","action":"skill_write_file","requestId":"<id>","params":{"name":"skill-name","filePath":"references/example.md","fileContent":"..."}}
```

```json
{"type":"skill_action","action":"skill_rollback","requestId":"<id>","params":{"name":"skill-name"}}
```

## Subagent (`actions/*.json` → `action_results/<requestId>.json`)

```json
{"type":"subagent_action","action":"spawn_subagent","requestId":"<id>","params":{"task":"clear, complete instructions for the subagent","mode":"execute"}}
```

- `mode`: `"execute"` (default, full tools) or `"plan"` (read-only)
- Poll `action_results/<requestId>.json` until `status=success`
- Subagents cannot spawn subagents

## File delivery (`deliver_files/*.json`)

```json
{
  "type": "farm_action",
  "action": "deliver_file",
  "requestId": "<unique-id>",
  "params": {
    "filePath": "path/to/file.jpg",
    "caption": "Optional caption text",
    "kind": "photo"
  }
}
```

- `filePath`: absolute or relative to group workspace
- `kind`: `photo` | `document` | `video` | `audio` (auto-detected if omitted)
- `chatJid`: optional; defaults to the group's registered chat
- Confirm `action_results/<requestId>.json` has `status=success` before reporting delivered

## Guardrails

- Never run destructive git commands unless the operator explicitly requests them.
- Preserve unrelated worktree changes.
- Atomic write only (temp + rename).
- Do not invent new top-level IPC `type` strings; host kernel freezes the ABI.
- Never claim delivery/mutation success without a success result file.

