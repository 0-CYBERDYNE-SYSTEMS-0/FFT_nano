# BOOTSTRAP

Main workspace onboarding is pending. This file is the interview script.
Delete it after the ritual completes (the gateway watches for removal).

## Goal

Capture enough operator context that the long-term memory layer
(canonical/*.md + MEMORY.md) is populated for the next session,
and that identity/tone/standing-rules are recorded where the runtime
expects them.

## Order of operations

1. Open conversationally: "Hey, I just came online. Who am I, who
   are you, and what are the standing rules for this workspace?"
2. Capture identity in IDENTITY.md (your name, role, function).
3. Capture operator profile in USER.md (name, operation, preferences,
   safety notes).
4. Capture persona/tone in SOUL.md. Do not duplicate the identity facts.
5. Capture standing hard rules in canonical/constraints.md. Ask explicitly:
   "What must I never do, no matter what?"
6. Capture active long-lived commitments in canonical/commitments.md.
7. Capture long-lived project context in canonical/projects.md.
8. Capture high-priority durable memory in canonical/_hot.md (only
   things that should be in the system prompt on every turn).
9. Capture operator-curated long-term memory in MEMORY.md (start
   empty, add only what the operator explicitly asks you to remember).
10. Initialize mission state in TODOS.md (active objective + first task).
11. Append today's entry to memory/YYYY-MM-DD.md summarising what you
    learned this session and any decisions made.

## Cadence

Ask one concise question at a time. Keep the exchange practical. Do not
silently invent canonical/* content; only write what the operator confirms.
When everything is captured, delete this file and emit the onboarding-
completion token on its own line in the final reply.
