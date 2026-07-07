# SPEC-01 — Unpause Learning (the one switch)

**Severity:** CRITICAL · **Type:** operational fix + regression guard · **Status: FIXED 2026-07-07** (ops portion)

## Problem

`learning_paused: true` in `~/fft_nano/data/router_state.json` has been silently gating the
entire self-improvement stack since at least 2026-06-21. Every subsystem downstream of
`state.learningPaused` short-circuits:

- Quiet skill reviewer / self-improve signals — `src/skill-service.ts:133-134` returns
  `{ due: false, triggerReason: 'learning-paused' }`.
- Idle skill curator — same gate.
- Skill-manager runs — one log line: "blocked: learning paused".

## Evidence

- `groups/main/logs/self-improve-events.jsonl`: 40 events 2026-06-21 → 2026-07-02;
  **fired: 0**; every event `noop_reason: "learning-paused"`. Dropped signals: 32
  corrections, 18 explicit remember requests, 6 multi-step procedures — 56 high-value
  learning moments discarded.
- `data/router_state.json`: `"learning_paused": true` (verified live 2026-07-07).
- No heartbeat, alert, or digest surfaced the paused state unprompted (see SPEC-02).

## Root cause

The flag was set (via `/learning pause` in the main Telegram chat, the only writer besides
state load) and never resumed. Nothing in the system distinguishes "deliberately paused
for a day" from "forgotten for three weeks".

## Fix

### Part A — operational (DONE 2026-07-07)

1. Back up `data/router_state.json`.
2. Set `learning_paused` → `false` in the file.
3. Restart the service (`launchctl kickstart -k gui/$(id -u)/com.fft_nano`) so
   `loadState()` (`src/state-persistence.ts:66`) picks it up — the flag is only read at boot.
4. Verify: new PID, clean boot log ("State loaded"), file still reads `false` after the
   first post-boot `saveState()` (fires after each processed inbound message,
   `src/app.ts:409`) — proving in-memory state agrees with disk.

**Race note for future operators:** `saveState()` rewrites the whole file from memory after
every processed message. An on-disk edit while the service runs WILL be clobbered unless the
restart happens immediately after the edit. The supported path is `/learning resume` in the
main Telegram chat (`src/telegram-commands.ts:2676-2700`), which flips memory and persists
atomically — prefer it whenever a human is at the keyboard.

### Part B — regression guard (dev team)

The pause flag needs an age. Add `learning_paused_at: string | null` alongside the boolean:

- `src/app-state.ts`: add `learningPausedAt: string | null` (default `null`).
- `src/state-persistence.ts`: load/save the field next to `learning_paused`.
- `src/telegram-commands.ts` `/learning pause`: stamp `new Date().toISOString()`;
  `/learning resume`: clear to `null`.
- `formatLearningDigest()`: when paused, render "paused since <date> (<N> days)".

This is the substrate SPEC-02's witness alerts on.

## TDD plan

Test file: `tests/learning-pause-age.test.ts` (new).

1. RED: `loadState()` on a fixture `router_state.json` with `learning_paused: true,
   learning_paused_at: "2026-06-21T00:00:00Z"` → assert `state.learningPausedAt` populated.
2. RED: simulate `/learning pause` handler → assert `learningPausedAt` is a valid ISO
   timestamp and survives `saveState()` round-trip.
3. RED: simulate `/learning resume` → assert `learningPausedAt === null` after round-trip.
4. GREEN: implement; `npm run typecheck && npm test` clean.

## Acceptance criteria

- [x] Live runtime has `learning_paused: false` and the service was restarted (2026-07-07).
- [x] Next self-improve event in `self-improve-events.jsonl` is NOT `noop_reason: "learning-paused"`.
- [ ] `learning_paused_at` persists through pause/resume round-trips (tests green).
- [ ] `/learning` digest shows pause age when paused.

## Files

`src/app-state.ts`, `src/state-persistence.ts`, `src/telegram-commands.ts`,
`tests/learning-pause-age.test.ts`.

## Out of scope

Alerting on pause age (SPEC-02). Evaluator sampling (SPEC-03).

## Rollback

Part A: restore the timestamped backup of `router_state.json` and restart, or send
`/learning pause`. Part B: revert the commit; field is additive and ignored by older builds.
