# Coding Delegation

Primary files:
- `src/coding-delegation.ts`
- delegation routing in `src/index.ts`
- delegated worker in `container/agent-runner/src/coder-worker.ts`

## Delegation Trigger Parser

`parseDelegationTrigger(text)` supports:
- `/coder ...` -> execute delegation
- `/coder-plan ...` -> plan delegation
- `/coder_plan ...` -> plan delegation
- exact alias phrase `use coding agent`
- exact alias phrase `use your coding agent skill`

Natural-language coding requests without explicit triggers do not force delegation.

## Main-Only Constraint

Delegation is blocked for non-main chats.

When blocked, host replies with safety message and does not delegate.

## Runtime Hints

Per run, host passes `codingHint` into container input:
- `none`
- `auto`
- `force_delegate_execute`
- `force_delegate_plan`

Container agent-runner uses this to decide whether to instruct extension-based delegation.

## Delegation Extension Conditions

In-container extension loading requires all:
- run is main chat
- run is not scheduled task
- delegation extension file exists (`/app/dist/extensions/pi-on-pi.js`)

If explicit delegation requested but extension unavailable, system falls back to direct handling with explicit status in system prompt.

## Subagent Management Commands

Main chat command family:
- `/subagents list`
- `/subagents stop current|all|<requestId>`
- `/subagents spawn <task>`

Host tracks active runs in-memory (`activeChatRuns`, `activeCoderRuns`) and supports abort through `AbortController`.

## Delegated Worker Execution

`runDelegatedCodingWorker(...)` in container worker:
- supports `mode=plan|execute`
- plan mode: no file mutation expected
- execute mode: performs file edits/checks as requested
- streams progress to chat via IPC messages when allowed
- tracks tool execution stats and changed file sets

## Auditable Request IDs

Delegated runs use request ids such as:
- `coder-<timestamp>-<rand>`
- `subagent-<timestamp>-<rand>`

These ids are included in status text and can be used for stop/list operations.
