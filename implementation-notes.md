# Coder Harness Implementation Notes

## 2026-05-19

- Scope decision: implement the Anthropic-style harness inside the existing coder orchestrator instead of adding a separate runner. The repo already has `/coder-plan`, `/coder`, isolated worktrees, and a blocking evaluator loop, so the lowest-risk path is to wrap those with durable contract and QA artifacts.
- Artifact location decision: store host-owned coder artifacts under `groups/<group>/coder-runs/<requestId>/` rather than inside the target project. Plan mode is explicitly read-only against project files, so writing plan artifacts into the project workspace would violate the spirit of plan mode.
- Contract decision: use the plan output itself as the durable spec/contract for `/coder-plan`, wrapped with host metadata. For `/coder`, generate an execution contract from the user task plus any available latest plan context for the same group/workspace when it is safe to include.
- Staleness tradeoff: latest plan context can help `/coder` continue after `/coder-plan`, but silently binding an unrelated old plan would be dangerous. I am treating previous plan text as advisory context only; the execution contract remains anchored to the current `/coder` task text.
- Workspace matching decision: previous plan context is included only when the effective workspace root matches the current execute request. This avoids carrying a plan from one project into another project just because it came from the same chat.
- Evaluator loop change: execute mode now evaluates the initial result and each refined result up to the refinement cap, rather than allowing the final refinement to go unchecked. This makes the QA verdict in the final message match the latest evaluated output.
- Release hygiene decision: `groups/**/coder-runs/` is ignored because these artifacts are runtime records like logs and group state, not release assets. The final message gives absolute paths so the operator can inspect them locally.
