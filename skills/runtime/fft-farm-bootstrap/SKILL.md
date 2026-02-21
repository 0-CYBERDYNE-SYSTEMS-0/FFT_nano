---
name: fft-farm-bootstrap
description: Bootstrap farm mode in demo or production, including Home Assistant startup, token onboarding, env wiring, and handoff to onboarding/validation.
---

# FFT Farm Bootstrap

Use this skill when a user wants first-time farm setup to be frictionless.

## When to use this skill

- Use for first-time farm environment bootstrap in demo or production mode.
- Use when `.env` farm variables and Home Assistant startup need guided setup.
- Use before onboarding and validation are run for the first time.

## When not to use this skill

- Do not use for day-2 operations after bootstrap is already complete.
- Do not use for production control actions; use farm ops/validation skills instead.
- Do not use when required secrets/tokens are unavailable.

## Guardrails

- Never run destructive git commands unless explicitly requested.
- Preserve unrelated worktree changes.
- Do not expose tokens in logs or chat responses.

## Workflow

1. Run:
   - `./scripts/farm-bootstrap.sh --mode demo`
   - or `./scripts/farm-bootstrap.sh --mode production`
2. If mode is production, bootstrap will hand off to onboarding + validation scripts.
3. Confirm `.env` has:
   - `FARM_MODE`
   - `FARM_PROFILE_PATH`
   - `FARM_STATE_ENABLED=true`
   - `HA_URL`, `HA_TOKEN`, `FFT_DASHBOARD_REPO_PATH`

## Notes

- Home Assistant stack is Docker/Compose-based.
- FFT_nano agent runtime remains Apple Container/Docker auto detection.
- Browser-assisted token generation is expected.
