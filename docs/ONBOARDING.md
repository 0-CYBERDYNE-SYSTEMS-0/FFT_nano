# Onboarding

`FFT_nano` includes an OpenClaw-style single command onboarding flow that runs:
backup -> setup -> workspace onboarding -> restart -> doctor.

## Commands

```bash
fft onboard --workspace ~/nano --operator "Your Name" --assistant-name OpenClaw --non-interactive
./scripts/onboard-all.sh --workspace ~/nano --operator "Your Name" --assistant-name OpenClaw --non-interactive

# identity-only onboarding (without setup/restart/doctor wrapper):
npm run onboard -- --workspace ~/nano --operator "Your Name" --assistant-name OpenClaw --non-interactive
./scripts/onboard.sh --workspace ~/nano --operator "Your Name" --assistant-name OpenClaw --non-interactive
```

Interactive mode (no `--non-interactive`) prompts for operator and assistant name.

## Flags

- `--workspace <dir>`: target main workspace (default: `FFT_NANO_MAIN_WORKSPACE_DIR` or `~/nano`)
- `--operator <name>`: value written to `USER.md` (and used to personalize `SOUL.md`)
- `--assistant-name <name>`: value written to `IDENTITY.md` (and used to personalize `SOUL.md`)
- `--non-interactive`: require explicit values via flags
- `--force`: rewrite `SOUL.md`, `USER.md`, and `IDENTITY.md` even if already customized
- `--skip-setup` (guided command only): skip install/build/container setup
- `--skip-restart` (guided command only): skip service restart
- `--skip-doctor` (guided command only): skip doctor check
- `--no-backup` (guided command only): skip preflight backup

## Behavior

1. Ensures core bootstrap files exist (`AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`, `PRINCIPLES.md`, `TOOLS.md`, `HEARTBEAT.md`, `MEMORY.md`; optional `BOOT.md` when enabled).
2. Writes onboarding identity values to `SOUL.md`, `USER.md`, and `IDENTITY.md` when files are default/empty (or when `--force` is used).
3. Preserves `BOOTSTRAP.md` for first-run conversational bootstrap.
4. Records bootstrap seeding in `.fft_nano/workspace-state.json`.

## Profiles

Use `core` (default) or `farm` profile controls:

```bash
fft profile status
fft profile set core
fft profile apply farm
```
