# Pi Runner And Coding Worker

Primary files:
- `src/pi-runner.ts`
- `src/coding-orchestrator.ts`
- `src/system-prompt.ts`
- `src/pi-json-parser.ts`

## Purpose

FFT_nano no longer uses a separate in-container delegated coder worker file.

The host now has two layers:
- `runContainerAgent(...)` in `src/pi-runner.ts` is the low-level `pi` process launcher.
- `createCodingOrchestrator(...)` in `src/coding-orchestrator.ts` is the host-side coding worker lifecycle manager for `/coder`, `/coding`, auto-routed coding asks, and `/subagents`.

## Pi Runner Input

`ContainerInput` supports:
- prompt/group/chat metadata
- provider/model overrides
- think/reasoning/verbose modes
- `codingHint`
- `toolMode=default|read_only|full`
- `workspaceDirOverride`
- `noContinue`

`toolMode` is the important host-side isolation control:
- `read_only` -> `read,grep,find,ls`
- `full` -> `read,bash,edit,write,grep,find,ls`

## Workspace Selection

`runContainerAgent(...)` resolves workspace paths from:
- main workspace for main chat runs
- group folder for non-main runs
- `workspaceDirOverride` when the coding orchestrator assigns an isolated worktree

That lets execute-mode coder runs operate in a real separate workspace without mutating the live one.

## Pi Invocation

`pi` runs with:
- `--mode json`
- optional `-c`
- optional provider/model/api-key flags
- `--append-system-prompt <assembled prompt>`
- explicit tool allowlist derived from `toolMode` or legacy `codingHint`

## Output Parsing

`parsePiJsonOutput(...)` extracts:
- final assistant text
- usage fields
- tool execution summaries

`runContainerAgent(...)` also emits runtime tool events to the host and returns parsed `toolExecutions` so the coding orchestrator can build `commandsRun` and `testsRun`.

## Host Coding Worker

Execute-mode worker flow:
1. Create isolated git worktree.
2. Sync current workspace snapshot into it.
3. Run `pi` with `toolMode=full` in that worktree.
4. Return structured result with changed files, diff summary, worktree path, commands, and tests.

Plan-mode worker flow:
1. Skip worktree creation.
2. Run `pi` with `toolMode=read_only`.
3. Return structured plan result.

If worktree creation fails, the host returns an explicit error and does not fall back to mutating the live workspace.
