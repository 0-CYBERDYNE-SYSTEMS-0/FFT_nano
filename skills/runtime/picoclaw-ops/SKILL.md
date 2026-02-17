---
name: picoclaw-ops
description: Operate, troubleshoot, and maintain running sipeed/picoclaw nodes, including agent, gateway, channel allowlists, and config tuning.
compatibility: PicoClaw runtime with access to ~/.picoclaw/config.json or docker-compose deployment.
license: Upstream picoclaw is MIT licensed.
---

# PicoClaw Ops

Use this skill for day-2 PicoClaw operations on edge devices.

## When to use this skill

- Use for runtime health checks, gateway lifecycle, and channel reliability.
- Use when tuning config and allowlists on deployed PicoClaw nodes.
- Use for operational troubleshooting after install is complete.

## When not to use this skill

- Do not use for initial installation/bootstrap from scratch.
- Do not use for unsupported platform flashing workflows.
- Do not use to broaden allowlists without explicit operator intent.

## Guardrails

- Never run destructive git commands unless explicitly requested.
- Preserve unrelated worktree changes.
- Keep channel allowlists restrictive by default.
- Never expose secrets in logs or chat responses.

## Core Runtime Commands

```bash
picoclaw status
picoclaw agent -m "test message"
picoclaw agent
picoclaw gateway
```

Docker runtime:

```bash
docker compose --profile gateway up -d
docker compose logs -f picoclaw-gateway
docker compose --profile gateway down
```

## Operational Configuration

Primary config file:

- `~/.picoclaw/config.json`

Key areas to manage:

- Provider credentials and API base.
- Default model and token limits.
- Channel tokens (Telegram, Discord, etc.).
- `allowFrom`/allowlist identities for inbound chat safety.

## Health Checks

1. Run `picoclaw status`.
2. Send a one-shot prompt with `picoclaw agent -m`.
3. If channel-connected, verify message roundtrip via gateway logs.
4. Confirm memory/workspace directories remain writable.

## Common Fixes

1. No channel replies:
   - Recheck bot token.
   - Confirm allowlist IDs are correct.
   - Restart gateway.
2. Provider/model errors:
   - Validate API key.
   - Switch to a known-good model in config.
3. Port conflicts:
   - Ensure only one gateway instance is active.
4. Resource pressure on tiny hardware:
   - Lower context/token settings.
   - Prefer lightweight model routes.
