![FFT_nano Logo](logo.png)

# FFT_nano

[![Release](https://img.shields.io/github/v/release/0-CYBERDYNE-SYSTEMS-0/FFT_nano)](https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano/releases)
[![Release Readiness](https://img.shields.io/github/actions/workflow/status/0-CYBERDYNE-SYSTEMS-0/FFT_nano/release-readiness.yml?branch=main&label=release%20readiness)](https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano/actions/workflows/release-readiness.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

FarmFriend Terminal nano (`FFT_nano`) is a single-process Node.js host that runs an LLM agent inside a Linux container and routes chat I/O through Telegram and/or WhatsApp.

## What It Does

- Receives inbound chat messages
- Stores chat + scheduling metadata in SQLite
- Runs the agent in an isolated container (Apple Container on macOS, Docker on Linux)
- Uses `~/nano` as the main/admin workspace (configurable via `FFT_NANO_MAIN_WORKSPACE_DIR`)
- Persists non-main memory per group in `groups/<group>/MEMORY.md` (plus `groups/<group>/memory/*.md`)
- Sends agent output back to the originating chat

## Project Status

- Official distribution channel: **GitHub Releases**
- `npm install` is intentionally **not** the primary install path yet
- Current release process and checks: `docs/RELEASE.md`

Project links:

- Releases: https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano/releases
- Security policy: `.github/SECURITY.md`
- Contributing: `CONTRIBUTING.md`
- Support: `SUPPORT.md`
- Changelog: `CHANGELOG.md`

## Quickstart (Primary UX Path)

This is the canonical install-and-run flow.

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
- host service install/start by default (`FFT_NANO_AUTO_SERVICE=1`)

Users only need this repo. Farm dashboard templates are auto-fetched by `farm-bootstrap.sh` from the FFT companion dashboard repository and pinned by commit for reproducible setup.

### 2. Configure `.env` (minimum required)

At minimum set provider runtime values plus Telegram credentials.

Example (OpenAI + Telegram):

```dotenv
PI_API=openai
PI_MODEL=gpt-4o-mini
OPENAI_API_KEY=replace-me
TELEGRAM_BOT_TOKEN=replace-me
TELEGRAM_ADMIN_SECRET=replace-me
```

Recommended provider paths (top 4):

- OpenAI: `PI_API=openai`, `PI_MODEL=...`, `OPENAI_API_KEY=...`
- Anthropic: `PI_API=anthropic`, `PI_MODEL=...`, `ANTHROPIC_API_KEY=...`
- Gemini: `PI_API=gemini`, `PI_MODEL=...`, `GEMINI_API_KEY=...`
- OpenRouter: `PI_API=openrouter`, `PI_MODEL=...`, `OPENROUTER_API_KEY=...`

After editing `.env`, apply it by restarting the host:

```bash
./scripts/service.sh restart
# or, after `npm link`: fft service restart
```

### 3. Verify service health

```bash
./scripts/service.sh status
./scripts/service.sh logs
# or, after `npm link`: fft service status && fft service logs
```

If you disabled auto-service during setup (`FFT_NANO_AUTO_SERVICE=0`), install/start it manually:

```bash
./scripts/service.sh install
# or, after `npm link`: fft service install
```

### 4. Attach the TUI and begin onboarding

Install CLI aliases (optional):

```bash
npm link
```

Attach the terminal UI:

```bash
fft tui
# or: ./scripts/start.sh tui
```

Important: `fft tui` is an attach client. The host process must already be running.
`fft` auto-detects the repo from your current directory; use `--repo` to target another checkout:

```bash
fft --repo /absolute/path/to/FFT_nano tui
```

Complete workspace identity bootstrap once:

```bash
./scripts/onboard.sh --operator "Your Name" --assistant-name FarmFriend --non-interactive
```

This writes onboarding values into `USER.md` and `IDENTITY.md`, removes `BOOTSTRAP.md`, and marks onboarding complete in `.fft_nano/workspace-state.json`.

### 5. Claim Telegram as main/admin

In the bot DM:

1. Run `/id` to confirm chat id.
2. Run `/main <secret>` using `TELEGRAM_ADMIN_SECRET`.

Once claimed:

- main chat responds to all messages
- non-main chats require trigger `@<ASSISTANT_NAME>`
- admin controls (`/gateway`, `/tasks`, `/coder`, `/freechat`) are main-only

### Unified Command Reference

If you have not run `npm link`, use `./scripts/start.sh ...` and `./scripts/service.sh ...` equivalents.

Host CLI:

- `fft start [telegram-only]`
- `fft dev [telegram-only]`
- `fft tui [--url ws://127.0.0.1:28989] [--session main] [--deliver]`
- `fft service <install|uninstall|start|stop|restart|status|logs>`

TUI slash commands:

- `/help`
- `/status`
- `/sessions`
- `/session <key>`
- `/history [limit]`
- `/model <provider/model|model>`
- `/think <off|minimal|low|medium|high|xhigh>`
- `/reasoning <off|on|stream>`
- `/deliver <on|off>`
- `/gateway <status|restart>`
- `/new` (or `/reset`)
- `/abort`
- `/exit`

Telegram commands (main/admin subset):

- `/help`
- `/status`
- `/id`
- `/main <secret>`
- `/gateway <status|restart>`
- `/coder <task>`
- `/coder-plan <task>`
- `/tasks`

Service-control note:

- Linux may require elevated privileges for some service actions.
- Runtime `/gateway` commands are non-interactive; if privilege escalation is required and not configured, run `./scripts/service.sh ...` (or `fft service ...`) directly in a shell with sufficient permissions.

TUI keybinds:

- `Esc`: abort active run
- `Ctrl+C`: clear input (press twice quickly to exit)
- `Ctrl+D`: exit
- `Ctrl+T`: quick status
- `Ctrl+P`: quick sessions

TUI gateway env:

- `FFT_NANO_TUI_PORT` (default `28989`)
- `FFT_NANO_TUI_ENABLED` (`1` default, set `0` to disable)

TUI troubleshooting:

- `connect ECONNREFUSED 127.0.0.1:28989`: host is not running, wrong `FFT_NANO_TUI_PORT`, or gateway disabled.
- `EADDRINUSE` in host logs: selected TUI port is already in use; change `FFT_NANO_TUI_PORT`.
- `unknown session: main`: no main chat is registered yet; use `/sessions` and switch to an available session.

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

Canonical Pi guide (full runbook):
- `docs/RASPBERRY_PI.md`

Pi summary (aligned with the primary flow):

```bash
sudo apt update
sudo apt install -y git curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
# log out/in (or reboot), then:
sudo systemctl enable --now docker
docker info
git clone https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano.git
cd FFT_nano
./scripts/setup.sh
./scripts/service.sh status
./scripts/service.sh logs
```

`setup.sh` installs the service by default unless `FFT_NANO_AUTO_SERVICE=0`.

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

Pre-demo health check (PASS/FAIL):

```bash
npm run farm:doctor
```

Checks include Docker daemon, HA reachability/auth, `com.fft_nano` runtime status, and fresh `data/farm-state/current.json` with `haConnected=true`.

Details: `docs/FARM_ONBOARDING.md`

## Telegram Operations

Telegram is enabled when `TELEGRAM_BOT_TOKEN` is set.

Attached TUI still requires the host process to be running (for example `fft start`), even when Telegram is not configured.

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
- main/admin can query or restart host service with `/gateway status` and `/gateway restart`

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
- Default main memory and context files live outside this git repo (`~/nano`), which helps keep personal notes out of commits.
- `groups/main/` is intentionally kept as an empty placeholder in-repo; if you point main workspace into the repo, treat it as local-only and never commit personal memory/state files.
- Workspace bootstrap files are auto-seeded when missing: `AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`, `PRINCIPLES.md`, `TOOLS.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, `MEMORY.md` + `memory/` + `skills/`.
- Heartbeat loop is enabled by default (`30m`) and runs a main-session check using `HEARTBEAT.md`.
- Override cadence with `FFT_NANO_HEARTBEAT_EVERY` (e.g. `15m`, `1h`).
- If `HEARTBEAT.md` exists but is effectively empty (headers/comments only), heartbeat runs are skipped.
- Heartbeat acknowledgements are normalized with token stripping and max-ack gating (`FFT_NANO_HEARTBEAT_ACK_MAX_CHARS`, default `300`).
- Optional active-hours gate: `FFT_NANO_HEARTBEAT_ACTIVE_HOURS` (format: `HH:MM-HH:MM` or `Mon-Fri@HH:MM-HH:MM`).

Onboarding command options:

- `npm run onboard -- --workspace /abs/path --operator "Name" --assistant-name FarmFriend --non-interactive`
- `./scripts/onboard.sh --workspace /abs/path --operator "Name" --assistant-name FarmFriend --non-interactive`
- `--force` rewrites `USER.md` and `IDENTITY.md` even when already customized.

## Pi-Native Project Skills

Two skill types are supported:

- Setup-only skills:
  - `skills/setup/`
- Runtime skills used by the Pi agent:
  - `skills/runtime/`
- User-created runtime skills in main workspace:
  - `~/nano/skills/`

Runtime skills are mirrored into each group Pi home at runtime:

- host: `data/pi/<group>/.pi/skills/`
- container: `/home/node/.pi/skills/`

Merge rules:

- Main/admin runs: project runtime skills + `~/nano/skills/`
- Non-main runs: project runtime skills only
- If names collide, later source wins (`~/nano/skills/` overrides project on main)
- Only skills previously managed by FFT_nano are pruned on sync; manually installed skills are preserved.

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

## Release Checks

Run the release gate locally before tagging:

```bash
npm run release-check
```

This runs skills validation, typecheck, tests, and secret scanning over tracked files.

Versioning and official release flow are documented in `docs/RELEASE.md`.

## Distribution Policy

- Official distribution is **GitHub Releases** (source archives + checksums).
- npm publish is intentionally deferred until this repo ships a dedicated end-user CLI packaging path.

## Architecture (Short)

```text
Telegram/WhatsApp -> SQLite -> host router/scheduler -> containerized Pi runtime -> chat response
```

Core files:

- `src/index.ts` - channel ingestion, routing, admin command policy
- `src/container-runner.ts` - container spawn and mount wiring
- `container/agent-runner/src/index.ts` - in-container Pi execution
- `src/task-scheduler.ts` - scheduler mode switch (`v2` default, `legacy` fallback)
- `src/cron/` - cron v2 adapters and timer-based scheduler service
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

### Do I need legacy skill directories?

No. Use `skills/setup` and `skills/runtime` in this repo.

## Security Model

- Agent runs in Linux containers, not directly on host.
- Mounts define visibility boundaries.
- Additional mounts are validated against external allowlist at:
  - `~/.config/fft_nano/mount-allowlist.json`

See `docs/SECURITY.md` for full details.
