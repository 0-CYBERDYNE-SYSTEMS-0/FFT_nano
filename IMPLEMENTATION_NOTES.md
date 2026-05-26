# FFT Simplification Implementation Notes

Updated: 2026-05-26

## Decisions Made Beyond SPEC.md

- Kept `src/index.ts` as a delegating orchestration layer instead of forcing it to the approximate 1,500-line target. It is now 2,071 lines, down from 8,030, with the duplicated Telegram delivery/settings implementations removed.
- Preserved compatibility imports by making `src/message-dispatch.ts` a thin re-export to `src/pipeline/message-dispatch-pipeline.ts`. This avoids broad import churn while moving the canonical dispatch implementation under `src/pipeline/`.
- Consolidated host IPC event names conservatively without changing the external legacy TUI `chat` / `agent` frame concepts. `tool_progress` and `run_progress` remain separate because tests and consumers distinguish them.
- Updated `HANDOFF.md` to reflect the current implementation state so future work does not restart completed milestones.
- Suppressed false visible "Waiting for approval to continue" progress for fire-and-forget extension UI events. The wait progress event now only emits for blocking extension UI requests that can actually require an operator response.

## Tradeoffs

- The pipeline migration is structural first: message dispatch now lives under the pipeline layer, but the existing detailed dispatcher logic was preserved rather than rewritten into smaller pipeline classes in the same pass. This reduces regression risk for queueing, finalization, and active-run behavior.
- The runtime event consolidation removes stale and redundant event kinds while keeping projection behavior stable for the gateway.
- The approval-message fix was made at the `pi-runner.ts` source instead of masking the Telegram text downstream. This keeps real permission waits visible while preventing ordinary UI decoration events like `notify` from looking like approval gates.
- Full release verification required elevated execution because this sandbox blocks local IPC sockets and localhost port binds used by `tsx`, TUI gateway tests, and web control center tests.

## Verification Completed

- `npm run typecheck`
- `npm test` — 666 pass, 0 fail, 2 skipped
- `npm run release-check` — passed skills validation, typecheck, tests, secret scan, and pack content check
- `git diff --check`

## Runtime Deployment Notes

- `origin/main` must remain untouched for this validation.
- The feature branch is `feat/fft-simplification-spec`.
- The installed runtime checkout is `/Users/scrimwiggins/FFT_nano`.
- Before switching the runtime checkout off `main`, preserve the current local `main` state with both a local backup ref and a stash for dirty work.
