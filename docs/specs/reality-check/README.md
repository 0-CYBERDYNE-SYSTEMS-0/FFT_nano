# Reality-Check Fix Specs — 2026-07-07

Source: live-runtime audit of FFT_nano's learning/self-improvement stack (evidence pulled from
`~/fft_nano/store/messages.db`, `~/fft_nano/logs/fft_nano.log`, `~/fft_nano/data/router_state.json`,
`~/fft_nano/groups/main/logs/self-improve-events.jsonl`, and the `~/nano` main workspace).

Overall audit grade: **D+ — the pipes are built, the signal isn't flowing.** Nearly every
subsystem is well-engineered in code and inert in production. Two root causes dominate:
a silent kill switch (`learning_paused: true`) and a stale runtime deploy.

## Spec index (priority order)

| # | Spec | Severity | Status |
|---|------|----------|--------|
| 01 | [Unpause learning](SPEC-01-unpause-learning.md) | CRITICAL | **FIXED 2026-07-07** (ops action; spec documents runbook + regression guard) |
| 02 | [Kill-switch witness](SPEC-02-kill-switch-witness.md) | CRITICAL | Ready for dev |
| 03 | [Evaluator signal flow](SPEC-03-evaluator-signal-flow.md) | SERIOUS | Ready for dev |
| 04 | [Skill-injection instrumentation](SPEC-04-skill-injection-instrumentation.md) | SERIOUS | Ready for dev |
| 05 | [Memory journal health](SPEC-05-memory-journal-health.md) | SERIOUS | Ready for dev |
| 06 | [Scheduling ownership](SPEC-06-scheduling-ownership.md) | SERIOUS | Ready for dev |
| 07 | [Heartbeat health semantics](SPEC-07-heartbeat-health-semantics.md) | WARNING | Ready for dev |
| 08 | [Deployment realignment](SPEC-08-deployment-realignment.md) | SERIOUS | Ready for dev |
| 09 | [Workspace hygiene sweep](SPEC-09-workspace-hygiene.md) | WARNING | Ready for dev |

## Ground rules for implementers

- **TDD**: every code change lands with a failing test first (`tests/*.test.ts`, `node --import tsx --test`).
  Each spec names the exact test file and the assertions that must go red → green.
- **Surgical changes**: touch only the files listed per spec. No adjacent refactors.
- **Runtime worktree (`~/fft_nano`) is never hand-edited.** All code changes go through
  feature branch in `~/fft_nano-dev` → PR → `dev` → build/restart per the ship loop.
- Gates before merge: `npm run typecheck && npm test`; before release: `npm run release-check && npm run secret-scan`.

## Dependency notes

- SPEC-02 (witness) assumes SPEC-01's runbook semantics; independent to implement.
- SPEC-04 depends on SPEC-03's chokepoint routing only for shared test fixtures; can land in either order.
- SPEC-08 (deploy) unblocks everything shipping to the live host — schedule it first or last, but schedule it.
