![FFT_nano Logo](logo.png)

# FFT_nano

FarmFriend Terminal nano (`FFT_nano`) is a single-process Node.js host that runs an LLM agent inside a Linux container and routes chat I/O through Telegram and/or WhatsApp.

## What It Does

- Receives inbound chat messages
- Stores chat + scheduling metadata in SQLite
- Runs the agent in an isolated container (Apple Container on macOS, Docker on Linux)
- Uses `~/nano` as the main/admin workspace (configurable via `FFT_NANO_MAIN_WORKSPACE_DIR`)
- Persists non-main memory per group in `groups/<group>/MEMORY.md` (plus `groups/<group>/memory/*.md`)
- Sends agent output back to the originating chat

## Quickstart (Single-Repo Install)

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

Users only need this repo. Farm dashboard templates are auto-fetched by `farm-bootstrap.sh` from the FFT companion dashboard repository and pinned by commit for reproducible setup.

### 2. Configure `.env`

At minimum set your provider values for Pi runtime in the container.

Example (OpenAI):

```dotenv
PI_API=openai
PI_MODEL=gpt-4o-mini
OPENAI_API_KEY=replace-me
```

Recommended provider paths (top 4):

- OpenAI: `PI_API=openai`, `PI_MODEL=...`, `OPENAI_API_KEY=...`
- Anthropic: `PI_API=anthropic`, `PI_MODEL=...`, `ANTHROPIC_API_KEY=...`
- Gemini: `PI_API=gemini`, `PI_MODEL=...`, `GEMINI_API_KEY=...`
- OpenRouter: `PI_API=openrouter`, `PI_MODEL=...`, `OPENROUTER_API_KEY=...`

### 3. Start

Normal runtime (recommended):

```bash
./scripts/start.sh telegram-only
```

Explicit production-style start:

```bash
./scripts/start.sh start
```

Debug mode (optional, not required for coding delegation):

```bash
./scripts/start.sh dev telegram-only
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

## Raspberry Pi Startup (Raspberry Pi OS 64-bit)

FFT_nano runs on Pi as a Linux Docker deployment (not Apple Container).

Canonical Pi guide:
- `docs/RASPBERRY_PI.md`

### 1. Host prerequisites

```bash
sudo apt update
sudo apt install -y git curl ca-certificates
```

Install Node.js 20+:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

Install Docker + enable at boot:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
newgrp docker
sudo systemctl enable --now docker
docker info
```

### 2. Install FFT_nano

```bash
git clone https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano.git
cd FFT_nano
./scripts/setup.sh
cp .env.example .env
```

Fill `.env` with your provider and channel keys, then start:

```bash
./scripts/start.sh telegram-only
```

### 3. Optional: auto-start on reboot (systemd)

Create `/etc/systemd/system/fft-nano.service`:

```ini
[Unit]
Description=FFT_nano
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/FFT_nano
ExecStart=/usr/bin/env bash -lc './scripts/start.sh start telegram-only'
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Replace `User=pi` and `WorkingDirectory=/home/pi/FFT_nano` if your username/path differ.

Enable/start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now fft-nano
sudo systemctl status fft-nano
```

For full reboot validation, update procedure, and troubleshooting, use:
- `docs/RASPBERRY_PI.md`

## Farm Onboarding (Demo vs Production)

Farm onboarding uses four scripts:

- `scripts/farm-bootstrap.sh`
- `scripts/farm-demo.sh`
- `scripts/farm-onboarding.sh`
- `scripts/farm-validate.sh`

Bootstrap contract:

```bash
./scripts/farm-bootstrap.sh \
  --mode demo|production \
  --dash-path /abs/path \
  --ha-url http://localhost:8123 \
  --open-browser yes|no \
  --token <optional> \
  --companion-repo https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_demo_dash.git \
  --companion-ref <branch-or-commit>
```

Behavior:

- `demo`: starts HA + telemetry simulator and validates demo path.
- `production`: discovers entities, builds mapping profile, validates readiness.
- Companion dashboard repo is auto-cloned/pulled if missing/clean.
- Production control actions are blocked until validation status is `pass`.

Details: `docs/FARM_ONBOARDING.md`

## Telegram Operations

Telegram is enabled when `TELEGRAM_BOT_TOKEN` is set.

Recommended Telegram-only local/dev mode:

```bash
export WHATSAPP_ENABLED=0
export TELEGRAM_BOT_TOKEN="..."
./scripts/start.sh telegram-only
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

Main/admin chat normal-language runs can auto-delegate to coding worker when the model determines deep engineering work is needed (and can ask for clarification when ambiguous).
Delegation behavior is the same in both `start` and `dev` runtime modes.

## Main Workspace and Heartbeat

- Main/admin chat container CWD maps to `~/nano` by default.
- Override with `FFT_NANO_MAIN_WORKSPACE_DIR=/absolute/path`.
- Workspace bootstrap files are auto-seeded when missing: `AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`, `PRINCIPLES.md`, `TOOLS.md`, `HEARTBEAT.md`, `MEMORY.md` + `memory/`.
- Heartbeat loop is enabled by default (`30m`) and runs a main-session check using `HEARTBEAT.md`.
- Override cadence with `FFT_NANO_HEARTBEAT_EVERY` (e.g. `15m`, `1h`).

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

Per-group in `groups/<group>/MEMORY.md` (plus `groups/<group>/memory/*.md`);
global memory in `groups/global/MEMORY.md`.

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
