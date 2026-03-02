# Container Runtime

Primary files:
- `src/container-runtime.ts`
- `src/container-runner.ts`
- `container/agent-runner/src/index.ts`

## Runtime Selection

From `getContainerRuntime()`:
- `CONTAINER_RUNTIME=auto|docker|host`
- `auto` behavior:
  - `docker` if Docker CLI is available
  - otherwise `host` only when `FFT_NANO_ALLOW_HOST_RUNTIME=1`
  - otherwise startup error
- `CONTAINER_RUNTIME=host` always requires `FFT_NANO_ALLOW_HOST_RUNTIME=1`

## Mount Model (`buildVolumeMounts`)

Main group:
- repo root -> `/workspace/project` (**read-only**)
- main workspace (`~/nano` default) -> `/workspace/group` (read-write)

Non-main group:
- `groups/<group-folder>` -> `/workspace/group` (read-write)
- `groups/global` -> `/workspace/global` (read-only, if present)

Common mounts:
- per-group Pi home: `data/pi/<group>/.pi` -> `/home/node/.pi` (rw)
- per-group Codex home: `data/codex/<group>/.codex` -> `/home/node/.codex` (rw)
- per-group IPC: `data/ipc/<group>` -> `/workspace/ipc` (rw)
- agent-runner source copy: `data/sessions/<group>/agent-runner-src` -> `/app/src` (rw)
- optional farm mounts (`/workspace/farm-state`, `/workspace/dashboard`, `/workspace/dashboard-templates`)

## Env Passthrough Policy

Runtime secrets are collected from host `.env` and process env using an explicit allowlist in `collectRuntimeSecrets(...)`.

Key allowlisted vars include:
- provider/runtime: `PI_API`, `PI_MODEL`, `PI_BASE_URL`, `PI_API_KEY`
- provider keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `ZAI_API_KEY`
- bridge/debug: `HA_URL`, `HA_TOKEN`, `FFT_NANO_DRY_RUN`

Compatibility behavior:
- if `PI_BASE_URL` is set and `OPENAI_BASE_URL` is unset, host injects `OPENAI_BASE_URL=PI_BASE_URL`.

## Additional Mount Security

`containerConfig.additionalMounts` is validated by `validateAdditionalMounts(...)` against:
- external allowlist file: `~/.config/fft_nano/mount-allowlist.json`
- blocked path patterns (`.ssh`, `.env`, key material, credentials)
- containment under allowlisted roots
- non-main read-only enforcement when configured
- target path policy under `/workspace/extra/...`

## Execution Path (`runContainerAgent`)

1. Build snapshots (`tasks`, available groups) for the group.
2. Resolve runtime (`docker` or `host`).
3. Build mounts, runtime secrets, and input payload.
4. Start runtime process (`docker run ...` or host runner entrypoint).
5. Stream/capture stdout+stderr with `CONTAINER_MAX_OUTPUT_SIZE` cap.
6. Apply timeout with guard rails:
   - baseline `CONTAINER_TIMEOUT` (default 6h)
   - per-group timeout only increases baseline (stale low values are ignored)
   - idle guard floor `IDLE_TIMEOUT + 30000`
7. Parse structured output and return result/usage/streaming flags.
8. Persist per-run logs under `groups/<group>/logs/runtime-*.log`.

Abort behavior:
- user/system abort sends `SIGTERM`
- escalates to `SIGKILL` when needed

## Host Runtime Note

`host` runtime means no Docker isolation. It does not imply Linux root user by itself; service account is controlled by system service config.
