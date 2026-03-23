---
name: agent-swarm-ops
description: Coordinate multi-agent systems across edge, server, and microcontroller runtimes with topology design, rollout control, and fleet incident response.
compatibility: Heterogeneous deployments combining at least two agent runtime tiers.
license: Internal orchestration guidance; defer to each runtime's license for tooling.
---

# Agent Swarm Ops

Use this skill for cross-runtime orchestration and fleet-level operations.

## When to use this skill

- Use when coordinating more than one runtime tier.
- Use for fleet rollout sequencing, health aggregation, and incident command.
- Use when defining responsibilities and communication patterns across agent roles.

## When not to use this skill

- Do not use for single-runtime install detail work.
- Do not use as a replacement for stack-specific troubleshooting runbooks.
- Do not use to bypass change control for production fleet updates.

## Guardrails

- Never run destructive git commands unless explicitly requested.
- Preserve unrelated worktree changes.
- Require clear rollback criteria before multi-node rollout.
- Treat control-plane credentials and messaging keys as sensitive.

## Runtime role map

- Edge tier: low-latency local sensing and actuation.
- Server tier: policy, orchestration, aggregation, and heavy compute.
- MCU tier: firmware-level control and low-power edge interaction.

## Compatibility mappings

- PicoClaw aligns to edge tier.
- ZeroClaw aligns to server tier.
- MimiClaw aligns to MCU tier.

## Topology patterns

1. Hub-and-spoke:
   - Server tier as orchestration hub, edge/MCU as spokes.
2. Hierarchical edge:
   - Regional edge hubs forward summarized state upstream.
3. Isolated cells:
   - Independent cells with delayed state synchronization.

## Fleet rollout procedure

1. Define canary group and success metrics.
2. Apply change to canary only.
3. Validate health and message latency.
4. Expand rollout in controlled batches.
5. Keep rollback command path ready at each stage.

## Fleet health checklist

1. Control-plane reachability.
2. Per-tier process or firmware heartbeat.
3. Queue/backlog depth and retry rates.
4. Authentication and allowlist integrity.
5. Drift between intended and observed configuration.

## Incident command flow

1. Classify scope: single node, tier, or full fleet.
2. Freeze nonessential changes.
3. Contain blast radius by segment.
4. Recover critical paths first.
5. Run post-incident review with remediation tasks.
