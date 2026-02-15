# Pi-Native Skills (FFT_nano)

This document defines skill layout and runtime sync behavior for FFT_nano.

## Skill Types

FFT_nano uses two skill types:

- Setup-only skills (bootstrap/install guidance, not runtime mirrored):
  - `skills/setup/`
- Runtime agent skills (mirrored into Pi home on each run):
  - `skills/runtime/`
- Main workspace user runtime skills:
  - `~/nano/skills/` (only merged for main/admin runs)

Current bundled runtime skills include:

- `fft-setup`
- `fft-debug`
- `fft-telegram-ops`
- `fft-coder-ops`
- `fft-farm-bootstrap`
- `fft-farm-onboarding`
- `fft-farm-validate`
- `fft-farm-ops`
- `fft-dashboard-ops`

## Runtime Discovery/Wiring

During container run setup, FFT_nano mirrors runtime skills into per-group Pi home:

- host destination: `data/pi/<group>/.pi/skills/`
- container path: `/home/node/.pi/skills/`

Merge and cleanup behavior:

- Main/admin runs merge `project runtime skills` + `~/nano/skills/`
- Non-main runs mirror `project runtime skills` only
- Name collisions are resolved by source order; main workspace overrides project
- A managed manifest (`.fft_nano_managed_skills.json`) tracks synced skill names
- Only previously managed stale skills are removed, so manually installed runtime skills are preserved

This keeps skills discoverable to Pi runtime without relying on host-global installations.

## Guardrails Required in Every Skill

Every `SKILL.md` in this set includes and must preserve:

- never run destructive git commands unless explicitly requested
- preserve unrelated worktree changes
- enforce main-chat-only boundaries for admin/delegation operations

## Validation

Run static validation:

```bash
npm run validate:skills
```

Validation checks:

- required bundled runtime skill directories exist
- each `SKILL.md` has valid frontmatter
- `name` matches folder name
- `description` exists
- guardrail language is present

## Regression

Use these checks after skill changes:

```bash
npm run validate:skills
npm run typecheck
npm test
```

## Smoke Testing Approach

Recommended smoke sequence:

1. Start runtime with Telegram in dev:
   - `./scripts/start.sh dev telegram-only`
2. In main chat, issue one skill-scoped prompt for:
   - one bundled runtime skill
   - one user skill from `~/nano/skills`
3. Confirm non-main run does not load `~/nano/skills`.

## Farm Skill Responsibilities

- `fft-farm-bootstrap`: mode selection, prerequisite checks, companion repo sync/pin, HA startup, token validation, env wiring, handoff.
- `fft-farm-onboarding`: production entity discovery, auto-suggested mapping, confirmation for uncertain matches, profile write.
- `fft-farm-validate`: readiness checks and final control gate authority (`validation.status=pass` required for control actions).
