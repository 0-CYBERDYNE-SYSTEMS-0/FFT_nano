# Gap Analysis: `src/` vs Previous `docs-site`

This file captures concrete mismatches found while comparing implementation to prior docs-site content.

## High-Impact Mismatches Fixed

1. Incorrect source tree references.
- Previous docs referenced non-existent directories like `src/whatsapp/`, `src/telegram/`, `src/scheduler/`.
- Actual implementation uses flat module files (`src/telegram.ts`, `src/task-scheduler.ts`, etc.).

2. Missing runtime command surface.
- Previous docs did not fully document Telegram admin/user command behavior implemented in `src/index.ts`.
- Command set now documented with main vs non-main constraints.

3. Incomplete env var contract.
- Previous docs listed variables not used by host runtime and omitted host-critical vars actually used in code.
- Env table now derived from `process.env.*` references in `src/*.ts` and shell scripts.

4. Insufficient IPC and scheduler contract docs.
- Previous docs described scheduling conceptually but did not publish concrete JSON contract payloads.
- Current docs include exact IPC task/action payloads and authorization constraints from `processTaskIpc` and action gateways.

5. Missing memory subsystem internals.
- Previous docs did not describe retrieval-gated memory context, FTS transcript search, path allowlist rules, and compaction migration behavior.

6. Missing farm action and production gating details.
- Previous docs omitted enforcement logic requiring production validation pass before control actions.

7. Missing module-level API coverage.
- Previous docs had high-level sections only.
- Current docs include per-module reference pages for every file in `src/`.

## Current Coverage Standard

Coverage target for this documentation rebuild:
- Every `src/*.ts` module has a reference page.
- All exported APIs are listed per module.
- Runtime flows are documented end-to-end from message ingress to container result egress.
- Operational controls (commands, task IPC, action IPC) are documented with payload schema examples.
- Security boundaries (mount allowlist, main-chat gates, non-main restrictions) are documented with source references.

## Residual Risks

1. Runtime behavior can drift as code changes.
- Mitigation: module pages are generated from exports and should be refreshed on release.

2. External dependency behavior may change.
- Mitigation: this docs set describes host-side contracts and code-owned guarantees; external API quirks are noted where relevant.
