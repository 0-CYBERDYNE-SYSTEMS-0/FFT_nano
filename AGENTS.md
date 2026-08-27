# FFT_nano / NanoClaw Agent Notes

This repo is FFT_nano: an autonomous AI coworker host. One Node.js process
receives Telegram/WhatsApp messages, stores state in SQLite, runs the `pi`
coding-agent subprocess (Docker when healthy, else host runtime), and streams
answers back to the chat. The same process also serves a terminal UI
(WebSocket `127.0.0.1:28989`), a Web Control Center (`127.0.0.1:28990`), and an
ACP v1 stdio surface (`dist/acp-stdio.js`).

TypeScript, ESM everywhere (`"type": "module"`). Node >= 20.

## Build, Test, Validate

```bash
npm run build            # tsc -> dist/ AND web UI -> dist-web/ (service runs dist/)
npm run typecheck        # tsc --noEmit
npm test                 # all tests: node --import tsx --test
node --import tsx --test tests/foo.test.ts   # run ONE test file
npm run format           # prettier write (src/**/*.ts); format:check for CI
npm run validate:skills  # skill frontmatter/structure (repo + personal layers)
npm run doctor           # runtime health diagnostics
```

Release gates (required before tag/promotion):

```bash
npm run release-check    # validate:skills, typecheck, tests, secret-scan, pack-check
npm run secret-scan      # no personal paths, chat ids, secrets
git diff --check         # no merge markers
git status --short       # clean candidate
```

CI (`.github/workflows/`): `release-readiness.yml` on PR/push to main;
`skills-only.yml` validates skills alone.

## Architecture

```
Telegram/WhatsApp
  -> src/pipeline/message-dispatch-pipeline.ts  (processMessage, runDirectSessionTurn)
       -> src/pi-runner.ts                      spawn pi subprocess (sandbox: docker/bwrap/host)
            |  emits HostEvent on src/runtime/host-events.ts (HostEventBus)
            v
       telegram-streaming.ts / file-delivery.ts / TUI / Web Control Center
  Cross-boundary IPC: the pi subprocess writes JSON envelopes into
  data/ipc/<group>/{messages,tasks,actions,action_results,deliver_files};
  the host polls them (IPC watcher in src/host-coordination.ts).
```

Key facts:

- `src/index.ts` is a 3-line shim; real composition lives in `src/wiring.ts`
  (channels, routing, admin command policy, service construction). Extracted
  modules take a `*Deps` object (`buildXDeps()` in `wiring.ts`).
- Global mutable state sits on `src/app-state.ts`: `state`,
  `activeChatRuns`, and the `hostEventBus` singleton. Reassignable vars live on
  the `state` object for ESM compatibility.
- **Evaluator loop**: after a run, `evaluator.ts` launches a second pi pass to
  score output quality. Verdict JSON must never reach users; guard:
  `runtime/boundary-ipc.ts` (`isInternalEvaluatorVerdictText`).
- **Cron service** (`src/cron/service.ts` + `task-scheduler.ts`): scheduled
  tasks via SQLite; scheduler mode `v2` default.
- **Coding orchestrator** (`coding-orchestrator.ts`): plan/execute worker
  routing, ephemeral worktrees, verdict feed-forward.
- Persistence: `src/db.ts` owns schema + queries; idempotent `ALTER TABLE`
  migrations run at startup. Live DB: `<runtime checkout>/store/messages.db`.

State access pattern:

```typescript
import { state, activeChatRuns, hostEventBus } from './app-state.js';
```

## Frozen kernel surface

`src/kernel-surface.ts` and `docs/KERNEL_SURFACE.md` define the frozen ABI:

| Surface | Values |
|---|---|
| Prompt layers | `stable`, `session_bootstrap`, `ephemeral` |
| Prompt modes | `full`, `minimal`, `maintenance` |
| Run origins | `interactive-main`, `subagent`, `headless`, `evaluator`, `maintenance` |
| IPC envelope kinds | `message`, `task`, `action`, `action_result` (+ dir `deliver_files`) |
| IPC payload types | `run_progress`, `pause_task`, `resume_task`, `cancel_task`, `refresh_groups`, `register_group`, `memory_action`, `skill_action`, `subagent_action`, `farm_action`, `schedule_task` |
| Workspace contract files | `NANO.md`, `SOUL.md`, `TODOS.md`, `HEARTBEAT.md`, `BOOT.md`, `BOOTSTRAP.md`, `MEMORY.md` |

