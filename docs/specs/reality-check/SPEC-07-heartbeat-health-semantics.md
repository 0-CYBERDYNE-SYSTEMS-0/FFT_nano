# SPEC-07 — Heartbeat Health Semantics (failed heartbeats are not silent)

**Severity:** WARNING · **Type:** code change · **Status:** Ready for dev

## Problem

The heartbeat service logs "Heartbeat run failed" identically in severity to successful passes
and produces NO escalation or alert. Of 119 heartbeat attempts across 2026-06-24 to 2026-07-07,
84 failed (71%) with Telegram connection errors and 35 passed (`HEARTBEAT_OK`), but the operator
has no way to distinguish a healthy check from a check that never ran. The health monitoring
system cannot tell the difference between "I checked and everything is fine" and "I couldn't check
at all." After 3+ consecutive failures, this opacity becomes a safety gap.

## Evidence

- `~/fft_nano/logs/fft_nano.log`: "Heartbeat run failed" logged 84 times
  (2026-06-24 → 2026-07-07), all tagged with Telegram "Connection error" or agent exception.
- Same log window: `HEARTBEAT_OK` ×35, `HEARTBEAT_ALERT` ×0.
- Heartbeat cadence: `config/runtime.parity.json:11` `"every": "4h"` (enabled).
- Failure locations: `src/heartbeat-service.ts:295` (connection/retry exhaust) and
  `src/heartbeat-service.ts:393` (agent exception). Both emit identical `logger.warn()` with no
  escalation signal.
- `src/heartbeat-policy.ts:3-5` defines `HEARTBEAT_TOKEN = 'HEARTBEAT_OK'` and matching regex;
  there is no corresponding alert pattern or failure threshold logic.

## Root cause

Heartbeat success/failure are treated as binary outcomes logged at the same level. The evaluator
loop has no consecutive-failure counter; a transient Telegram outage (24+ hours) that clears
silently looks indistinguishable from nominal operation. The heartbeat prompt
(`src/parity-config.ts:173`) tells the agent to reply `HEARTBEAT_OK` or fall silent, with no
guidance on when silence means "couldn't check" versus "checked and OK."

## Fix

Implement a three-tier heartbeat health hierarchy:

1. **Consecutive failure counter** — in `src/heartbeat-service.ts`, track `consecutiveFailures`
   (persist in the `heartbeat_runs` table or app state). On success, reset to 0. On failure,
   increment.

2. **Alert escalation** — when `consecutiveFailures >= 3`, emit `HEARTBEAT_ALERT` (new log level
   distinct from `HEARTBEAT_OK`) to Telegram's dedicated alert channel (if configured) or at
   minimum log at ERROR with the tag `HEARTBEAT_ALERT:<N>_consecutive` so alerting systems can
   subscribe. Include failure reason + recovery guidance.

3. **Retry-with-backoff on Telegram errors** — distinguish transient Telegram connection errors
   (retry with exponential backoff, max 3 attempts per cycle) from permanent failures (agent
   error/logic). Log each tier separately so the operator can see retry attempts in real-time.

4. **Context injection** — in the heartbeat prompt context (heartbeat policy builder), inject a
   diagnostic line if `consecutiveFailures > 0`: `HEALTH: Last check failed <N> times (reason:
   <tag>). Re-verify critical services and report.` When `consecutiveFailures >= 3`, wrap that
   line in a top-level alert marker so the agent knows to escalate.

Config: `FFT_NANO_HEARTBEAT_FAILURE_THRESHOLD` (default 3, 0 disables alert escalation);
`FFT_NANO_HEARTBEAT_RETRY_ATTEMPTS` (default 3 per cycle, for Telegram transients).

## TDD plan

Test file: `tests/heartbeat-health-semantics.test.ts` (new).

1. RED: consecutive failure tracking — log 2 failures → `consecutiveFailures=2`, next success →
   `consecutiveFailures=0`.
2. RED: alert escalation — `consecutiveFailures=3` → heartbeat output contains alert marker;
   `consecutiveFailures=2` → no alert marker.
3. RED: transient retry — Telegram error on attempt 1, success on attempt 2 → retried, logged
   once as `"attempt 2/3"`, marked as recovered.
4. RED: context injection — `consecutiveFailures > 0` → prompt context includes diagnostic line;
   `consecutiveFailures >= 3` → includes top-level alert.
5. RED: `consecutiveFailures=0` (healthy) → no alert marker, no diagnostic line.
6. GREEN: implement; `npm run typecheck && npm test` clean.

## Acceptance criteria

- [ ] Three or more consecutive heartbeat failures produce a distinct `HEARTBEAT_ALERT` log entry
      (or ERROR-level alert message if alert channel configured).
- [ ] Transient Telegram errors trigger at most 3 retry attempts per cycle without spamming logs.
- [ ] A successful heartbeat after failures resets the counter and clears any alert state.
- [ ] Heartbeat prompt context includes diagnostic health line whenever `consecutiveFailures > 0`.
- [ ] No change to single-pass-success or continuous-success behavior (legacy `HEARTBEAT_OK` still
      emitted identically).

## Files

`src/heartbeat-service.ts`, `src/heartbeat-policy.ts` (prompt builder), `src/db.ts` (schema
extension: `heartbeat_runs` table add `consecutive_failures` column if not persisted in app
state), `src/app-config.ts` (new env vars), `tests/heartbeat-health-semantics.test.ts`.

## Out of scope

Auto-remediation (e.g., restart the service on 5+ failures). Changing the heartbeat prompt or
evaluation rubric (SPEC-03). Alerting to channels other than the configured alert/main channel.

## Risks / rollback

Heartbeat is a read-only diagnostic; new alert emissions are append-only and will not affect
existing chat/action flows. If the new alert channel is misconfigured, alerts may arrive on the
main channel instead (graceful fallback). Rollback = revert commit.
