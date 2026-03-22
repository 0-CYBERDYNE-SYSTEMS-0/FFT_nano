# index

- Source file: `src/index.ts`
- Responsibility: main host orchestrator (ingress loops, command handling, runtime dispatch, IPC watcher, scheduler integration).

## Exported API

No exported symbols.

## Environment Variables Referenced (selected)

- `WHATSAPP_ENABLED`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_API_BASE_URL`
- `TELEGRAM_MAIN_CHAT_ID`
- `TELEGRAM_ADMIN_SECRET`
- `TELEGRAM_AUTO_REGISTER`
- `PI_API`
- `PI_MODEL`
- `FFT_NANO_HEARTBEAT_EVERY`

## Notable Internal Areas

- chat routing and queue behavior
- Telegram command policy and admin controls
- real coding worker orchestration (`/coder`, `/coding`, `/subagents`)
- onboarding gate integration
- IPC namespace authorization
- heartbeat scheduling and delivery
