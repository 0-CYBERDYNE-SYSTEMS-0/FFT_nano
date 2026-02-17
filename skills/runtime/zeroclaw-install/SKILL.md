---
name: zeroclaw-install
description: Install and bootstrap zeroclaw-labs/zeroclaw from source on edge or server targets, including Rust toolchain setup, onboarding, and service registration.
compatibility: Rust stable toolchain and cargo available; Linux, macOS, or Windows build environment.
license: Upstream zeroclaw is MIT licensed.
---

# ZeroClaw Install

Use this skill for first-time setup of [zeroclaw-labs/zeroclaw](https://github.com/zeroclaw-labs/zeroclaw).

## When to use this skill

- Use for first-time Rust build/install and onboarding of ZeroClaw.
- Use when provisioning service/runtime on new edge or server nodes.
- Use when validating prerequisites before deployment.

## When not to use this skill

- Do not use for ongoing runtime operations after install is complete.
- Do not use for PicoClaw or MimiClaw-specific install flows.
- Do not use without a compatible Rust toolchain environment.

## Guardrails

- Never run destructive git commands unless explicitly requested.
- Preserve unrelated worktree changes.
- Keep API keys and channel tokens secret.
- Prefer locked builds for reproducibility.

## Prerequisites

- Rust stable toolchain (`rustup`, `cargo`).
- Platform build essentials (Xcode CLT on macOS, build-essential on Linux, MSVC Build Tools on Windows).

## Build and Install

```bash
git clone https://github.com/zeroclaw-labs/zeroclaw.git
cd zeroclaw
cargo build --release --locked
cargo install --path . --force --locked
export PATH="$HOME/.cargo/bin:$PATH"
```

Dev fallback (without global install):

```bash
cargo run --release -- status
```

## Initial Onboarding

Non-interactive:

```bash
zeroclaw onboard --api-key sk-... --provider openrouter
```

Interactive or channel-only repair:

```bash
zeroclaw onboard --interactive
zeroclaw onboard --channels-only
```

## Verify

```bash
zeroclaw status
zeroclaw doctor
zeroclaw agent -m "hello"
```

Optional service bootstrap:

```bash
zeroclaw service install
zeroclaw service status
```
