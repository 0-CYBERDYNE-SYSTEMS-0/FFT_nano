---
name: loops
description: "Design agent loops instead of prompting turn-by-turn: pick the right loop type (turn-based, goal-based, time-based, proactive), define stop conditions and verification, and control token burn. Use when the user wants recurring/autonomous agent work, asks 'make this run until done', 'check X every N minutes', 'keep iterating until tests pass', or asks which loop primitive to reach for. Based on Anthropic's 'Getting started with loops'."
---

# Loops

A loop is an agent repeating cycles of work — gather context, act, verify — until a stop condition is met. Stop being the loop yourself: encode the trigger, the work, the verification, and the exit, then let the agent run.

Before building anything, answer three questions:

1. **Can success be verified mechanically?** (tests pass, score ≥ N, queue empty)
2. **Is the trigger a person, a goal, a clock, or an event?**
3. **What is the hard stop?** (goal met, max turns, cancellation)

If you can't answer #1, fix that first — a loop without verification just burns tokens confidently.

## Choose the loop type

| Loop type | Triggered by | Stops when | Best for | Reach for |
|---|---|---|---|---|
| Turn-based | User prompt each turn | Agent judges task done / needs input | Exploration, decisions, short non-recurring tasks | Verification skills |
| Goal-based | One prompt with success criteria | Goal met OR max-turn cap | Tasks with verifiable exit criteria | Goal runner (`/goal` or equivalent) |
| Time-based | Clock interval or schedule | Cancelled or work complete | Recurring checks, external systems (CI, PRs, inboxes) | Interval runner (`/loop`), cloud scheduler (`/schedule`, cron) |
| Proactive | Events/schedules, no human in the loop | Each task exits at its goal; routine runs until disabled | Well-defined recurring work: triage, migrations, bug intake | Scheduler + goals + skills + subagent workflows combined |

Escalate only as needed: don't build a proactive routine for something a single goal-based run finishes this afternoon.

## 1. Turn-based loops

You direct each turn; the agent iterates within it. The lever is **verification you encode once**: put your quality bar in a skill so every turn self-checks before declaring done.

Example verification skill content: start the dev server, exercise the changed flow, check console for errors, run the perf/lint audit, only then report complete. Quantitative checks beat vibes.

Token control: specific prompts, and skills instead of re-explaining standards every turn.

## 2. Goal-based loops

Don't let the agent decide "good enough" — you define success, an evaluator checks it, and the loop either exits or goes back for another iteration.

```
/goal get the homepage Lighthouse score to 90 or above, stop after 5 tries
```

Rules:
- Criteria must be deterministic and checkable: test pass rate, score threshold, build green. "Make it better" is not a goal.
- Always set an explicit turn/attempt cap. The cap is your budget.
- If the goal keeps failing at the cap, the loop design is wrong — tighten the goal or split it; don't just raise the cap.

## 3. Time-based loops

For work that arrives on a clock or lives in external systems the agent can't be notified about.

```
/loop 5m check my PR, address review comments, and fix failing CI
```

- Local interval runner (`/loop`) for things tied to your machine/session; cloud scheduler (`/schedule`, cron, launchd) for routines that should survive without you.
- Match the interval to how fast the watched thing actually changes — polling a nightly job every 5 minutes is pure waste.
- Prefer event triggers (webhook, notification) over polling whenever the system offers one.

## 4. Proactive loops

No human in the loop: an event or schedule fires, the agent triages, acts, verifies, and responds on its own. Compose the other primitives — scheduler + goal criteria + skills + subagent workflows.

Example routine: "Check #project-feedback hourly. Don't stop until every report is triaged, actioned, and responded to. When fixing bugs, explore three candidate solutions and have a second agent adversarially review before merging."

Rules:
- Only automate work you've already watched succeed in supervised runs.
- Route routine steps to smaller/cheaper models; reserve the capable model for judgment calls and review.
- Every task inside the routine needs its own exit condition; the routine itself runs until disabled.

## Keeping quality high inside a loop

- Keep the codebase clean — the agent amplifies whatever patterns it finds.
- Encode standards and verification steps as skills so they apply on every iteration, not just when you remember to say them.
- Make framework/library docs easily reachable (local copies, links in skills) so the loop doesn't guess.
- Use a second agent for code review — self-review is biased.
- When a loop produces a bad result, don't just fix the output: encode the fix (skill, check, doc) so the next iteration can't repeat it.

## Managing token burn

- Pick the simplest primitive that works; multi-agent proactive routines are the last resort, not the default.
- Specific success criteria = fewer wasted turns.
- Pilot on a small slice before scaling a dynamic workflow to the full dataset/repo.
- Push deterministic steps into scripts — a script is cheaper than reasoning through the same steps every cycle.
- Set intervals by the watched system's rate of change, not by impatience.
- Review usage regularly (`/usage`, goal turn counts, per-workflow breakdowns) and tune the loop, the model mix, or the interval.

## Getting started

Find the bottleneck work you keep manually shepherding, then ask: Can I write a verification check for it? Is the goal crisp? Does it arrive on a schedule or event? Pick the matching loop type, run it small, watch where it stalls or over-reaches, and iterate on the loop design — not just the prompt.

## Platform mapping

The primitives above are Claude Code's names. On other hosts, map the concepts:

| Concept | Claude Code | Other hosts |
|---|---|---|
| Goal runner | `/goal` | One prompt with explicit success criteria + attempt cap, re-invoked until evaluator passes |
| Interval runner | `/loop`, ScheduleWakeup | cron/launchd job re-invoking the agent CLI with the same prompt |
| Cloud routine | `/schedule` | Hosted scheduler, gateway cron, CI scheduled workflow |
| Verification skill | SKILL.md | Same SKILL.md format, or a checked-in verify script the loop must run |
| Cheap-model routing | subagent model field | Point routine steps at a smaller provider/model in your agent's config |
