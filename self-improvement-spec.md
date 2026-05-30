# FFT_nano Self-Improvement Spec

## Purpose

Make FFT_nano's self-improvement loop more robust and proactive, borrowing the useful parts of Hermes Agent's background review and curator model while keeping FFT_nano's stricter host-gated safety boundaries.

The goal is not to let the agent freely rewrite its own source or source-owned skills. The goal is to make it better at noticing reusable learning, saving durable memory, creating or improving agent-owned runtime skills, and consolidating those skills over time.

## Strategic Direction

Make FFT_nano more like Hermes Agent by changing the cadence and intent of self-improvement, not by copying Hermes Agent's looser write surface.

The right direction is:

1. Run review more often, but keep writes gated.
   - Consider a lightweight review after every successful non-heartbeat run.
   - Let the reviewer no-op unless there is real reusable knowledge.
   - Keep the host-side `skill_action` gate so repo and personal skills stay protected.

2. Add signal-based triggers.
   - Trigger immediately on high-value learning signals instead of relying only on turn/tool counters.
   - Signals include user corrections, repeated failed command then successful fix, new troubleshooting procedures, workflow preferences, tool/API quirks, multi-step recoveries, and explicit "remember this" or "next time" requests.

3. Split memory learning from skill learning.
   - Add a quiet memory reviewer for durable facts and preferences.
   - Keep procedural skill creation separate from `MEMORY.md` maintenance.

4. Make the skill prompt more assertive.
   - Prefer updating an existing loaded or relevant skill.
   - Create broad class-level skills instead of tiny one-offs.
   - Capture user preferences as procedural guidance when they affect how future work should be done.
   - Record reusable pitfalls and recovery recipes.
   - Avoid transient environment failures.

5. Use loaded-skill context.
   - Tell the reviewer which skills were loaded or used in the finished run.
   - If a loaded agent-created skill was missing an instruction, patch it.
   - If the gap is in a source-owned skill, create a companion runtime skill or write a report.

6. Make review asynchronous.
   - Do not delay the user-facing answer.
   - After sending the final response, enqueue a background maintenance job with a timeout.
   - Log failures and move on.

7. Turn the curator into a real idle loop.
   - Enforce `minIdleHours`.
   - Run curator maintenance when the service has been idle long enough, not only after user traffic.

8. Keep FFT_nano's stricter safety model.
   - Do not copy Hermes Agent's broader `skill_manage` permissions wholesale.
   - Only agent-created runtime skills should be mutable by the agent.
   - Improve review, triggers, prompts, and scheduling without weakening source ownership.

9. Add observability.
   - Every self-improvement pass should record why it ran, what signals it saw, whether it wrote memory, whether it changed skills, and why it no-oped.

## Current Baseline

FFT_nano already has several self-improvement mechanisms:

- Skill self-improvement runs after successful normal agent turns when cadence thresholds are reached.
- Skill manager maintenance applies lifecycle transitions and can run a quiet review pass.
- Runtime skill mutations are mediated through `skill_action` IPC.
- Only agent-created runtime skills are mutable by the agent.
- Repo-tracked and personal skills remain source-owned and protected.
- Coder runs have a separate reflection path that can write concise learnings into memory.

This is safer than Hermes Agent's broader `skill_manage` surface, but it is also more passive.

## Target Behavior

FFT_nano should review important work more often, learn from stronger signals, and perform deeper maintenance during idle time.

Self-improvement should become three cooperating loops:

1. **Post-turn learning review**
   - Runs after successful non-heartbeat turns.
   - Reviews the completed conversation and execution trace.
   - Decides whether to write durable memory, create a runtime skill, or patch an existing agent-created skill.
   - Usually no-ops when there is no reusable learning.

2. **Signal-triggered fast path**
   - Runs immediately when high-value learning signals appear.
   - Does not wait for the normal turn/tool interval.
   - Uses the same gated mutation path as the normal review.

3. **Idle curator loop**
   - Runs when the service has been idle long enough.
   - Consolidates, archives, reactivates, and reports on agent-created runtime skills.
   - Performs broader cleanup than a single post-turn review.

## Non-Goals

- Do not let the agent edit repo-tracked skills directly.
- Do not let the agent edit personal operator skills directly.
- Do not let the quiet reviewer write arbitrary files.
- Do not use self-improvement as a transcript compaction store.
- Do not save one-off task details as skills.
- Do not capture transient environment failures unless they represent a reusable recovery procedure.
- Do not delay the user-facing answer while maintenance work runs.

