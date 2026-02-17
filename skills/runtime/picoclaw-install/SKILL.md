---
name: picoclaw-install
description: Install and bootstrap sipeed/picoclaw on low-resource Linux or Android Termux targets, including source build, binary setup, and initial onboarding.
compatibility: Linux, Android Termux, or Docker host; Go 1.21+ for source builds.
license: Upstream picoclaw is MIT licensed.
---

# PicoClaw Install

Use this skill when the user wants first-time installation or bootstrap of [sipeed/picoclaw](https://github.com/sipeed/picoclaw) on edge hardware.

## When to use this skill

- Use for first-time PicoClaw installation from binary, source, Docker, or Termux.
- Use when onboarding and initial config bootstrap are required.
- Use when selecting install path by device constraints.

## When not to use this skill

- Do not use for day-2 operations after installation is complete.
- Do not use for ESP32 firmware projects (use MimiClaw ops flow instead).
- Do not use without confirming the target platform and architecture.

## Guardrails

- Never run destructive git commands unless explicitly requested.
- Preserve unrelated worktree changes.
- Treat API keys and bot tokens as secrets.
- Prefer reproducible commands over ad-hoc edits.

## Install Paths

Choose one path based on target constraints.

1. Precompiled binary (fastest for devices):

```bash
# Download the correct release artifact from:
# https://github.com/sipeed/picoclaw/releases
chmod +x ./picoclaw-<platform>
./picoclaw-<platform> onboard
```

2. Build from source (development/latest):

```bash
git clone https://github.com/sipeed/picoclaw.git
cd picoclaw
make deps
make build
make install
```

3. Docker deployment:

```bash
git clone https://github.com/sipeed/picoclaw.git
cd picoclaw
cp config/config.example.json config/config.json
# edit config/config.json with provider and channel tokens
docker compose --profile gateway up -d
```

4. Android Termux (arm64):

```bash
wget https://github.com/sipeed/picoclaw/releases/download/<version>/picoclaw-linux-arm64
chmod +x picoclaw-linux-arm64
pkg install proot
termux-chroot ./picoclaw-linux-arm64 onboard
```

## First-Time Onboard

- Run `picoclaw onboard`.
- Configure `~/.picoclaw/config.json` with provider key and preferred model.
- Set channel credentials (Telegram/Discord/etc.) only if remote chat is needed.

## Verify Install

```bash
picoclaw status
picoclaw agent -m "hello"
```

For gateway mode:

```bash
picoclaw gateway
```

If gateway already occupies the port, stop duplicate instances before restarting.
