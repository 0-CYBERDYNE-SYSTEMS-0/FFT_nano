# Skill Curator Implementation Notes

## 2026-05-19

- Interpreted the missing `< SPEC>` as the Hermes-derived behavior from the
  discovery pass: skill usage telemetry, agent-created skill provenance,
  self-improvement nudges, curator lifecycle, dry-run/reporting, pin/archive,
  restore, backup, and operator controls.
- Adjusted the v1 toward farmer ergonomics after operator feedback: skills
  should stay organized without active thought. The curator should inspect all
  visible runtime skills for catalog/frontmatter quality, while destructive
  lifecycle operations remain limited to agent-created runtime skills.
- Kept repo-tracked `skills/runtime/` and personal `~/nano/skills/` as source
  layers. Agent-created skills live in the mounted group Pi home so group
  learning does not mutate release files or personal source skills.
- During tests, automatic archive initially moved the skill directory but then
  overwrote `.usage.json` with the pre-archive in-memory record. Fixed the
  transition path so directory movement and telemetry state are updated
  together.
- `minIdleHours` is part of the parity config schema for the future scheduled
  idle-maintenance loop, but the v1 trigger is post-run and interval-gated.
  Enforcing it against skill catalog usage would prevent the curator from ever
  running, because catalog usage is refreshed on each agent run.
