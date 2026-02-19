# Cron V2 Compatibility Layer

`FFT_nano` supports both legacy scheduler payloads and the new cron v2-style task fields.

## Mode Switch

- `FFT_NANO_SCHEDULER_MODE=v2` (default): timer-based scheduler with backoff and v2 fields.
- `FFT_NANO_SCHEDULER_MODE=legacy`: old fixed poll scheduler loop.

## IPC Payloads

Legacy payloads remain valid:

```json
{
  "type": "schedule_task",
  "prompt": "Do thing",
  "schedule_type": "cron",
  "schedule_value": "0 9 * * 1",
  "context_mode": "isolated",
  "groupFolder": "main"
}
```

V2 payloads are also accepted:

```json
{
  "type": "schedule_task",
  "prompt": "Do thing",
  "schedule": { "kind": "every", "everyMs": 3600000 },
  "context_mode": "isolated",
  "session_target": "isolated",
  "wake_mode": "now",
  "delivery": { "mode": "announce" },
  "timeout_seconds": 120,
  "stagger_ms": 2000,
  "delete_after_run": false,
  "groupFolder": "main"
}
```

## Added Task Columns

`scheduled_tasks` now includes additive nullable fields:

- `schedule_json`
- `session_target`
- `wake_mode`
- `delivery_mode`
- `delivery_channel`
- `delivery_to`
- `delivery_webhook_url`
- `timeout_seconds`
- `stagger_ms`
- `delete_after_run`
- `consecutive_errors`

Legacy rows remain valid and continue to execute.

## Behavior Notes

- `context_mode=isolated` forces fresh scheduled runs (`noContinue=true`).
- `context_mode=group` allows session continuation (`noContinue=false`).
- Repeated task failures apply exponential backoff.
- `wake_mode=now` requests an immediate heartbeat run after task execution.
- Delivery modes:
  - `none`: no post-run message
  - `announce`: posts summary to task chat
  - `webhook`: POSTs JSON payload to `delivery_webhook_url`

