# Onboarding CLI

`FFT_nano` now includes a host onboarding command that finalizes workspace bootstrap state in a deterministic way.

## Commands

```bash
npm run onboard -- --workspace ~/nano --operator "Your Name" --assistant-name FarmFriend --non-interactive
./scripts/onboard.sh --workspace ~/nano --operator "Your Name" --assistant-name FarmFriend --non-interactive
```

Interactive mode (no `--non-interactive`) prompts for operator and assistant name.

## Flags

- `--workspace <dir>`: target main workspace (default: `FFT_NANO_MAIN_WORKSPACE_DIR` or `~/nano`)
- `--operator <name>`: value written to `USER.md`
- `--assistant-name <name>`: value written to `IDENTITY.md`
- `--non-interactive`: require explicit values via flags
- `--force`: rewrite `USER.md` and `IDENTITY.md` even if already customized

## Behavior

1. Ensures core bootstrap files exist (`AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`, `PRINCIPLES.md`, `TOOLS.md`, `HEARTBEAT.md`, `MEMORY.md`).
2. Writes onboarding identity values to `USER.md` and `IDENTITY.md`.
3. Marks onboarding complete by removing `BOOTSTRAP.md`.
4. Updates `.fft_nano/workspace-state.json` with `onboardingCompletedAt`.

