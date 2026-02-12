# FFT_nano / NanoClaw Agent Notes

This repo is a single Node.js host process that:
- Receives chat messages (Telegram and/or WhatsApp)
- Stores chat metadata/messages in SQLite
- Runs the agent inside an isolated container via `pi` (pi-coding-agent)
- Sends the agent response back to the originating chat

## Memory Protocol

- Canonical memory file is `SOUL.md` (per-group at `groups/<group>/SOUL.md`, global at `groups/global/SOUL.md`).
- Legacy `CLAUDE.md` is supported for backwards compatibility.

## Scripts

- One-time setup: `./scripts/setup.sh`
- Start (dev): `./scripts/start.sh dev [telegram-only]`
- Start (prod): `./scripts/start.sh start`

## Telegram As Main UI

Telegram is enabled when `TELEGRAM_BOT_TOKEN` is set.

Recommended local/dev setup (Telegram only):

```bash
export WHATSAPP_ENABLED=0
export TELEGRAM_BOT_TOKEN="..."
./scripts/start.sh dev telegram-only
```

Main channel behavior:
- `main` responds to all messages.
- Non-main chats only respond if the message starts with the trigger word (default `@FarmFriend`).
  - The trigger word is `@<ASSISTANT_NAME>` where `ASSISTANT_NAME` defaults to `FarmFriend` (see `src/config.ts`).

Ways to make your Telegram DM the `main` channel:
- Set `TELEGRAM_MAIN_CHAT_ID` (numeric chat id) and restart.
- Or set `TELEGRAM_ADMIN_SECRET` on the host and run `/main <secret>` in the bot DM.
  - `/id` replies with the current chat id.

## Z.AI (GLM) Provider For Pi Runtime

The agent runs in a container. LLM credentials must be provided to the container via the allowlisted env passthrough.

Use `.env` at repo root for the container runtime:

```dotenv
PI_API=zai
PI_MODEL=glm-4.7
ZAI_API_KEY=...
```

Notes:
- Avoid committing secrets. `.env` is gitignored.
- `pi` session/auth/model state is stored per group under `data/pi/<group>/.pi/` on the host and mounted to `/home/node/.pi` in the container.

## Coding Agent (/coder)

- In the main/admin chat you can use: `@FarmFriend /coder <task>`.
- The coder profile streams progress back to the same originating chat when possible, and avoids duplicating the final answer.

## Debugging / Tracing

Useful env vars on the host:
- `LOG_LEVEL=debug` to log container args/mounts and write verbose container logs.
- `FFT_NANO_DRY_RUN=1` to bypass LLM calls and smoke-test end-to-end routing.

Container logs:
- Per-group logs at `groups/<group-folder>/logs/`.

Common failure modes:
- Missing provider key: `pi` reports "No models available" (no API key passed through).
- Wrong `PI_API`/`PI_MODEL`: `pi` reports "Model '<provider>'/'<model>' not found".
- Multiple instances: Telegram polling can error with "Conflict: terminated by other getUpdates request". FFT_nano now uses a lock file (`data/fft_nano.lock`) to prevent two instances from running at once.
- Apple Container networking: if you see `Request timed out.`, restart Apple Container: `container system stop && container system start` (or rely on `FFT_NANO_APPLE_CONTAINER_SELF_HEAL=1` default).
