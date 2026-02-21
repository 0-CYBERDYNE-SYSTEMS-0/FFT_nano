# Scheduler and Tasks

Primary files:
- `src/task-scheduler.ts`
- task IPC handling in `src/index.ts` (`processTaskIpc`)
- persistence in `src/db.ts`

## Task Schema

Stored table: `scheduled_tasks`

Fields:
- `id`
- `group_folder`
- `chat_jid`
- `prompt`
- `schedule_type`: `cron|interval|once`
- `schedule_value`
- `context_mode`: `group|isolated`
- `next_run`
- `last_run`
- `last_result`
- `status`: `active|paused|completed`
- `created_at`

## Scheduler Loop

`startSchedulerLoop(deps)`:
1. Poll due tasks every `SCHEDULER_POLL_INTERVAL`.
2. Re-fetch each due task by id (skip if paused/cancelled).
3. Run task via container agent.
4. Log run row into `task_run_logs`.
5. Compute next run:
   - `cron`: next CronExpression in `TIMEZONE`
   - `interval`: now + ms
   - `once`: null (marks completed)

## Task Execution Context

`runTask(task, deps)` resolves target group by `group_folder`.

If target group missing:
- logs error run
- does not execute

Before each task run:
- updates `current_tasks.json` snapshot in group IPC dir.

## IPC Task Operations

`processTaskIpc(...)` supports:
- `schedule_task`
- `pause_task`
- `resume_task`
- `cancel_task`
- `refresh_groups` (main only)
- `register_group` (main only)

Authorization model:
- non-main source group can only schedule/control tasks for itself
- main can control all groups
- task target chat JID is resolved from registered groups, not trusted directly from payload

## Schedule Validation Rules

- `cron`: parsed with `cron-parser`, timezone set to `TIMEZONE`
- `interval`: integer milliseconds > 0
- `once`: valid timestamp parse

Invalid schedule payload is rejected and logged.

## User Command Controls (Telegram Main)

Commands:
- `/tasks`
- `/task_pause <id>`
- `/task_resume <id>`
- `/task_cancel <id>`

These call DB mutation helpers directly after task existence checks.
