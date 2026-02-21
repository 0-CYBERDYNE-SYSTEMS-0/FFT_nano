---
name: fft-farm-onboarding
description: Discover Home Assistant entities, auto-suggest farm mappings with confidence, confirm ambiguous mappings, and write farm-profile.json.
---

# FFT Farm Onboarding

Use this skill for production setup after HA is running and token is available.

## When to use this skill

- Use after Home Assistant is up and authenticated for production setup.
- Use when generating or refining `farm-profile.json` entity mappings.
- Use before production validation gate checks.

## When not to use this skill

- Do not use before HA connectivity/token setup is complete.
- Do not use for live farm control actions.
- Do not use when only read-only status checks are requested.

## Workflow

1. Run:
   - `./scripts/farm-onboarding.sh`
2. Review suggested entity mappings.
3. Confirm or override medium/low-confidence mappings.
4. Persist profile to `FARM_PROFILE_PATH`.
5. Run validation next:
   - `./scripts/farm-validate.sh`

## Output

- Writes `data/farm-profile.json` by default.
- Sets `validation.status` to `pending` when mappings are complete but not validated.
