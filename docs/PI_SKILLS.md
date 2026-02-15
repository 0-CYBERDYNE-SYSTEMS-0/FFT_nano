# Pi-Native Skills (FFT_nano)

This document defines the active project-local Pi-native skills for FFT_nano.

## Active Skills

Project-local source of truth:

- `.pi/skills/fft-setup/SKILL.md`
- `.pi/skills/fft-debug/SKILL.md`
- `.pi/skills/fft-telegram-ops/SKILL.md`
- `.pi/skills/fft-coder-ops/SKILL.md`
- `.pi/skills/fft-farm-bootstrap/SKILL.md`
- `.pi/skills/fft-farm-onboarding/SKILL.md`
- `.pi/skills/fft-farm-validate/SKILL.md`

Optional assets used by these skills:

- `.pi/skills/fft-setup/scripts/check-prereqs.sh`
- `.pi/skills/fft-debug/scripts/collect-debug-snapshot.sh`
- `.pi/skills/fft-telegram-ops/references/commands.md`
- `.pi/skills/fft-coder-ops/references/safety.md`

## Runtime Discovery/Wiring

During container run setup, FFT_nano mirrors project `fft-*` skills into per-group Pi home:

- host destination: `data/pi/<group>/.pi/skills/`
- container path: `/home/node/.pi/skills/`

This keeps skills discoverable to Pi runtime without relying on host-global installations.

## Legacy Claude Skills

Legacy `.claude/skills` may exist in this repository for historical reference.

- They are archive-only.
- Active runtime behavior should come from `.pi/skills`.

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

- required skill directories exist
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
2. In main chat, issue one skill-scoped prompt per skill and verify expected behavior.
3. Confirm no behavior relies on `.claude/skills`.

## Farm Skill Responsibilities

- `fft-farm-bootstrap`: mode selection, prerequisite checks, companion repo sync/pin, HA startup, token validation, env wiring, handoff.
- `fft-farm-onboarding`: production entity discovery, auto-suggested mapping, confirmation for uncertain matches, profile write.
- `fft-farm-validate`: readiness checks and final control gate authority (`validation.status=pass` required for control actions).
