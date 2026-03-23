---
name: server-agent-install
description: Install and bootstrap server-class agent runtimes from source, including toolchain checks, onboarding, and optional service registration.
compatibility: Linux, macOS, or Windows with required build toolchain and package manager.
license: Follow the license of the selected upstream agent runtime.
---

# Server Agent Install

Use this skill for first-time installation of server-class agent runtimes on workstation or datacenter hosts.

## When to use this skill

- Use for first-time source builds and runtime bootstrap.
- Use when provisioning a new orchestration or aggregation node.
- Use when installing system services for durable operations.

## When not to use this skill

- Do not use for day-2 incident response or diagnostics.
- Do not use for constrained edge device setup paths.
- Do not use for microcontroller flashing workflows.

## Guardrails

- Never run destructive git commands unless explicitly requested.
- Preserve unrelated worktree changes.
- Keep onboarding secrets out of repository files.
- Prefer locked dependency builds where available.

## Compatibility mappings

- ZeroClaw install workflows map to this skill.
- Similar server-agent source install workflows map here.

## Prerequisites

- Toolchain available for selected runtime (for example Rust or Go).
- Platform build essentials installed.
- Service manager access if background service install is required.

## Build and install

```bash
git clone <server-agent-repo>
cd <server-agent>
# Example for Rust-based runtime
cargo build --release --locked
cargo install --path . --force --locked
```

## Initial onboarding

```bash
server-agent onboard --interactive
```

Use non-interactive onboarding only when secret handling is already standardized.

## Verification

```bash
server-agent status
server-agent doctor
server-agent run -m "hello"
```

## Optional service bootstrap

```bash
server-agent service install
server-agent service status
```
