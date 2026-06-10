# FFT_nano Corrigible Learning Handoff

## Objective

Implement the complete corrigible-learning specification across multiple developers without dropping or weakening any normative invariant, workstream requirement, acceptance criterion, migration note, or non-goal.

This handoff is operational context only. It does not replace the specification.

## Canonical Source

- Spec: `/Users/scrimwiggins/fft_nano-dev/corrigible-learning-spec.md`
- SHA-256: `5cad7407c98bab6477e165340c21dbd25c7f37f1c043a52b1a8f6937ddd7805e`
- Measured size: 361 lines, 19,571 bytes

Before starting or reviewing implementation:

1. Read the complete spec.
2. Verify its checksum.
3. If the checksum differs, identify and review the spec change before continuing.
4. Treat the spec's invariants as normative. Implementation plans may refine mechanics but may not silently reduce scope.

The spec is currently untracked in the development checkout. Preserve it durably in version control before relying on this temporary handoff as a coordination mechanism.

## Repository State

- Checkout: `/Users/scrimwiggins/fft_nano-dev`
- Branch: `codex/lean-stable-prompt`
- HEAD when this handoff was created: `9e6c167a06cb3584b9da793f48092dfa6b7c9db1`
- Existing unrelated change: `package-lock.json` is modified.
- Untracked canonical artifact: `corrigible-learning-spec.md`.

Do not revert, overwrite, or accidentally include the existing `package-lock.json` change. Re-check current state before acting because this handoff records a point in time.

## Current Status

- Architecture and implementation-path investigation completed.
- No corrigible-learning implementation files have been modified.
- No acceptance tests have been added.
- Every requirement below remains pending.

## Material Engineering Findings

These findings refine implementation mechanics while preserving the spec:

1. **Host-side run authority is required.** Message, file-delivery, action, and scheduling IPC are processed asynchronously. The IPC watcher currently knows the source group but cannot reliably attribute a file to the run that authored it. Add a host-issued, unpredictable run authority identifier and resolve permissions from host state rather than agent-authored fields.

2. **Check effective tools, not only `toolMode: 'full'`.** Scheduled and cron calls currently omit `toolMode`, while Pi's default tool set still includes mutating tools. Sandbox refusal must be based on the effective tool set and run origin.

3. **Task approval and outbound authority are separate decisions.** An approved agent-created task remains `created_by='agent'`. Approval permits execution; it must not silently grant outbound delivery. Operator-created tasks carry the implicit grant described by the spec.

4. **The host IPC boundary is authoritative.** The Pi permission extension can provide early UX confirmation or blocking, but it cannot secure asynchronous message, file, scheduling, webhook, or action IPC by itself.

5. **Operator identity needs sender-level persistence.** A main chat JID identifies a chat, not necessarily the person who sent a message. Persist the owner sender JID when `/main` claims the channel, and support the configured per-group operator allowlist.

6. **Use the latest inbound sender and text for provenance.** Do not infer sender role from the assembled prompt, which may contain historical messages from several people.

7. **I2 needs host-enforced mutation bounds.** Reviewer launch debounce alone does not prevent one reviewer run from issuing many skill or memory mutations. Enforce per-run and rolling mutation budgets at the host mutation gateways.

8. **Memory mutations need attribution and reversibility.** Existing memory writes generally keep only a single `.bak`. A time-based corrigibility window and `/learning` memory-write digest require durable mutation audit entries and versioned memory snapshots.

9. **I5 applies to durable memory as well as skills.** Third-party textual signals may create candidates or light review signals, but must not directly become durable state. Host-observed tool evidence may produce agent-inferred learning.

10. **Evaluator outcomes need a discriminated internal result.** Separate evaluated verdicts, eligible evaluator failures, and threshold/ineligible no-ops. Persist only eligible failures as skipped outcomes; do not let skipped rows affect pass rates.

11. **Efficacy is correlational.** Exclude skipped verdicts, compare compatible run types/time windows, require sufficient with/without samples, and avoid causal language or automatic archival.

12. **Record only content actually injected.** Learning injection rows must describe items present in the final rendered prompt after selection and truncation.

## Recommended Delivery Order

Use independently reviewable increments with explicit contracts between developers:

1. Sandbox refusal and doctor reporting.
2. Host run-authority foundation and request IDs for autonomous runs.
3. WS2 task provenance, pending approval, Telegram controls, task audit, and forced evaluation recording.
4. WS1 action categories, host outbound enforcement, held outbox state, and notification dedupe.
5. WS3 sender provenance, durable-learning provenance, advisory prompt framing, mutation budgets, mutation audit, and memory history.
6. WS4 evaluator recording chokepoint, fail-visible skips, alert cooldown, and sampled chat evaluation.
7. WS5 injection tracking, efficacy query, and curator context.
8. WS6 time-based retention, global pause, and `/learning` digest.

Do not merge WS1 outbound enforcement before the run-authority and task-provenance contracts it relies on. Parallel branches may proceed against agreed interfaces, but integration should follow this dependency order.

## Parallel Ownership Boundaries

Suggested ownership slices:

- **Safety/runtime developer:** sandbox mode export, effective tool classification, spawn refusal, doctor, bash guard.
- **Authority/IPC developer:** run-authority registry, authority propagation, host boundary attribution, request IDs.
- **Scheduling/UI developer:** task schema, approval panel, callbacks, task audit, auto-approve behavior.
- **Learning provenance developer:** sender roles, operator identity, skill/memory provenance, mutation budgets and audit.
- **Evaluator developer:** outcome model, persistence chokepoint, skip alert, chat sampling.
- **Efficacy/digest developer:** injection rows, efficacy queries, retention, pause, `/learning`.

