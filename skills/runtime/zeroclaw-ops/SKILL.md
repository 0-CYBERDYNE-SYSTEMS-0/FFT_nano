---
name: zeroclaw-ops
description: Operate and troubleshoot zeroclaw runtime services, including gateway, daemon, channel health, onboarding repair, and safe migration from OpenClaw.
compatibility: Installed zeroclaw binary and writable runtime/config directories.
license: Upstream zeroclaw is MIT licensed.
---

# ZeroClaw Ops

Use this skill for day-2 operations of deployed ZeroClaw nodes.

## When to use this skill

- Use for runtime health checks, channel diagnostics, and daemon/gateway ops.
- Use when repairing onboarding/channel config on existing deployments.
- Use for safe migration workflow from OpenClaw to ZeroClaw.

## When not to use this skill

- Do not use for first-time installation from source.
- Do not use when public gateway exposure is requested without tunnel/security plan.
- Do not use to skip dry-run on migration operations.

## Guardrails

- Never run destructive git commands unless explicitly requested.
- Preserve unrelated worktree changes.
- Keep inbound sender allowlists strict by default.
- Do not bind gateway publicly unless explicitly requested and tunnel-protected.

## Core Operations

```bash
zeroclaw status
zeroclaw doctor
zeroclaw channel doctor
zeroclaw agent -m "health check"
zeroclaw agent
zeroclaw gateway
zeroclaw daemon
```

Gateway hardening options:

```bash
zeroclaw gateway --port 0
```

## Channel and Integration Maintenance

- Use `zeroclaw onboard --channels-only` when auth/allowlist routing breaks.
- Use `zeroclaw integrations info Telegram` (or another channel) for setup details.
- If unauthorized sender warnings appear, update allowlists and re-run channels-only onboarding.

## Service Lifecycle

```bash
zeroclaw service install
zeroclaw service status
```

Restart service via host service manager if process health degrades.

## Migration from OpenClaw

Always dry-run first:

```bash
zeroclaw migrate openclaw --dry-run
zeroclaw migrate openclaw
```

Only execute real migration after dry-run output is reviewed.

## Troubleshooting

1. No replies:
   - Check `zeroclaw status` and `channel doctor`.
   - Verify channel tokens and allowlists.
2. Provider errors:
   - Validate API key/provider pair in config.
3. Security warnings:
   - Ensure gateway stays local or tunnel-protected.
4. Runtime issues on edge devices:
   - Use release binaries and avoid debug builds.
