# Onboarding

`FFT_nano` includes an fft_nano-style single command onboarding flow that runs:
backup -> setup -> onboarding wizard -> daemon step -> doctor.

## Commands

```bash
# guided wrapper (backup/setup/wizard/service/doctor)
./scripts/onboard-all.sh

# full guided wrapper (same behavior as onboard-all)
fft onboard

# wizard-only
./scripts/onboard.sh

# non-interactive quickstart (safe defaults, no provider wiring)
./scripts/onboard-all.sh \
  --workspace ~/nano \
  --operator "Your Name" \
  --assistant-name "AssistantName" \
  --non-interactive --accept-risk \
  --auth-choice skip --skip-channels --skip-ui \
  --no-install-daemon

# non-interactive advanced remote
./scripts/onboard-all.sh \
  --workspace ~/nano \
  --operator "Your Name" \
  --assistant-name "AssistantName" \
  --non-interactive --accept-risk \
  --flow advanced --mode remote \
  --remote-url ws://127.0.0.1:18789 \
  --hatch later --no-install-daemon
```

Config edit note:
- There is no dedicated `fft config` command.
- `fft onboard` runs the full guided wrapper (`onboard-all` path).
- Use `./scripts/onboard.sh` when you want wizard-only edits without backup/setup/doctor steps.

Interactive mode prompts for flow/mode/provider/channel/hatch and identity values.

If hatch is `web`, use:

```bash
fft web
# or ./scripts/web.sh
```

## Flags

- `--workspace <dir>`: target main workspace (default: `FFT_NANO_MAIN_WORKSPACE_DIR` or `~/nano`)
- `--env-path <file>`: env file to read/write (default: `./.env`)
- `--operator <name>`: value written into the generated `SOUL.md` identity profile
- `--assistant-name <name>`: assistant name written into the generated `SOUL.md` identity profile
- `--non-interactive`: require explicit values via flags
- `--accept-risk`: required with `--non-interactive`; acknowledges runtime command/file mutation risk
- `--force`: rewrite generated `SOUL.md` and `TODOS.md` even if already customized
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

Runtime gate env toggles:

- `FFT_NANO_WORKSPACE_ENFORCE_BOOTSTRAP_GATE=1|0` (default: `1`)
- `FFT_NANO_WORKSPACE_ENFORCE_BOOTSTRAP_GATE_EXISTING=1|0` (default: `0`)

## Behavior

1. Ensures core bootstrap files exist (`NANO.md`, `SOUL.md`, `TODOS.md`, `HEARTBEAT.md`, `MEMORY.md`, and first-run `BOOTSTRAP.md`; optional `BOOT.md` when enabled, plus legacy compatibility snapshots/templates as needed).
2. Writes onboarding identity values into `SOUL.md` and onboarding mission state into `TODOS.md` when files are default/empty (or when `--force` is used).
3. Preserves customized `SOUL.md` / `TODOS.md` content on upgrades unless `--force` is set.
4. Preserves `BOOTSTRAP.md` for first-run conversational bootstrap.
5. Main-chat bootstrap interview can be host-enforced while `BOOTSTRAP.md` is pending.
6. During enforced bootstrap, normal tasks are redirected into onboarding interview flow and `/coder` commands are blocked.
7. When onboarding is complete, agent should emit `ONBOARDING_COMPLETE`; host finalizes state and removes the token from user-visible output.
8. Soft rollout default: legacy pending workspaces are not retroactively gated unless `FFT_NANO_WORKSPACE_ENFORCE_BOOTSTRAP_GATE_EXISTING=1`.
9. Records bootstrap seeding in `.fft_nano/workspace-state.json`.
10. Records wizard run metadata in `.fft_nano/wizard-state.json`.
11. Updates the selected env file (`--env-path`) for provider/channel/remote URL settings.
12. Telegram `/main` first-claim shortcut: if no main chat exists yet and `TELEGRAM_ADMIN_SECRET` is unset, a direct Telegram DM can claim main with `/main`; set `TELEGRAM_ADMIN_SECRET` afterward and restart.

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