Shared files likely to cause conflicts include `src/db.ts`, `src/types.ts`, `src/parity-config.ts`, `src/host-coordination.ts`, `src/pi-runner.ts`, `src/telegram-commands.ts`, and `src/wiring.ts`. Agree on type/schema contracts first and keep commits narrowly scoped.

## Requirement Coverage Matrix

Status vocabulary: `pending`, `in progress`, `implemented`, `tested`, `blocked`.

| ID | Requirement | Status |
|---|---|---|
| WS1.1 | Action categories and deterministic classification | pending |
| WS1.2 | Gate decisions by category and run origin | pending |
| WS1.3 | Unsandboxed autonomous mutating-run refusal and doctor check | pending |
| WS1.4 | Defense-in-depth bash patterns and bypass tests | pending |
| WS2.1 | `created_by` migration and `pending_approval` status | pending |
| WS2.2 | Agent scheduling defaults to pending approval | pending |
| WS2.3 | Main-chat Telegram approve/reject surface | pending |
| WS2.4 | Durable task lifecycle audit including deletion | pending |
| WS2.5 | Forced, recorded evaluation for agent-created task runs | pending |
| WS2.6 | Explicit `cron.agentTasks.autoApprove` compatibility setting | pending |
| WS3.1 | Sender role and operator allowlist | pending |
| WS3.2 | Trust-aware learning-signal escalation | pending |
| WS3.3 | Validated/defaulted skill provenance | pending |
| WS3.4 | Advisory-only framing around learned prompt content | pending |
| WS3.5 | Sender role and downgrade observability | pending |
| WS4.1 | Evaluator skip schema | pending |
| WS4.2 | Record eligible evaluator failures without skewing pass rate | pending |
| WS4.3 | Degraded-signal alert with 24-hour dedupe | pending |
| WS4.4 | Auditable sampled evaluation of actionful chat runs | pending |
| WS4.5 | Single evaluator recording chokepoint | pending |
| WS5.1 | `learning_injections` schema and index | pending |
| WS5.2 | Stamp actual memory, skill, and issue injections | pending |
| WS5.3 | Minimum-sample skill efficacy query | pending |
| WS5.4 | Curator receives human-readable efficacy context only | pending |
| WS6.1 | Newest-10 OR configured time-floor history retention | pending |
| WS6.2 | Deterministic `/learning` digest from existing/audit stores | pending |
| WS6.3 | Persisted global pause checked by every specified loop | pending |

Additional invariant-enforcement tasks discovered during planning:

| ID | Requirement | Status |
|---|---|---|
| INV.1 | Host-issued run authority for asynchronous IPC attribution | pending |
| INV.2 | Host-enforced learning mutation budgets | tested |
| INV.3 | Attributed, versioned, reversible memory mutations | pending |
| INV.4 | Third-party textual learning remains candidate-only | pending |
| INV.5 | Every autonomous loop records meaningful no-op events | pending |

## Completion Definition

The project is not complete until:

- All six workstreams and every numbered change in the canonical spec are implemented.
- Every acceptance criterion in the canonical spec has a corresponding automated test or documented integration verification.
- All normative invariants remain true across interactive, subagent, cron, scheduled, heartbeat, evaluator, and maintenance paths.
- Config defaults and upgrade overrides are documented.
- Additive migrations work against an existing database and a fresh database.
- Operator-created cron announcements remain compatible.
- Held outbound payloads are never sent by normal pending-outbox flushes.
- Global pause and rate limits are enforced by the host, not only by prompts.
- No learned state can modify gate policy, evaluator policy, host code, or action authorization.
- The complete test and release gate passes on the exact candidate commit.

Required closeout commands:

```bash
npm run typecheck
npm test
npm run validate:skills
npm run release-check
npm run secret-scan
git diff --check
git status --short
```

## Collaboration Protocol

- Give every PR/commit a list of requirement IDs it covers.
- Update this matrix or the team's durable tracker after merge, not merely after implementation.
- Require tests to name the acceptance behavior they prove.
- Do not mark a requirement complete because a supporting schema or helper exists; mark it complete only after the end-to-end behavior is verified.
- Record interface decisions affecting multiple branches in a durable ADR, issue, or tracked plan rather than relying on chat.
- Rebase or coordinate before editing shared wiring/schema files.
- Run an integration review after each phase: P0, P1, and P2.

## Suggested Skills

- `tdd`: implement each acceptance criterion through focused red-green-refactor loops.
- `design-an-interface`: agree on run-authority, evaluator-outcome, audit-event, and mutation-budget interfaces before parallel implementation.
- `diagnose`: investigate integration failures or behavioral regressions.
- `review`: compare each branch against repository standards and the canonical spec.
- `autoreview`: closeout review before committing, opening a PR, or shipping a phase.
- `to-issues`: convert the requirement matrix into independently assignable tracker issues after the canonical spec is durable.
- `handoff`: refresh operational context whenever ownership or sessions change.

## First Actions for the Next Lead

1. Make the canonical spec durable and reviewable without altering its meaning.
2. Establish a durable issue/PR matrix using the requirement IDs above.
3. Define and review the shared run-authority and evaluator-outcome interfaces.
4. Assign ownership slices and shared-file coordination rules.
5. Begin with the sandbox boundary and run-authority foundation.
