# Coding Delegation

Primary files:
- `src/coding-delegation.ts`
- `src/coding-orchestrator.ts`
- routing in `src/message-dispatch.ts`
- command handling in `src/telegram-commands.ts`

## Trigger Parsing

`parseDelegationTrigger(text)` supports:
- `/coder ...` -> execute worker
- `/coding ...` -> execute worker alias
- `/coder-plan ...` -> plan worker
- `/coder_plan ...` -> plan worker
- exact alias phrase `use coding agent`
- exact alias phrase `use your coding agent skill`

`isSubstantialCodingTask(text)` is the host-side heuristic for auto-routing substantial main-chat software-engineering asks to the execute worker.

## Main-Only Constraint

Coder orchestration is main-chat-only.

When blocked, the host replies with a safety message and does not start a worker.

## Host-Side Orchestration

`createCodingOrchestrator(...)` owns real coding worker lifecycle on the host.

Worker request contract includes:
- `requestId`
- `parentRequestId?`
- `mode=plan|execute`
- `route`
- `originChatJid`
- `originGroupFolder`
- `taskText`
- `workspaceMode`
- `timeoutSeconds`
- `allowFanout`
- `sessionContext`

Worker result contract includes:
- `status`
- `summary`
- `finalMessage`
- `changedFiles`
- `commandsRun`
- `testsRun`
- `artifacts`
- `childRunIds`
- `startedAt`
- `finishedAt`
- `diffSummary?`
- `worktreePath?`
- `error?`

## Plan vs Execute

Plan mode:
- runs `pi` with read-only tools
- does not create a worktree
- returns a concrete plan result

Execute mode:
- creates a host-managed isolated git worktree
- syncs the current workspace snapshot into that worktree
- runs `pi` there with full coding tools
- reports changed files, diff summary, worktree path, and test commands

If worktree creation fails, the run fails closed and does not mutate the live workspace.

## Subagent Commands

Main chat command family:
- `/subagents list`
- `/subagents stop current|all|<requestId>`
- `/subagents spawn <task>`

The host tracks active worker runs in `activeCoderRuns` and aborts them through `AbortController`.

## Request IDs

Worker runs use ids such as:
- `coder-<timestamp>-<rand>`
- `subagent-<timestamp>-<rand>`

These ids are shown in status/list output and can be used with `/subagents stop <requestId>`.
