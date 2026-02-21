# Container Agent Runner

Primary files:
- `container/agent-runner/src/index.ts`
- `container/agent-runner/src/coder-worker.ts`
- `container/agent-runner/src/memory-tool.ts`

## Purpose

This runtime is the in-container bridge between host input JSON and the `pi` coding agent CLI.

Host sends `ContainerInput` JSON over stdin; runner returns `ContainerOutput` JSON between sentinel markers.

## Input Normalization

Runner normalizes:
- `codingHint`
- `thinkLevel`
- `reasoningLevel`
- `noContinue`

Then builds system prompt sections including:
- capabilities/tooling instructions
- workspace conventions
- memory context or memory file fallback
- delegation policy hints (when extension available)

## `pi` Invocation Details

`pi` args include:
- `--mode json`
- optional `-c` (continue session)
- optional provider/model overrides
- optional thinking mode
- optional extension injection for delegation
- `--append-system-prompt <assembled prompt>`
- explicit tool allowlist: `read,bash,edit,write,grep,find,ls`

Environment includes:
- `PI_CODING_AGENT_DIR=/home/node/.pi/agent-farmfriend`
- request/chat/coding hint metadata vars

## Output Parsing

Runner parses JSON event stream lines from `pi` stdout.

Collected output:
- final assistant text
- streamed flag
- usage fields (input/output/total tokens + provider/model)

Error handling:
- captures model stop-reason errors
- throws non-zero `pi` exit as container output error

## Delegated Worker

`coder-worker.ts` is used for delegated coding execution/plan runs.

Capabilities:
- tracks tool execution stats
- captures changed files via git dirty-set comparison
- emits progress updates via IPC message files
- enforces safer behavior in plan mode vs execute mode

## Memory Tool CLI

`memory-tool.ts` allows in-container read/search through host memory gateway over IPC:
- `memory-tool search --query ...`
- `memory-tool get --path MEMORY.md`

The tool writes request JSON to `/workspace/ipc/actions`, then waits for matching result JSON in `/workspace/ipc/action_results`.
