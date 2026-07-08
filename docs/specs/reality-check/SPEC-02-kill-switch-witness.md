# SPEC-02 — Kill-Switch Witness (a pause must announce itself)

**Severity:** CRITICAL · **Type:** code change · **Status:** Ready for dev

## Problem

`learning_paused` silently disabled the reviewer, curator, and skill-manager for 15+ days
and dropped 56 high-value learning signals. No subsystem is responsible for noticing that
the kill switch is on. A safety control without a witness converts a one-day pause into a
permanent, invisible lobotomy.

## Evidence

- 40/40 self-improve events `noop_reason: "learning-paused"` (2026-06-21 → 2026-07-02),
  zero operator notification at any point.
- Heartbeat ran 35 successful passes (`HEARTBEAT_OK`) in the same window without mentioning
  the pause — the health check does not consider "learning is off" a health fact.
- The only surface that reports pause state is the `/learning` digest
  (`src/telegram-commands.ts:2702-2705`), which must be manually requested; log shows it
  was never requested during the outage.

## Root cause

Pause state is checked at *decision points* (`shouldRunSkillManager`,
`extractLearningSignals` consumers) but never at *observation points* (heartbeat, boot,
digest push). Nothing owns the question "has this been on too long?"

## Fix

Three witnesses, all cheap, no new LLM calls:

1. **Boot witness** — in `main()` (`src/app.ts`), right after `loadState()`: if
   `state.learningPaused`, log at WARN with pause age (from SPEC-01's
   `learningPausedAt`, "unknown" if null) AND enqueue a one-line Telegram notice to the
   main chat: "Learning is paused (since <date>, N days). Send /learning resume to re-enable."
   Send through the delivery outbox with dedupe key `learning-paused-boot:{date}` so a
   crash-loop cannot spam.
2. **Heartbeat witness** — in the heartbeat prompt-context builder, inject a line when
   paused: `LEARNING: PAUSED since <date> (<N> days)`. When pause age exceeds
   `FFT_NANO_LEARNING_PAUSE_ALERT_DAYS` (default 3), the heartbeat run must emit
   `HEARTBEAT_ALERT` (existing alert channel) instead of `HEARTBEAT_OK`.
3. **Self-improve event witness** — in `recordSelfImproveEvent`
   (`src/self-improve-signals.ts`), maintain a per-group counter of consecutive
   `learning-paused` noops; at 10 (and each 10 after: 20, 30…), send one outbox-deduped
   notice (`learning-paused-drops:{group}:{count}`): "N learning signals dropped while
   paused (latest: <kind>)."

Config: `FFT_NANO_LEARNING_PAUSE_ALERT_DAYS` (number, default 3, 0 disables witness #2's
alert escalation only).

## TDD plan

Test file: `tests/learning-pause-witness.test.ts` (new).

1. RED: boot-witness unit — with `learningPaused=true`, assert one outbox row with dedupe
   key `learning-paused-boot:<today>`; second call same day → still one row (dedupe).
2. RED: heartbeat context — paused 4 days with default threshold → context contains
   `LEARNING: PAUSED` and alert flag set; paused 1 day → context line present, no alert.
3. RED: drop counter — feed 10 consecutive paused noops → exactly one notice row; 9 → zero;
   20 → two.
4. RED: `learningPaused=false` → none of the three witnesses produce output.
5. GREEN: implement; `npm run typecheck && npm test` clean.

## Acceptance criteria

- [ ] Restarting the service while paused produces exactly one Telegram notice per day.
- [ ] Heartbeat output includes pause state whenever paused; escalates to alert past threshold.
- [ ] 10 dropped signals produce a notice with the drop count.
- [ ] Zero behavior change when learning is active (test 4 green; no new log lines in
      normal operation).

## Files

`src/app.ts`, `src/self-improve-signals.ts`, heartbeat context builder (locate via
`HEARTBEAT_OK` emitter), `src/outbox.ts` (consume only, no schema change),
`src/app-config.ts` (new env), `tests/learning-pause-witness.test.ts`.

## Out of scope

Auto-resume after a deadline (rejected: a kill switch that un-kills itself is worse than
one that nags). Changing evaluator sampling (SPEC-03).

## Risks / rollback

All three witnesses are additive and outbox-deduped; worst case is one extra Telegram line
per day. Rollback = revert commit.
