# Quality rubric (12 points)

Score only skills that were flagged by the facts pass or that the user asked
about. A score is a diagnostic aid, not a finding by itself — findings still
have to pass the triage gates.

## Routing (0-4) — can an agent decide correctly WHEN to fire this skill?

- +1 description says what the skill does
- +1 description says when to use it (trigger phrases, "use when...")
- +1 description carries the keywords a real request would contain
- +1 description also excludes near-miss cases ("not for X") when a sibling
  skill could be confused with it

## Content (0-4) — once fired, does the body actually help?

- +1 concrete step-by-step instructions (not vibes: commands, paths, order)
- +1 examples of correct input/output or a worked example
- +1 edge cases and failure handling addressed
- +1 knows its limits: says what to do when the procedure doesn't apply

## Economy (0-4) — does it respect the context budget?

- +1 body under ~500 lines / ~5k tokens
- +1 detail pushed to references/ and loaded on demand, not inlined
- +1 no dead weight: every bundled file is referenced and every referenced
  file exists
- +1 metadata is lean: description does its routing job in as few tokens as
  it can (a 950-char description that could be 300 chars fails this)

## Interpreting scores

- 10-12: exemplary — cite as the library's house style
- 7-9: healthy — NOTHING unless a specific gate is triggered
- 4-6: works but degrades routing or budget — usually COULD, SHOULD only if
  the skill is frequently used
- 0-3: placeholder or broken — SHOULD (or MUST if actively relied upon)

## Overlap clusters

When two or more skills score similarly on Routing but their descriptions
could claim the same request, that's a coherence finding independent of the
individual scores. Evidence to cite: the overlapping description fragments.
Resolution options, in order of preference: sharpen the descriptions to
partition the space; merge the skills; retire one (archive, don't delete).
