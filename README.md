![FFT_nano Logo](logo.png)

# FFT_nano

FarmFriend Terminal nano (`FFT_nano`) is a single-process Node.js host that runs an LLM agent inside a Linux container and routes chat I/O through Telegram and/or WhatsApp.

## What It Does

- Receives inbound chat messages
- Stores chat + scheduling metadata in SQLite
- Runs the agent in an isolated container (Apple Container on macOS, Docker on Linux)
- Persists memory per group in `groups/<group>/SOUL.md`
- Sends agent output back to the originating chat

## Quickstart (Accurate)

### 1. Clone and bootstrap

```bash
git clone https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano.git
cd FFT_nano
./scripts/setup.sh
```

`./scripts/setup.sh` performs:

- dependency install (`npm ci` when lockfile exists)
- `npm run typecheck`
- `npm run build`
- agent image build (Apple Container or Docker, auto-detected)
- `.env` scaffold from `.env.example` (if missing)
- mount allowlist scaffold at `~/.config/fft_nano/mount-allowlist.json` (if missing)

### 2. Configure `.env`

At minimum set your provider values for Pi runtime in the container.

Example (`zai` / GLM):

```dotenv
PI_API=zai
PI_MODEL=glm-4.7
ZAI_API_KEY=replace-me
```

Other supported keys include:

- `PI_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `OPENROUTER_API_KEY`
- `GROQ_API_KEY`

### 3. Start

Telegram-only dev:

```bash
./scripts/start.sh dev telegram-only
```

General dev:

```bash
./scripts/start.sh dev
```

Production:

```bash
./scripts/start.sh start
```

If WhatsApp is enabled, authenticate once before first full run:

```bash
npm run auth
```

## Platform Notes

### macOS

- Preferred runtime is Apple Container when `container` is installed.
- If Apple Container is not running: `container system start`
- If LLM calls timeout on Apple Container networking:

```bash
container system stop
container system start
```

### Linux

- Docker is used by default.
- Ensure daemon health before start:

```bash
docker info
```

## Telegram Operations

Telegram is enabled when `TELEGRAM_BOT_TOKEN` is set.

Recommended Telegram-only local/dev mode:

```bash
export WHATSAPP_ENABLED=0
export TELEGRAM_BOT_TOKEN="..."
./scripts/start.sh dev telegram-only
```

Main/admin chat setup:

1. DM the bot and run `/id`
2. Set `TELEGRAM_ADMIN_SECRET` on host
3. Run `/main <secret>` in the bot DM

Alternative: set `TELEGRAM_MAIN_CHAT_ID` and restart.

Behavior:

- main chat responds to all messages
- non-main chats require trigger prefix `@<ASSISTANT_NAME>` (default `@FarmFriend`)
- admin and coder delegation commands are main-chat only

## Coding Delegation (`/coder`)

Main/admin chat supports explicit delegation triggers:

- `/coder <task>`: execute
- `/coder-plan <task>`: plan only
- aliases: `use coding agent`, `use your coding agent skill`

Natural-language coding requests do not auto-delegate.

## Pi-Native Project Skills

Project-local skills now live in:

- `.pi/skills/fft-setup`
- `.pi/skills/fft-debug`
- `.pi/skills/fft-telegram-ops`
- `.pi/skills/fft-coder-ops`

These are mirrored into each group Pi home at runtime:

- host: `data/pi/<group>/.pi/skills/`
- container: `/home/node/.pi/skills/`

Legacy `.claude/skills` is archive-only and not the active project skill source.

Detailed skill spec: `docs/PI_SKILLS.md`

Validate skill metadata/frontmatter:

```bash
npm run validate:skills
```

## Operations and Debugging

Useful env vars:

- `LOG_LEVEL=debug` for verbose host/container mount tracing
- `FFT_NANO_DRY_RUN=1` to bypass LLM calls and verify routing end-to-end

Useful paths:

- Host logs: `logs/fft_nano.log`, `logs/fft_nano.error.log`
- Group container logs: `groups/<group>/logs/`
- Group registry: `data/registered_groups.json`
- Router state: `data/router_state.json`
- Per-group Pi state: `data/pi/<group>/.pi/`

Common issues:

- Missing provider key -> Pi reports no models available
- Wrong provider/model combo -> model/provider not found
- Multiple bot instances -> Telegram polling conflict

## Development Checks

```bash
npm run validate:skills
npm run typecheck
npm test
```

## Architecture (Short)

```text
Telegram/WhatsApp -> SQLite -> host router/scheduler -> containerized Pi runtime -> chat response
```

Core files:

- `src/index.ts` - channel ingestion, routing, admin command policy
- `src/container-runner.ts` - container spawn and mount wiring
- `container/agent-runner/src/index.ts` - in-container Pi execution
- `src/task-scheduler.ts` - scheduled task execution loop
- `src/db.ts` - persistence

## Q&A

### Why does non-main chat not respond unless I mention `@FarmFriend`?

That is intentional. Only main responds to all messages; non-main requires trigger prefix.

### Why is `/coder` rejected in some chats?

Coder delegation is intentionally restricted to main/admin chat for safety.

### Where is long-term memory stored?

Per-group in `groups/<group>/SOUL.md`; global memory in `groups/global/SOUL.md`.

### Where does Pi session/auth state live?

Per group at `data/pi/<group>/.pi/`, mounted into container as `/home/node/.pi`.

### Do I need `.claude/skills`?

No. Active project skills are `.pi/skills/*`.

## Security Model

- Agent runs in Linux containers, not directly on host.
- Mounts define visibility boundaries.
- Additional mounts are validated against external allowlist at:
  - `~/.config/fft_nano/mount-allowlist.json`

See `docs/SECURITY.md` for full details.
