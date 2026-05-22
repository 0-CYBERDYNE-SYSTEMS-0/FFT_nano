# Hermes-Style `/goal` + `/subgoal` for FFT_nano (Main/Admin) with Integration E2E

## Summary
- Add a persistent standing-goal loop to FFT_nano, modeled on Hermes behavior: `/goal` manages a long-running objective, `/subgoal` adds criteria, and the host auto-continues direct assistant turns until done/paused/cleared.
- Scope locked from your choices:
  1. Hermes-parity core (`/goal` + `/subgoal` + auto loop).
  2. LLM-based judge (read-only judge turn, JSON verdict).
  3. Main/admin Telegram only.
  4. Loop applies to direct assistant runs only (not `/coder` execute/plan).
  5. E2E depth: gateway command + dispatcher integration tests in-repo.
- Reference behavior source (reviewed):
  - https://raw.githubusercontent.com/NousResearch/hermes-agent/main/hermes_cli/commands.py
  - https://raw.githubusercontent.com/NousResearch/hermes-agent/main/hermes_cli/goals.py
  - https://hermes-agent.nousresearch.com/docs/user-guide/features/goals

## Implementation Changes
- Add a goal domain module (`src/goal-loop.ts`) containing:
  1. `GoalState` model (goal text, status, turns used, budget, last verdict/reason, parse-failure streak, subgoals, timestamps).
  2. Command-side mutators: set/pause/resume/clear/status + add/remove/clear subgoals.
  3. Continuation prompt builders (goal-only and goal+subgoals variants).
  4. Judge prompt templates and strict JSON parser (`{ done: boolean, reason: string }`), with fail-open semantics on transport/API failures.
  5. Auto-pause rules:
     1. Turn budget exhausted.
     2. Consecutive unparseable judge outputs exceed threshold.
- Wire goal persistence into existing router state (`data/router_state.json` via `chat_run_preferences`) so it survives restart and keeps chat-local scope.
- Extend Telegram command surface:
  1. `/goal [text|status|pause|resume|clear]`
  2. `/subgoal [text|remove N|clear]`
  3. Main/admin gating aligned with other high-control commands.
  4. Help/menu/normalization updates in command spec.
- Dispatcher integration (`src/message-dispatch.ts` + wiring in `src/index.ts`):
  1. After a successful direct `agent` run, if a goal is active for that chat, evaluate assistant output with a judge run in read-only mode.
  2. Judge result handling:
     1. `done` -> mark goal done and stop loop.
     2. `continue` + within limits -> enqueue continuation turn.
     3. budget/parse-failure pause -> pause and notify.
  3. Queue priority: continuation is enqueued through existing direct-session queue path so real inbound user messages preempt the continuation.
- Add runtime knobs (env-backed defaults):
  1. `FFT_NANO_GOAL_MAX_TURNS` (default 20)
  2. `FFT_NANO_GOAL_JUDGE_TIMEOUT_SECONDS` (default 30)
  3. `FFT_NANO_GOAL_JUDGE_MAX_TOKENS` (default 4096)
  4. `FFT_NANO_GOAL_JUDGE_MAX_PARSE_FAILURES` (default 3)

## Public Interface / Type Changes
- `Telegram` commands exposed to operators:
  1. `/goal ...`
  2. `/subgoal ...`
- `ChatRunPreferences` gains a `goal` object (typed) for persisted per-chat goal state.
- `createTelegramCommandHandlers` deps gain minimal goal hooks (get/set/format + continuation starter).
- `createMessageDispatcher` deps gain goal hooks (load active goal, evaluate-after-turn, queue continuation, persist).

## Test Plan (Including E2E Scope)
- `tests/telegram-command-spec.test.ts`
  1. `/goal` and `/subgoal` normalization and registration.
  2. Help text includes both commands only in main/admin command set.
- `tests/telegram-commands.test.ts`
  1. `/goal <text>` starts goal and dispatches initial continuation.
  2. `/goal status|pause|resume|clear` transitions and messages.
  3. `/subgoal add/remove/clear` behavior and validation.
  4. Main/admin gate enforcement for both commands.
- New integration-focused E2E tests (command + dispatch path):
  1. Goal continues across turns when judge returns continue.
  2. Goal stops when judge returns done.
  3. Goal auto-pauses on turn-budget exhaustion.
  4. Goal auto-pauses after consecutive parse failures.
  5. Real inbound user message preempts queued continuation.
  6. No goal loop effects on coder routes.
- Run full relevant test subset plus `npm test` before handoff.

## Assumptions and Defaults
- `/goal` replaces any existing active/paused goal in that chat when a new goal text is set.
- `/goal resume` resumes from paused state and resets turn budget counter to 0 (Hermes-style default).
- Judge run is read-only and isolated from normal response delivery; judge failures are fail-open except repeated parse failures (which pause).
- Initial rollout is Telegram main/admin only; no WhatsApp command surface changes in v1.
