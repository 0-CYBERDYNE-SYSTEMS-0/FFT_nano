# FFT_nano vs OpenClaw Gap Reference

Last updated: 2026-02-23

Snapshot commits:
- `fft_nano`: `bb1aeee`
- `nanoclaw` upstream (`qwibitai/main`): `226b520`
- `openclaw/openclaw`: `5196565`

## Why this file exists

This is the persistent reference doc for:
- The 3-repo comparison (`fft_nano`, `nanoclaw`, `openclaw`)
- The deep gap analysis between `fft_nano` and `openclaw`
- A practical plan to make `fft_nano` as close as possible to `openclaw` behavior while preserving farm customizations

---

## Part 1: 3-Repo Compare (Saved Reference)

### Product shape

- `nanoclaw`: small, minimal, "edit the code directly" personal assistant.
- `openclaw`: full gateway platform with many channels, agents, policies, tools, and docs.
- `fft_nano`: farm/operator-focused fork that keeps the small-host idea but adds structured workspace/memory and farm flows.

### Onboarding

- `nanoclaw`: setup skill + scripts (`/setup` flow).
- `openclaw`: first-class wizard (`openclaw onboard`) for workspace, channels, daemon, skills, health.
- `fft_nano`: deterministic onboarding CLI (`scripts/onboard.sh`) with workspace-state tracking in `.fft_nano/workspace-state.json`.

### Workspace files