Growth rule: new agent capability belongs in **skills** (`skills/runtime/`)
or **scheduled tasks**, not in new prompt layers, run origins, IPC kinds, or
contract filenames. Layer roles: `stable` = identity/safety + `SOUL.md` only
(cacheable prefix); `session_bootstrap` = `NANO.md`, `MEMORY.md`, skill
catalog (fresh sessions); `ephemeral` = inbound metadata, `TODOS.md`,
`HEARTBEAT.md`, retrieved memory (every turn).

## Skills system

Layers merged each run into the agent home
(`data/pi/<group>/.pi/skills/`, mounted at `/home/node/.pi/skills`):

- `skills/runtime/`: repo-tracked agent skills (source of record).
- `skills/setup/`: NOT agent skills. Human operator guides only.
- `~/nano/skills/`: personal, untracked. Wins name collisions on main-chat
  runs. Non-main group runs receive repo skills only.

Sync prunes only skills recorded in `.fft_nano_managed_skills.json`; manually
installed skills survive. Mutations snapshot `SKILL.md` to `.history/`
(`src/skill-history.ts`); the `skill_rollback` IPC action restores prior
versions. Validate with `npm run validate:skills`.

## Memory protocol

- Canonical memory: per-group `groups/<group>/MEMORY.md` (+ `memory/`),
  global `groups/global/MEMORY.md`.
- `SOUL.md` is identity/policy context. Never use it as a compaction log.
- Lexical search across transcripts + documents via the
  `memory-backend.ts` facade; `memory-paths.ts` owns layout. Opt-in semantic
  re-rank: `MEMORY_SEMANTIC_ENABLED=1` plus local Ollama (`nomic-embed-text`
  default). Absent/disabled means pure lexical fallback.
- Retrieved-memory context is built for main chat, cron (`isScheduledTask`),
  and subagent (`isSubagent`) runs alike (`shouldBuildRetrievedMemoryContext`
  in `pi-runner.ts`).

Optional env for farm profile flows (`FFT_PROFILE=farm`):
- `FARM_MODE=demo|production`
- `FARM_PROFILE_PATH` (defaults to `data/farm-profile.json`)
- `FARM_STATE_ENABLED=true`
- `HA_URL`, `HA_TOKEN`
- `FFT_DASHBOARD_REPO_PATH`

## Channels and access control

- Main chat answers everything. Other chats need the trigger prefix
  `@<ASSISTANT_NAME>` (default: `FarmFriend` under `FFT_PROFILE=farm`, else
  `fft_nano`; override with `ASSISTANT_NAME`).
- Claim main: `/id`, then `/main <secret>` using `TELEGRAM_ADMIN_SECRET`, or
  set `TELEGRAM_MAIN_CHAT_ID` and restart. `/gateway status|restart` is
  main-admin only.
- Coder delegation: `/coder <task>` executes; `/coder-plan <task>` plans only
  (aliases `/coding`, "use coding agent"). Main/admin chat only. Natural-
  language coding requests stay with the main assistant unless the operator
  approves escalation; approval controls offer Plan / Execute / Cancel.
  Execute-mode runs use a host-managed isolated worktree and report the
  worktree path, changed files, and test commands.
- When spawning subagents, prefer small/cheap models whenever possible; use a
  larger model only when the task clearly needs it.
- Per-chat delivery modes (`/delivery`): `stream`, `append`, `off`, `draft`;
  see `docs/TELEGRAM_DELIVERY.md`. Interactive streaming is intentionally NOT
  routed through the delivery outbox.

## Durability and self-improvement subsystems

All additive; every piece degrades safely when disabled.

- **Long-run durability** (`long-run-service.ts`, `agent_runs` table): runs
  record their durable workspace as `worktree_path`. On boot,
  `triageActiveAgentRunsOnStartup` marks in-flight runs interrupted or
  recoverable; `resumeRecoverableRuns()` re-enqueues them, capped by
  `FFT_NANO_LONG_RUN_MAX_RESUMES` (default 2).
- **Delivery outbox** (`outbox.ts`, `delivery_outbox`): at-least-once finals
  with UNIQUE `dedupe_key` so re-emitted finals never double-post. Cron keys
  look like `cron:{id}:{run}`. `flushPending()` runs at startup and each cron
  tick. Interactive chat bypasses it (no stable dedupe key).
