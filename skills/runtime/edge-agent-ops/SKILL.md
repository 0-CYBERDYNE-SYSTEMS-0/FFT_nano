---
name: edge-agent-ops
description: Operate and troubleshoot running edge agents on constrained Linux/Termux nodes, including health checks, gateway lifecycle, and secure config tuning.
compatibility: Installed edge runtime with writable config and logs on Linux or Termux.
license: Follow the license of the selected upstream agent runtime.
---

# Edge Agent Ops

Use this skill for day-2 operations of deployed edge agents on constrained nodes.

## When to use this skill

- Use for health checks, runtime diagnostics, and gateway lifecycle management.
- Use when tuning edge config for reliability and resource constraints.
- Use when recovering channel or provider connectivity on existing nodes.

## When not to use this skill

- Do not use for first-time installation and bootstrap.
- Do not use for server-side migration or service-install procedures.
- Do not use to broaden sender allowlists without explicit operator intent.

## Guardrails

- Never run destructive git commands unless explicitly requested.
- Preserve unrelated worktree changes.
- Keep inbound allowlists minimal.
- Never print full secret values in logs or chat output.

## Compatibility mappings

- PicoClaw day-2 operations map to this skill.
- Similar edge runtime operations map here.

## Core runtime commands

```bash
agent status
agent doctor
agent run -m "health check"
agent gateway
```

## Operational checks

1. Confirm process and channel status.
2. Verify a one-shot prompt roundtrip.
3. Check runtime directory and log writeability.
4. Review memory/CPU pressure for constrained hardware.

## Common fixes

1. No replies:
   - Verify token and sender allowlist.
   - Restart gateway and recheck logs.
2. Provider errors:
   - Validate provider key and model configuration.
3. Port conflicts:
   - Ensure only one gateway instance is active.
4. Resource pressure:
   - Reduce context window and token limits.
