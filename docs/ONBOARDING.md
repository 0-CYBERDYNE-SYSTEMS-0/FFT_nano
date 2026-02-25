# Onboarding

`FFT_nano` includes an OpenClaw-style single command onboarding flow that runs:
backup -> setup -> onboarding wizard -> daemon step -> doctor.

## Commands

```bash
# guided wrapper (backup/setup/wizard/service/doctor)
./scripts/onboard-all.sh

# wizard-only
fft onboard
./scripts/onboard.sh

# non-interactive quickstart (safe defaults, no provider wiring)
./scripts/onboard-all.sh \
  --workspace ~/nano \
  --operator "Your Name" \
  --assistant-name OpenClaw \
  --non-interactive --accept-risk \
  --auth-choice skip --skip-channels --skip-ui \
  --no-install-daemon

# non-interactive advanced remote
./scripts/onboard-all.sh \
  --workspace ~/nano \
  --operator "Your Name" \
  --assistant-name OpenClaw \
  --non-interactive --accept-risk \
  --flow advanced --mode remote \
  --remote-url ws://127.0.0.1:18789 \
  --hatch later --no-install-daemon
```

Interactive mode prompts for flow/mode/provider/channel/hatch and identity values.

## Flags

- `--workspace <dir>`: target main workspace (default: `FFT_NANO_MAIN_WORKSPACE_DIR` or `~/nano`)
- `--env-path <file>`: env file to read/write (default: `./.env`)
- `--operator <name>`: value written to `USER.md` (and used to personalize `SOUL.md`)
- `--assistant-name <name>`: value written to `IDENTITY.md` (and used to personalize `SOUL.md`)
- `--non-interactive`: require explicit values via flags
- `--accept-risk`: required with `--non-interactive`; acknowledges runtime command/file mutation risk
- `--force`: rewrite `SOUL.md`, `USER.md`, and `IDENTITY.md` even if already customized
- `--flow <quickstart|advanced|manual>`
- `--mode <local|remote>`
- `--auth-choice <openai|anthropic|gemini|openrouter|zai|skip>`
- `--model <provider-model>`
- `--api-key <token>`
- `--remote-url <url>`
- `--gateway-port <port>`
- `--telegram-token <token>`
- `--whatsapp-enabled <0|1|true|false>`
- `--hatch <tui|web|later>`
- `--install-daemon` / `--no-install-daemon`
- `--skip-channels` / `--skip-skills` / `--skip-health` / `--skip-ui`
- `--skip-setup` (guided command only): skip install/build/container setup
- `--skip-restart` (guided command only): skip service restart
- `--skip-doctor` (guided command only): skip doctor check
- `--no-backup` (guided command only): skip preflight backup

## Behavior

1. Ensures core bootstrap files exist (`AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`, `PRINCIPLES.md`, `TOOLS.md`, `HEARTBEAT.md`, `MEMORY.md`; optional `BOOT.md` when enabled).
2. Writes onboarding identity values to `SOUL.md`, `USER.md`, and `IDENTITY.md` when files are default/empty (or when `--force` is used).
3. Preserves customized identity files on upgrades unless `--force` is set.
4. Preserves `BOOTSTRAP.md` for first-run conversational bootstrap.
5. Records bootstrap seeding in `.fft_nano/workspace-state.json`.
6. Records wizard run metadata in `.fft_nano/wizard-state.json`.
7. Updates the selected env file (`--env-path`) for provider/channel/remote URL settings.

## Privileges

- Wizard runtime actions (workspace edits, env edits, metadata writes) run with current user permissions.
- Daemon install/start/restart can require elevated privileges depending on host policy.
- `/gateway status|restart|doctor` is intentionally non-interactive and cannot prompt for sudo.
- If daemon actions fail from `/gateway` or `onboard-all`, run shell commands directly with required privileges:

```bash
./scripts/service.sh install
./scripts/service.sh restart
```

## Runtime Modes

- Default runtime is Docker (`CONTAINER_RUNTIME=auto` picks Docker when available).
- Optional host runtime (no container isolation) requires explicit opt-in:
  - `CONTAINER_RUNTIME=host`
  - `FFT_NANO_ALLOW_HOST_RUNTIME=1`
  - in production, also set `FFT_NANO_ALLOW_HOST_RUNTIME_IN_PROD=1`
- If Docker reports `EOF`, `Cannot connect`, or `no space left on device`, run:

```bash
./scripts/docker-recover.sh
```

## Profiles

Use `core` (default) or `farm` profile controls:

```bash
fft profile status
fft profile set core
fft profile apply farm
```
