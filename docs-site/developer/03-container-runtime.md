# Container Runtime

Primary files:
- `src/container-runtime.ts`
- `src/container-runner.ts`
- `src/apple-container.ts`
- `container/Dockerfile`
- `container/agent-runner/src/index.ts`

## Runtime Selection

From `getContainerRuntime()`:
- `CONTAINER_RUNTIME=apple|docker|auto`
- `auto` behavior:
  - macOS + `container` command present -> `apple`
  - else `docker` if present
  - else fallback to `container` if present
  - else throw hard startup error

## Mount Model

Mount construction in `buildVolumeMounts(group, isMain)`:

Main group:
- host project root -> `/workspace/project` (rw)
- main workspace (`~/nano` by default) -> `/workspace/group` (rw)

Non-main group:
- `groups/<group-folder>` -> `/workspace/group` (rw)
- `groups/global` -> `/workspace/global` (ro when exists)

Common mounts:
- per-group pi home `data/pi/<group>/.pi` -> `/home/node/.pi`
- per-group IPC dir `data/ipc/<group>` -> `/workspace/ipc`
- optional farm-state, dashboard dirs
- env passthrough dir -> `/workspace/env-dir` (ro)

## Env Passthrough Policy

Only allowlisted vars are exported into `/workspace/env-dir/env`.
Examples:
- provider/runtime: `PI_API`, `PI_MODEL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, ...
- farm bridge: `HA_URL`, `HA_TOKEN`
- debug: `FFT_NANO_DRY_RUN`

Additional compatibility behavior:
- if `PI_BASE_URL` is set and `OPENAI_BASE_URL` missing, host writes `OPENAI_BASE_URL=PI_BASE_URL`.

## Additional Mount Security

If group has `containerConfig.additionalMounts`, mounts are validated through `validateAdditionalMounts`:
- allowlist file outside project: `~/.config/fft_nano/mount-allowlist.json`
- blocked-pattern checks (`.ssh`, `.env`, tokens, credentials, etc.)
- root-prefix checks against allowlisted roots
- non-main read-only enforcement when configured
- target path constrained to `/workspace/extra/<relative-path>`

## Container Execution

`runContainerAgent(...)`:
1. Optionally builds retrieval-gated memory context.
2. Spawns runtime command (`container` or `docker`) with generated args.
3. Sends JSON input to stdin.
4. Enforces timeout (`CONTAINER_TIMEOUT` or group override).
5. Captures stdout/stderr with size limits (`CONTAINER_MAX_OUTPUT_SIZE`).
6. Parses JSON output between markers:
   - `---FFT_NANO_OUTPUT_START---`
   - `---FFT_NANO_OUTPUT_END---`
7. Writes per-run logs under `groups/<group>/logs/container-*.log`.

Abort behavior:
- `SIGTERM`, escalate to `SIGKILL` after 750ms if process still alive.

## Apple Container Self-Heal

If runtime is Apple Container and output error looks like network timeout, host may:
1. `container system stop`
2. `container system start`
3. Retry one container run

Guardrails:
- single-flight restart lock
- 60s cooldown between restarts

## In-Container Runtime

Container entrypoint:
- sources `/workspace/env-dir/env` if present
- runs `/app/dist/index.js` (compiled agent-runner)

Agent-runner responsibilities:
- normalize input options
- assemble system prompt and workspace context
- invoke `pi` with JSON mode
- return structured output markers to host
