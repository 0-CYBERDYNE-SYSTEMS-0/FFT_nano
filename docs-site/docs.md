# FFT_nano Documentation

`FFT_nano` is a single Node.js host process that routes Telegram/WhatsApp messages, stores state in SQLite, and runs the agent with runtime selection (`docker` default via `auto`, optional `host` with explicit opt-in).

Canonical operator flow and command details live in `README.md`.

## Quickstart (Canonical)

```bash
git clone https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano.git
cd FFT_nano
./scripts/onboard-all.sh
```

Then verify:

```bash
./scripts/service.sh status
./scripts/service.sh logs
```

Attach TUI:

```bash
fft tui
```

## Config Setup/Edit

There is no dedicated `fft config` command.

Use onboarding wizard commands:

```bash
# full guided wrapper (same as onboard-all path)
fft onboard

# wizard-only
./scripts/onboard.sh
```

Full guided wrapper (backup/setup/wizard/service/doctor):

```bash
./scripts/onboard-all.sh
```

## Runtime Modes

- `CONTAINER_RUNTIME=auto` (default): uses Docker when available.
- `CONTAINER_RUNTIME=docker`: force Docker runtime.
- `CONTAINER_RUNTIME=host`: unisolated host runtime, requires `FFT_NANO_ALLOW_HOST_RUNTIME=1`.
- For production host runtime, also set `FFT_NANO_ALLOW_HOST_RUNTIME_IN_PROD=1`.

## Required Minimum Env

```dotenv
PI_API=openai|anthropic|gemini|openrouter|zai
PI_MODEL=<model-id>
# provider key matching PI_API, for example:
OPENAI_API_KEY=...

TELEGRAM_BOT_TOKEN=...
# strongly recommended:
TELEGRAM_ADMIN_SECRET=...
```

## Main/Admin Telegram Claim

In bot DM:
1. `/id`
2. `/main <secret>`

First-claim shortcut:
- If no main chat exists yet and `TELEGRAM_ADMIN_SECRET` is unset, direct DM `/main` can claim main.
- Set `TELEGRAM_ADMIN_SECRET` afterward and restart.

## Host CLI Surface

- `fft onboard [...]`
- `fft profile <status|set|apply> [core|farm]`
- `fft start [telegram-only]`
- `fft dev [telegram-only]`
- `fft tui [...]`
- `fft web [--open]`
- `fft doctor [--json]`
- `fft service <install|uninstall|start|stop|restart|status|logs>`

## Storage + Memory

- SQLite: `store/`
- Router/group state: `data/`
- Per-group memory: `groups/<group>/MEMORY.md` + `groups/<group>/memory/*.md`
- Global memory: `groups/global/MEMORY.md`
- Main workspace default: `~/nano` (override: `FFT_NANO_MAIN_WORKSPACE_DIR`)
- Per-group Pi state: `data/pi/<group>/.pi/`

## Docs Map

- `README.md`: operator quickstart + command reference
- `docs/ONBOARDING.md`: onboarding flow and flags
- `docs/RASPBERRY_PI.md`: Pi deployment specifics
- `docs/FARM_ONBOARDING.md`: farm demo/production flow
- `docs-site/developer/`: implementation-anchored developer docs

## Security References

- `.github/SECURITY.md`
- `docs-site/developer/11-security-model.md`