- `nanoclaw`: primarily `CLAUDE.md` (root + per-group/global).
- `openclaw`: standard workspace set (`AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`, `TOOLS.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, optional `BOOT.md`, `MEMORY.md`, `memory/`).
- `fft_nano`: similar structured set, plus `PRINCIPLES.md`; seeds `NANO.md`, `SOUL.md`, `TODOS.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, `MEMORY.md`, `memory/`, `skills/` for the main workspace while retaining legacy compatibility docs/templates.

### Memory model

- `nanoclaw`: durable but simple (`CLAUDE.md` + files), no broad memory subsystem docs.
- `openclaw`: full memory system (`MEMORY.md` + `memory/YYYY-MM-DD.md`, `memory_search`, `memory_get`, compaction memory flush, vector options).
- `fft_nano`: canonical `MEMORY.md` per-group/global + `memory/`; explicit `SOUL.md` split; includes migration from legacy `CLAUDE.md`.

### Heartbeat

- `nanoclaw`: no first-class heartbeat subsystem contract.
- `openclaw`: first-class heartbeat with targeting, visibility controls, per-agent config, active-hours timezone handling.
- `fft_nano`: first-class heartbeat loop, `HEARTBEAT.md` reading, empty-file skip, ack stripping, active-hours gate.

### Cron

- `nanoclaw`: simpler scheduler loop over `scheduled_tasks`.
- `openclaw`: full cron jobs/wakeups with delivery/session modes and dedicated persisted cron store.
- `fft_nano`: cron v2 compatibility layer over DB tasks with schedule/session/wake/delivery/backoff/stagger/delete-after-run support.

---

## Part 2: Deep Compare (`fft_nano` vs `openclaw`)

ELI vibe-coder framing:
- `openclaw` is an assistant operating system.
- `fft_nano` is a tuned assistant appliance.
- Goal state = keep appliance ergonomics, but copy OS-grade primitives where they matter.

## 2.1 Memory

### What `openclaw` has

- Workspace memory contract: daily logs + curated memory.
- `memory_search` + `memory_get` with pluggable memory backend behavior.
- Explicit compaction memory flush logic (silent pre-compaction write prompt).
- Vector memory paths and optional QMD sidecar flow.
- Missing-file-safe memory reads in docs/behavior.

### What `fft_nano` has today

- Canonical `MEMORY.md` and `memory/*.md` per group.
- `memory_action` gateway exposing `memory_search` + `memory_get`.
- Lexical document ranking + transcript FTS merge (`sources: memory|sessions|all`).
- Retrieval gate injects memory context into container prompts.
- Legacy migration support (`CLAUDE.md -> SOUL.md`, compaction sections to `MEMORY.md`).

### Gap (what is lacking)

1. No pluggable backend model (OpenClaw-style memory backend slot).
2. No embeddings/vector pipeline equivalent.
3. No pre-compaction memory-flush turn equivalent.
4. `memory_get` currently throws when file is missing (OpenClaw degrades gracefully).
5. No explicit memory scope policy layer (DM/group/session matching) comparable to OpenClaw memory scope config.

## 2.2 Workspace

### What `openclaw` has

- Canonical workspace contract with optional multi-agent separate workspaces.
- Bootstrap controls (`skipBootstrap`, max per-file and total injected chars).
- Optional `BOOT.md` startup ritual file.
- Strong documentation for workspace backup/migration and drift control.

### What `fft_nano` has today

- Main workspace default `~/nano` with auto-seeded files and onboarding state tracking.
- Main workspace + group folder separation.
- Bootstrap seeding with deterministic templates.

### Gap (what is lacking)

1. No `BOOT.md` lifecycle equivalent.
2. No bootstrap size guardrails equivalent to OpenClaw `bootstrapMaxChars` and total cap controls.
3. No per-agent workspace abstraction (single main workspace + group dirs instead).
4. Less formalized workspace drift/doctor checks compared to OpenClaw.

## 2.3 Heartbeat

### What `openclaw` has

- Per-agent heartbeat config.
- Channel/account targeting controls (`target`, `to`, `accountId`).
- Optional reasoning delivery.
- Visibility controls for OK vs alerts by channel/account.
- Active-hours with explicit timezone control.

### What `fft_nano` has today

- Global env-based heartbeat cadence and prompt.
- Main-session heartbeat only.
- Empty `HEARTBEAT.md` suppression.
- `HEARTBEAT_OK` stripping + ack length gate + duplicate suppression.
- Day/time active-hours window parser.

### Gap (what is lacking)

1. No per-agent/per-channel heartbeat routing controls.
2. No heartbeat account targeting model.
3. No heartbeat reasoning delivery mode.
4. No explicit timezone field in active-hours policy (uses local host time logic only).
5. No channel-level heartbeat visibility matrix (show-ok/show-alerts style).

## 2.4 Cron

### What `openclaw` has

- Cron jobs as a first-class subsystem with dedicated persisted store semantics.
- Main-session vs isolated execution model with delivery defaults and explicit wake behavior.
- Rich CLI/API surface and strong operational docs.
- Deterministic anti-thundering behavior for recurring top-of-hour jobs.

### What `fft_nano` has today

- Cron v2-compatible fields in DB.
- `schedule` kinds (`at`, `every`, `cron`) plus legacy compatibility.
- `session_target`, `wake_mode`, `delivery_mode`, timeout, stagger, delete-after-run, backoff.
- Delivery modes `none|announce|webhook`.

### Gap (what is lacking)

1. Different persistence shape and operator UX vs OpenClaw cron job store/CLI experience.
2. No OpenClaw-style defaulting where isolated jobs omit delivery and still default to announce behavior.
3. No deterministic top-of-hour auto-stagger behavior equivalent (stagger is explicit/randomized per run).
4. Less complete runbook/inspection ergonomics than OpenClaw cron docs/CLI stack.

## 2.5 Onboarding + system intent

### What `openclaw` has

- Full wizard-first onboarding and reconfiguration flows.
- Broader control-plane mental model across channels/agents.

### What `fft_nano` has today

- Strong deterministic onboarding for the main workspace identity.
- Farm-specific workflow integration and practical defaults.

### Gap (what is lacking)

1. Broader guided reconfiguration surface (wizard depth).
2. Policy and diagnostics breadth comparable to OpenClaw "doctor" style coverage.

---

## Part 3: Close-the-Gap Plan (Pragmatic)

## P0 (highest value for parity)

1. Memory parity pass:
   - Make `memory_get` return empty payload on missing files (no throw path).
   - Add pre-compaction memory-flush run.
   - Add pluggable memory backend interface (keep lexical as default backend).

2. Heartbeat parity pass:
   - Add config object support for `target`, `to`, optional `accountId`.
   - Add active-hours timezone option.
   - Add channel-level heartbeat visibility controls.

3. Cron parity pass:
   - Align isolated-job default delivery behavior with OpenClaw expectations.
   - Add deterministic top-of-hour stagger mode.
   - Add a stronger operator command surface for cron inspection and run history.

## P1 (structural parity)

1. Workspace parity:
   - Add optional `BOOT.md` handling.
   - Add bootstrap injection size guardrails.
   - Add better workspace health checks (doctor-like).

2. Memory quality:
   - Add optional embeddings/vector path (feature-flagged).
   - Keep existing lexical+FTS as low-cost fallback.

## P2 (ecosystem parity)

1. Add deeper guided onboarding/reconfigure flows.
2. Add stronger policy scopes and diagnostics to match OpenClaw operator ergonomics.

---

## Bottom line

`fft_nano` is already ahead of `nanoclaw` in structured memory/workspace discipline and has a capable cron/heartbeat core.

To become "as close as possible" to `openclaw`, the biggest missing blocks are:
- memory backend + compaction-flush parity
- heartbeat routing/visibility/timezone parity
- cron behavior/UX parity
- workspace bootstrap controls (`BOOT.md` + size caps + doctor-like checks)
