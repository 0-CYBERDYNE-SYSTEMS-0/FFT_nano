# Container Runtime

Primary files:
- `src/container-runtime.ts`
- `src/pi-runner.ts`
- `src/coding-orchestrator.ts`

## Runtime Selection

`getContainerRuntime()` resolves:
- `CONTAINER_RUNTIME=auto|docker|host`
- `docker` when explicitly requested
- `host` only when `FFT_NANO_ALLOW_HOST_RUNTIME=1`
- `auto` prefers Docker when available, otherwise host only with explicit opt-in

This module only decides runtime mode. It does not launch the coding worker itself.

## Actual Execution Path

The execution split is:
- `src/container-runtime.ts`: choose `docker` vs `host`
- `src/pi-runner.ts`: launch `pi`, build system prompt, stream events, parse output
- `src/coding-orchestrator.ts`: create real coding worker runs, isolated worktrees, and structured worker results

## Workspace Model

`runContainerAgent(...)` in `src/pi-runner.ts` runs `pi` in:
- main workspace for main-chat direct runs
- group folder for non-main direct runs
- `workspaceDirOverride` when the host coding orchestrator assigns an isolated worktree

That means execute-mode coder runs are isolated from the live workspace by default.

## Input / Tool Controls

`ContainerInput` supports:
- provider/model overrides
- think/reasoning/verbose modes
- `codingHint`
- `toolMode=default|read_only|full`
- `workspaceDirOverride`
- `noContinue`

`toolMode` is what the host uses to enforce plan-only vs execute worker behavior:
- `read_only` -> inspection tools only
- `full` -> coding tools enabled

## Secrets / Env Passthrough

Runtime secrets are collected from host `.env` and process env through an allowlist in `collectRuntimeSecrets(...)`.

Important vars include:
- `PI_API`, `PI_MODEL`, `PI_BASE_URL`, `PI_API_KEY`
- provider keys such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ZAI_API_KEY`, `KIMI_API_KEY`
- `HA_URL`, `HA_TOKEN`
- `FFT_NANO_DRY_RUN`

## Execute Worker Isolation

Execute-mode coder runs:
1. Create an isolated git worktree on the host.
2. Sync the current workspace snapshot into it.
3. Run `pi` in that isolated workspace.
4. Return changed files, diff summary, worktree path, commands, and tests.

If worktree creation fails, the run fails closed and does not fall back to mutating the live workspace.

## Host Runtime Note

`host` runtime means FFT_nano runs `pi` directly on the host without Docker isolation. It is explicitly opt-in and is less isolated than Docker mode.