## Safety Model

Keep FFT_nano's current safety posture:

- All skill writes go through host-owned `skill_action` IPC.
- The quiet maintenance agent does not directly inspect or edit skill files.
- Source-owned repo skills are immutable to the agent.
- Personal skills are immutable to the agent.
- Only agent-created runtime skills can be patched, archived, pinned, restored, or rolled back.
- New agent-created skills live in the group runtime skill area, not the repo source tree.
- Every mutation must be recorded with provenance and enough metadata for audit and rollback.

If a repo or personal skill appears outdated, the reviewer should create an agent-owned companion skill or write a maintenance report. It should not patch the source-owned skill.

## Learning Signals

The post-turn reviewer should run in lightweight mode after successful turns, but the system should bypass normal cadence and trigger a full review when any of these signals are detected:

- The user corrects the agent's behavior.
- The user expresses a durable preference.
- The user says to remember something.
- A command, API call, or tool path fails repeatedly and then succeeds.
- The agent discovers a stable workaround.
- The agent completes a new multi-step operational procedure.
- The agent fixes or diagnoses a farm/device/home automation issue.
- A loaded skill was insufficient, wrong, stale, or missing a step.
- The same troubleshooting pattern appears across multiple turns.
- A coding run produces a broadly reusable repository workflow or pitfall.

Signals should influence review priority, not bypass safety checks.

## Memory vs Skill Separation

Self-improvement should classify learning before writing:

### Memory

Use memory for durable facts about the user, environment, preferences, current projects, farm state, or operating expectations.

Examples:

- The user prefers a specific deployment workflow.
- The main Telegram chat is the operational control surface.
- A specific device has a stable name, location, or integration path.

### Skills

Use skills for reusable procedures, pitfalls, recipes, troubleshooting methods, command sequences, or task-class behavior.

Examples:

- How to restart and verify the FFT_nano launchd service.
- How to diagnose Telegram polling conflicts.
- How to handle a specific Home Assistant device class.
- How to validate a release candidate.

### Reports

Use reports when the reviewer sees a useful issue but cannot safely mutate the relevant source-owned artifact.

Examples:

- A repo skill should be updated.
- A personal skill conflicts with a runtime skill.
- A source-owned skill needs operator review.

## Prompting Requirements

The reviewer prompt should be more assertive than the current conservative version, but still bounded.

It should instruct the reviewer to:

- Look first for durable procedural knowledge.
- Prefer patching an existing relevant agent-created skill over creating a duplicate.
- Create broad class-level skills instead of narrow one-off skills.
- Capture user corrections as procedural guidance when they change how future work should be done.
- Capture repeated command/tool/API pitfalls only when the recovery is reusable.
- Treat loaded skill gaps as candidates for improvement.
- Use memory for stable facts and preferences.
- No-op when the lesson is not durable.
- Never mutate source-owned skills.

The prompt should explicitly reject:

- One-off task narratives.
- Raw transcripts.
- Temporary outages.
- Speculation.
- Environment-specific failure claims without a reusable recovery path.
- Skills whose only content is "remember that this happened."

## Scheduling

### Post-Turn Review

Run after the final response has been sent or queued to the user.

Eligibility:

- Final result succeeded.
- Not a heartbeat task.
- Not already a maintenance task.
- Skill or memory maintenance is enabled.
- Conversation has enough content to review.

Modes:

- **Light review:** default after successful turns.
- **Full review:** triggered by learning signals or interval thresholds.

### Cadence Thresholds

Keep configurable thresholds, but treat them as a backstop rather than the main driver.

Suggested defaults:

- Light review: every successful non-heartbeat turn.
- Full review: every 10 turns or 10 tool calls.
- Immediate full review: on high-value learning signal.
- Hard timeout: 10 minutes.

### Idle Curator

Run independently of user traffic.

Suggested defaults:

- Interval: 7 days.
- Minimum idle time: 2 hours.
- Mark stale after: 30 days inactive.
- Archive after: 90 days inactive.
- Snapshot before mutation: enabled.

The current `minIdleHours` setting should become real scheduling behavior, not just configuration intent.

## Execution Model

Self-improvement work should run asynchronously:

