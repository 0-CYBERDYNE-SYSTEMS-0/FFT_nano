---
name: server-agent-ops
description: Operate and troubleshoot server-class agent runtimes, including gateway/daemon health, integration diagnostics, and controlled migrations.
compatibility: Installed server runtime with config access and host service manager permissions.
license: Follow the license of the selected upstream agent runtime.
---

# Server Agent Ops

Use this skill for day-2 operations of deployed server-class agent runtimes.

## When to use this skill

- Use for runtime health checks and incident triage.
- Use for gateway, daemon, and integration diagnostics.
- Use for controlled migration planning and execution.

## When not to use this skill

- Do not use for first-time source installation.
- Do not use for hardware flashing or serial CLI-only devices.
- Do not expose public gateways without an explicit security plan.

## Guardrails

- Never run destructive git commands unless explicitly requested.
- Preserve unrelated worktree changes.
- Keep sender allowlists strict by default.
- Require dry-run before any migration operation.

## Compatibility mappings

- ZeroClaw day-2 operations map to this skill.
- Similar server orchestration runtimes map here.

## Core operations

```bash
server-agent status
server-agent doctor
server-agent run -m "health check"
server-agent gateway
server-agent daemon
```

## Service lifecycle

```bash
server-agent service status
```

Use host service manager restart only after status and diagnostics are captured.

## Migration protocol

1. Run dry-run migration and review output.
2. Snapshot configs and runtime state.
3. Execute migration during approved window.
4. Validate channels and rollback path.

## Troubleshooting

1. No responses:
   - Verify status, integration auth, and allowlists.
2. Provider/model errors:
   - Recheck provider credentials and model support.
3. Security warnings:
   - Rebind gateway to local-only or protected ingress.
