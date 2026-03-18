---
name: edge-agent-install
description: Install and bootstrap lightweight Linux/Termux edge agents on constrained devices, covering binary, source, and container deployment paths.
compatibility: Linux or Android Termux targets, optional Go toolchain, optional Docker runtime.
license: Follow the license of the selected upstream agent runtime.
---

# Edge Agent Install

Use this skill for first-time installation and bootstrap of edge agents on low-resource Linux and Termux hosts.

## When to use this skill

- Use for first-time setup on small edge nodes and gateways.
- Use when choosing binary, source, or container install paths by device constraints.
- Use when onboarding credentials and runtime directories for a new node.

## When not to use this skill

- Do not use for day-2 maintenance of already-running edge agents.
- Do not use for server-class Rust agent deployments.
- Do not use for microcontroller firmware flashing.

## Guardrails

- Never run destructive git commands unless explicitly requested.
- Preserve unrelated worktree changes.
- Treat API keys, bot tokens, and device secrets as sensitive.
- Prefer reproducible install commands and pinned versions.

## Compatibility mappings

- PicoClaw install workflows map to this skill.
- Similar low-resource Linux/Termux agent runtimes also map here.

## Install paths

1. Precompiled binary path (preferred for constrained hardware):

```bash
# Download target-specific binary from the selected runtime releases page.
chmod +x ./agent-binary
./agent-binary onboard
```

2. Source build path:

```bash
git clone <agent-runtime-repo>
cd <agent-runtime>
make deps
make build
make install
```

3. Containerized path:

```bash
git clone <agent-runtime-repo>
cd <agent-runtime>
cp config/config.example.json config/config.json
# edit config/config.json with provider and channel secrets
docker compose up -d
```

4. Android Termux path:

```bash
pkg install proot
chmod +x ./agent-linux-arm64
termux-chroot ./agent-linux-arm64 onboard
```

## First-time onboard checklist

1. Run `onboard` with minimal required provider configuration.
2. Configure local runtime path and permissions.
3. Enable only required channels or integrations.
4. Keep inbound allowlists restrictive by default.

## Verification

```bash
agent status
agent run -m "hello"
```
