---
name: code-first-responder
description: "Guides the agent through a short, repeatable debug loop: capture
  the failure, isolate the scope, draft a patch plan, and log the decision so
  the next agent can continue without rereading the entire repo."
allowed-tools: run_command read_file search_code write_file
metadata:
  legacy_slug: code_first_responder
  legacy_summary: Deterministic triage flow for failing tests or regressions.
  legacy_version: 0.1.0
  legacy_author: ff-terminal-core
  legacy_priority: default
  legacy_tags: '["code","debugging","testing"]'
  legacy_triggers: '["bug","failing test","stack trace","regression","error","traceback"]'
  legacy_assets: '["templates/debug_report_template.md","templates/fix_checklist.md"]'
  legacy_recommended_tools: '["run_command","read_file","search_code","write_file"]'
---

# Code First Responder

## When to use this skill
- Use when the user request matches this skill's domain and capabilities.
- Use when this workflow or toolchain is explicitly requested.

## When not to use this skill
- Do not use when another skill is a better direct match for the task.
- Do not use when the request is outside this skill's scope.

## When to load this skill
- Incoming task references failing tests, stack traces, or recent merges.
- User explicitly wants a "quick triage", "first look", or "rough fix plan".
- Another skill (e.g., Rapid Research) flagged new code issues that need confirmation.

## Guardrails
1. Never edit files before the failure is reproduced locally.
2. Capture the exact command + exit code inside the debug report template.
3. Prefer minimal diffs; defer major refactors to a follow-up task.
4. If the failure cannot be reproduced quickly, escalate with the captured evidence and leave the repo untouched.

## Five-step micro-playbook
1. **Snapshot context**
   - Record branch, latest commit hash, and dirty files.
   - Paste the failure summary into `templates/debug_report_template.md`.
2. **Reproduce fast**
   - Run the narrowest test or script possible.
   - Store the exact CLI command and snippet of output.
3. **Isolate scope**
   - Identify the component or file set causing the issue.
   - Outline suspected root causes without editing yet.
4. **Propose fix plan**
   - List concrete actions (edit file X, update test Y, run command Z).
   - Mark each action as `must`, `optional`, or `blocked`.
5. **Optional patch**
   - If the fix is obvious (<30 lines), apply it and run validation.
   - Update the debug report with the diff summary and test status.

## Output checklist
Refer to `templates/fix_checklist.md` and ensure every box is addressed:
- Failure reproduced?
- Minimal scope understood?
- Plan or patch documented?
- Validation command + result captured?
- Handover note written?

## Response snippet to send back to the user
```
## Debug Status
- Branch/commit: ...
- Failure reproduced: yes/no (command)
- Root-cause hypothesis: ...
- Next actions: ...

## Attachments
- debug_report_template.md (updated)
```

## Companion tools
- `run_command` for fast tests.
- `read_file` + `search_code` for targeted inspection.
- `write_file` for updating the templates and final report.