- **Evaluator feed-forward**: verdicts persist to `evaluator_verdicts`;
  `getEvaluatorStats(group)` injects rolling pass-rate + recurring issues
  into later coding/subagent runs. Group-scoped.
- **Skill self-improvement signals** (`self-improve-signals.ts` ->
  `skill-service.ts`): deterministic lexical signals (`remember`,
  `correction`, `fail-then-fix` fire the quiet reviewer immediately with
  `full` priority; `multi-step-procedure` is `light`). Debounced per group by
  `selfImprove.minIntervalMinutes` (15; env
  `FFT_NANO_SKILL_SELF_IMPROVE_MIN_INTERVAL_MINUTES`). Every pass appends one
  JSONL line to `groups/<group>/logs/self-improve-events.jsonl`.
- **Idle skill curator**: `state.lastInboundAt` stamps user-origin inbound
  messages; curation waits for `minIdleHours` idle; an hourly unref'd loop
  drives `maybeRunSkillManager`.
- **Drift witness** (`drift-witness-service.ts`): warns when the runtime
  checkout lags canonical `main` by more than `FFT_NANO_DRIFT_THRESHOLD`
  commits (default 4) for more than 2 days. `0` disables. Set
  `FFT_NANO_CANONICAL_BRANCH` for forks.

## Runtime and service model

Three ways to run; they are not interchangeable:

- `./scripts/start.sh start` / `npm start`: foreground production-style run.
- `./scripts/start.sh dev` / `npm run dev`: tsx source-level debugging.
- `./scripts/service.sh <install|uninstall|start|stop|restart|status|logs>`:
  the OS service. macOS: LaunchAgent `com.fft_nano`. Linux: systemd
  `fft-nano`. Android/Termux: termux-services `fft-nano` (first-class daemon
  target; enable autostart once with `sv-enable fft-nano`).

Operating rules:

- Never run a second foreground host next to the installed service. A
  singleton lock (`data/fft_nano.lock`) blocks double hosts; violations show
  up as Telegram polling conflicts.
- The service runs `dist/`. After every pull or code change:
  `npm run build`, then restart (`launchctl kickstart -k
  gui/$(id -u)/com.fft_nano` on macOS). Verify a new PID and a clean
  `logs/fft_nano.log`; check listeners with
  `lsof -nP -iTCP:28989 -sTCP:LISTEN` and port `28990`.
- The web UI serves gitignored `dist-web/control-center/`; `git pull` alone
  never updates it. Rebuild + restart required.
- Debugging env: `LOG_LEVEL=debug` (container args/mounts, verbose container
  logs), `FFT_NANO_DRY_RUN=1` (routing smoke test, no LLM calls). Group logs:
  `groups/<group>/logs/`. Docker disk failures: `./scripts/docker-recover.sh`.
- Provider config flows through `.env` into the container passthrough
  allowlist: `PI_API`, `PI_MODEL`, provider keys. Wrong combos produce
  "No models available" / "Model not found".
- Feature flags beyond env vars live in `config/runtime.parity.json`.

## Workspace bootstrap and heartbeat

- Main workspace maps to `~/nano` by default (`FFT_NANO_MAIN_WORKSPACE_DIR`
  overrides). The host auto-seeds missing contract files from the kernel
  list above; optional startup ritual `BOOT.md` is seeded when enabled
  (`FFT_NANO_WORKSPACE_ENABLE_BOOT_MD=1`).
- Fresh installs get a host-enforced bootstrap interview while
  `BOOTSTRAP.md` is pending: normal tasks redirect into the interview and
  `/coder` is blocked. Completion token: `ONBOARDING_COMPLETE`. Gates:
  `FFT_NANO_WORKSPACE_ENFORCE_BOOTSTRAP_GATE[_EXISTING]`.
- Heartbeat runs a main-session check against `HEARTBEAT.md`, default every
  4h (`FFT_NANO_HEARTBEAT_EVERY`). Effectively empty checklist files are
  skipped. OK-only heartbeats post "heartbeat okay" unless
  `FFT_NANO_HEARTBEAT_SHOW_OK=0`. Ack length gate:
  `FFT_NANO_HEARTBEAT_ACK_MAX_CHARS` (300). Optional activity window:
  `FFT_NANO_HEARTBEAT_ACTIVE_HOURS` (`HH:MM-HH:MM` or
  `Mon-Fri@HH:MM-HH:MM`).

## Development workflow (two worktrees, one git)

