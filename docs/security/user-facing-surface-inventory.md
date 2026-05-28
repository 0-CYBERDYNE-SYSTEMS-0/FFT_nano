# User-Facing Surface Inventory (Leak Control)

## User-facing surfaces

- `sendMessage` / `sendAgentResultMessage` outbound chat payloads (Telegram/WhatsApp)
- TUI websocket `chat_event` and `agent_event` frames
- TUI `chat.history` fetch responses
- Persisted assistant/user transcript rows used in UI/history
- Telegram preview draft/update/edit payloads
- Scheduled task result delivery payloads
- Heartbeat alert delivery payloads
- File delivery captions/errors returned to chat
- Coder/subagent summary/final messages delivered to chat
- Web Control Center runtime/status APIs
- Web Control Center `/api/logs/recent` response content

## Internal-only surfaces

- Runtime process logs on disk (`logs/fft_nano.log`, `logs/fft_nano.error.log`)
- Evaluator raw verdict output inside evaluator run context
- Internal telemetry structures before formatting
- IPC files prior to boundary translation/rejection

## Policy note

- `/api/logs/recent` is treated as user-facing because it is exposed by the web control center API.
- Internal logs may retain full evaluator verdict details, but `/api/logs/recent` must redact them.
