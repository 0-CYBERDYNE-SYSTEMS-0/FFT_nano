# FFT_nano / NanoClaw Agent Notes

This repo is a single Node.js host process that:
- Receives chat messages (Telegram and/or WhatsApp)
- Stores chat metadata/messages in SQLite
- Runs the agent inside an isolated container via `pi` (pi-coding-agent)
- Sends the agent response back to the originating chat

## Memory Protocol

- Canonical memory file is `MEMORY.md` (per-group at `groups/<group>/MEMORY.md`, global at `groups/global/MEMORY.md`).
- `SOUL.md` is identity/policy context and should stay stable (not used as compaction log storage).
- Legacy `CLAUDE.md` is supported for backwards compatibility.

## Scripts

- One-time setup: `./scripts/setup.sh`
- Onboarding (workspace identity/bootstrap completion): `./scripts/onboard.sh [--workspace /abs/path] [--operator "Name"] [--assistant-name FarmFriend] [--non-interactive] [--force]`
- Start (normal): `./scripts/start.sh [start] [telegram-only]`
- Start (debug-only): `./scripts/start.sh dev [telegram-only]`
- Attach TUI client: `./scripts/start.sh tui` (host must already be running)
- Service lifecycle: `./scripts/service.sh <install|uninstall|start|stop|restart|status|logs>`
- Preferred CLI aliases (after `npm link`): `fft start`, `fft dev`, `fft tui`, `fft service <...>`
- Farm bootstrap (demo): `./scripts/farm-bootstrap.sh --mode demo`
- Farm bootstrap (production): `./scripts/farm-bootstrap.sh --mode production`
- Canonical operator runbook: `README.md` ("Quickstart (Primary UX Path)")

## Farm Modes (Demo vs Production)

- `demo` mode:
  - Uses `FFT_demo_dash` dashboard + simulated telemetry flow for showcase.
  - Fast path for proving end-to-end capabilities.
- `production` mode:
  - Runs Home Assistant onboarding with real entity discovery.
  - Writes `data/farm-profile.json` mappings.
  - Requires validation pass before host-side control actions are allowed.

Required env for farm flows:
- `FARM_MODE=demo|production`
- `FARM_PROFILE_PATH` (defaults to `data/farm-profile.json`)
- `FARM_STATE_ENABLED=true`
- `HA_URL`, `HA_TOKEN`
- `FFT_DASHBOARD_REPO_PATH`
- `FFT_DASHBOARD_REPO_URL` (companion source)
- `FFT_DASHBOARD_REPO_REF` (companion branch/SHA pin)

## Telegram As Main UI

Telegram is enabled when `TELEGRAM_BOT_TOKEN` is set.

Recommended local/dev setup (Telegram only):

```bash
export WHATSAPP_ENABLED=0
export TELEGRAM_BOT_TOKEN="..."
./scripts/start.sh telegram-only
```

Main channel behavior:
- `main` responds to all messages.
- Non-main chats only respond if the message starts with the trigger word (default `@FarmFriend`).
  - The trigger word is `@<ASSISTANT_NAME>` where `ASSISTANT_NAME` defaults to `FarmFriend` (see `src/config.ts`).

Ways to make your Telegram DM the `main` channel:
- Set `TELEGRAM_MAIN_CHAT_ID` (numeric chat id) and restart.
- Or set `TELEGRAM_ADMIN_SECRET` on the host and run `/main <secret>` in the bot DM.
  - `/id` replies with the current chat id.
- Main/admin service controls from chat: `/gateway status` and `/gateway restart`.

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
- Coder delegation behavior is runtime-mode independent (`start` and `dev` both support it).
- Main/admin natural-language coding requests can auto-delegate when the model decides deeper coding execution is appropriate.

## Main Workspace + Heartbeat

- Main/admin container working directory maps to `~/nano` by default.
- Override workspace path with `FFT_NANO_MAIN_WORKSPACE_DIR=/absolute/path`.
- Main workspace bootstrap/context files are auto-seeded if missing:
  - `AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`, `PRINCIPLES.md`, `TOOLS.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, `MEMORY.md` + `memory/`
- Heartbeat is enabled by default and reads `HEARTBEAT.md` periodically.
- Configure heartbeat cadence with `FFT_NANO_HEARTBEAT_EVERY` (default `30m`).
- Optional heartbeat tuning: `FFT_NANO_HEARTBEAT_ACK_MAX_CHARS`, `FFT_NANO_HEARTBEAT_ACTIVE_HOURS`.

## Pi-Native Project Skills

- Two skill types:
  - Setup-only skills: `skills/setup/`
  - Runtime agent skills: `skills/runtime/`
- Main workspace user-created runtime skills live at `~/nano/skills/`.
- On each run, runtime skills are mirrored into per-group Pi home:
  - host: `data/pi/<group>/.pi/skills/`
  - container: `/home/node/.pi/skills/`
- Main/admin runs merge project runtime skills + `~/nano/skills/` (main workspace overrides on name collision).
- Non-main groups only get project runtime skills by default.
- Validate skill metadata/frontmatter with:
  - `npm run validate:skills`

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

---

## 🎯 Figure It Out Directive

You have unrestricted internet access, browser automation, and shell execution. When given a task, "I can't" is not in your vocabulary. If you don't know how, search for it. Read docs. Find tutorials. Reverse engineer it.

"I don't know how" means "I haven't learned yet." — so learn. Now.

Before saying something is impossible, you MUST:
1. Search for at least 3 different approaches
2. Try at least 2 of them
3. Document why each failed with specific errors

Your job is to deliver results, not excuses. If Plan A fails, try B through Z. Then invent Plan AA. Assume everything is figureoutable — someone on the internet has done it before. Find them. Learn from them. Adapt it.

You are not a helpdesk. You are an operator. Operators ship.