The dev and runtime worktrees share one `.git`; a branch can be checked out
in only one at a time.

- `origin/main` is the canonical deployment line. All promotion goes through
  PRs. Direct fast-forward pushes to your own feature branch are allowed.
  Force-push to `main` is forbidden (cherry-pick or revert instead).
  `origin/dev` is retired.
- `~/fft_nano-dev` (this checkout): edit/build/test on FEATURE branches. Do
  not commit here on `main`.
- `~/fft_nano`: runtime checkout pinned to `main`. Never hand-edit. Builds
  and restarts the installed service.

Ship loop:

1. Feature branch in `~/fft_nano-dev`, push, open PR to `main`, merge.
2. In `~/fft_nano`: `git pull --ff-only origin main`.
3. `npm run build` (mandatory; the service runs `dist/`).
4. Restart the service; verify new PID + clean log.

Hygiene:

- The runtime checkout must stay clean. Shelve strays with
  `git stash push -u`. Isolate test artifacts in the dev checkout. Never
  commit lock files or `reports/` (already gitignored).
- Keep `groups/main/` empty in-repo; treat any in-repo workspace usage as
  local-only and never commit personal memory/state.
- Hooks in `hooks/` (pre-commit, pre-push): do not bypass with `--no-verify`.
- Keep one reusable general-purpose dev worktree at most. Reuse it only for
  work on the same branch; otherwise finish, checkpoint, or remove it. Never
  delete a worktree holding unreviewed changes.
- Feature worktrees may run temporary validation, but stop the installed
  service first to avoid channel conflicts; restore root-`main` runtime after.
- Fresh-install releases must be proven on the scripted install path
  (`README.md`, `docs/ONBOARDING.md`, `scripts/setup.sh`,
  `scripts/onboard-all.sh`, `.env.example`, `scripts/service.sh`), not just as
  an upgrade of an existing machine.

## Scoped-pass pattern

Big changes follow `MISSION_CONTRACT.md` conventions and hand off via
`HANDOFF.md` (keep it current after major milestones). Acceptance per pass:
typecheck clean, `npm test` green, behavior covered by a unit test that fails
before the change, no new user-visible surface.

## Key files

| File | Role |
|---|---|
| `src/kernel-surface.ts` | Frozen kernel ABI (see `docs/KERNEL_SURFACE.md`) |
| `src/index.ts` | Thin entrypoint; calls `main()` in `wiring.ts` |
| `src/wiring.ts` | Host composition: channels, routing, admin command policy |
| `src/app-state.ts` | Global mutable state + `hostEventBus` singleton |
| `src/pipeline/message-dispatch-pipeline.ts` | Canonical dispatch pipeline |
| `src/pi-runner.ts` | Pi subprocess spawning, sandbox wiring, runtime events, memory-context gate |
| `src/agent-runner.ts` | `runAgent()`: workspace resolution, host-context, run lifecycle |
| `src/host-coordination.ts` | Host↔agent coordination, IPC watcher |
| `src/runtime/host-events.ts` / `src/runtime/boundary-ipc.ts` | Typed event hub / envelope parsing + leak guards |
| `src/db.ts` | SQLite schema + queries + idempotent migrations |
| `src/config.ts` -> `src/app-config.ts` | Config constants and env defaults |
| `src/evaluator.ts` / `src/coding-orchestrator.ts` | Quality scoring / plan-execute routing |
| `src/cron/service.ts` + `src/task-scheduler.ts` | Scheduled task engine |
| `src/outbox.ts` / `src/long-run-service.ts` | At-least-once delivery / durable run resume |
| `src/memory-backend.ts`, `memory-search.ts`, `memory-embeddings.ts` | Memory facade / lexical search / semantic re-rank |
| `src/skill-lifecycle.ts` / `src/skill-history.ts` | Skill IPC actions / versioning + rollback |
| `src/permission-gate-policy.ts` / `src/bash-guard.ts` | Tool permission decisions / destructive-command classification |
| `src/tui/` | Terminal UI gateway server/client bridging to the host bus |
| `web/control-center/` | React control center, built into `dist-web/` |

## Conventions

- Relative imports end with `.js`.
- Tests live in `tests/*.test.ts` (node:test through tsx). Run the relevant
  test files after each change; the whole suite before PRs.
- Skill manifests validate with `npm run validate:skills`.
- Official distribution is GitHub Releases; npm publish is deferred.