1. The main agent finishes the user-facing task.
2. FFT_nano sends or queues the response.
3. The host enqueues a maintenance job with the completed-turn context.
4. A quiet reviewer runs with restricted tools and timeout.
5. The reviewer emits memory and skill actions through host gateways.
6. The host validates, applies, logs, and reports outcomes.

The user-facing run must not wait on the maintenance job unless explicitly requested by an operator command.

## Reviewer Context

The reviewer should receive:

- The user message.
- The final assistant response.
- Relevant tool/action summary.
- Loaded skills for the run.
- Existing matching skill names and descriptions.
- Recent memory search results when memory review is enabled.
- Learning signal summary from the host.
- Current group identity and scope.

The reviewer should not receive broad filesystem access or raw unrestricted source access.

## Skill Mutation Rules

Allowed actions:

- List skills.
- View skill metadata and content through `skill_action`.
- Create an agent-owned runtime skill.
- Patch an agent-owned runtime skill.
- Pin or unpin an agent-owned runtime skill.
- Archive an agent-owned runtime skill.
- Restore an archived agent-owned runtime skill.
- Roll back an agent-owned runtime skill patch.

Disallowed actions:

- Direct file edits to skill directories.
- Mutating repo-tracked skills.
- Mutating personal skills.
- Deleting skills permanently as part of automatic maintenance.
- Creating skills without a reusable task class.
- Creating near-duplicate skills when a patch would be better.

## Curator Behavior

The idle curator should perform broader skill hygiene:

- Detect duplicate or overlapping agent-created skills.
- Consolidate narrow skills into broader umbrella skills.
- Move long examples or templates into support files when supported.
- Mark unused skills stale.
- Archive stale skills after the archive threshold.
- Reactivate stale skills when usage resumes.
- Respect pinned skills.
- Write a structured report for every run.

The curator should be able to recommend source-owned skill changes, but not apply them.

## Observability

Every self-improvement pass should produce a structured event.

Minimum fields:

- `run_id`
- `group_id`
- `review_type`
- `trigger_reason`
- `signals_detected`
- `memory_actions`
- `skill_actions`
- `created_skills`
- `patched_skills`
- `archived_skills`
- `noop_reason`
- `duration_ms`
- `success`
- `error`

Operator-facing logs should be concise. Full details can go to the group log directory.

## Operator Controls

Add or preserve controls for:

- Enable or disable all self-improvement.
- Enable or disable memory review.
- Enable or disable skill review.
- Enable or disable idle curator.
- Run review once for the last turn.
- Run curator now.
- Dry-run review without writes.
- Show recent self-improvement reports.
- Roll back a skill patch.
- Pin a skill.
- Archive or restore a skill.

Environment/config names should follow existing FFT_nano naming conventions.

## Suggested Implementation Phases

### Phase 1: Better Signals and Reports

- Add host-side learning signal extraction.
- Add structured self-improvement reports.
- Preserve current cadence.
- No scheduling changes yet.

### Phase 2: Memory Review Split

- Add a separate quiet memory reviewer.
- Route durable facts/preferences to `memory_action`.
- Keep skill reviewer focused on procedures.

### Phase 3: Proactive Post-Turn Review

- Run lightweight review after successful non-heartbeat turns.
- Use signal-triggered full review for high-value cases.
- Keep interval thresholds as backstop.

### Phase 4: Real Idle Curator

- Add an idle scheduler.
- Enforce `minIdleHours`.
- Run curator without requiring a user message.
- Snapshot before mutation.

### Phase 5: Loaded-Skill Feedback

- Track skills loaded or used in a run.
- Feed loaded-skill context into the reviewer.
- Prefer improving relevant agent-created skills over creating new skills.
- Create reports for source-owned skill gaps.

## Success Criteria

The improved system is working when:

- Durable corrections from users are reflected in memory or skills.
- Repeated troubleshooting procedures become reusable skills.
- The agent improves agent-owned skills without touching source-owned skills.
- Idle curator reports show consolidation and lifecycle decisions.
- Maintenance no-ops are explainable.
- User-facing responses are not delayed by maintenance.
- Operators can audit and roll back skill changes.

## Core Principle

FFT_nano should become more proactive like Hermes Agent in when it reviews and how assertively it looks for reusable learning.

It should not become more permissive in what the agent can mutate.

The correct design is proactive review with conservative, host-enforced writes.
