# FFT_nano / NanoClaw Agent Notes

This repo is a single Node.js host process that:
- Receives chat messages (Telegram and/or WhatsApp)
- Stores chat metadata/messages in SQLite
- Runs the agent inside an isolated container via `pi` (pi-coding-agent)
- Sends the agent response back to the originating chat

## Memory Protocol

- Canonical memory file is `MEMORY.md` (per-group at `groups/<group>/MEMORY.md`, global at `groups/global/MEMORY.md`).
- `SOUL.md` is identity/policy context and should stay stable (not used as compaction log storage).


Optional env for farm profile flows (`FFT_PROFILE=farm`):
- `FARM_MODE=demo|production`
- `FARM_PROFILE_PATH` (defaults to `data/farm-profile.json`)
- `FARM_STATE_ENABLED=true`
- `HA_URL`, `HA_TOKEN`
- `FFT_DASHBOARD_REPO_PATH`
- `FFT_DASHBOARD_REPO_URL` (companion source)
- `FFT_DASHBOARD_REPO_REF` (companion branch/SHA pin)

## Telegram As Main UI

Telegram is enabled when `TELEGRAM_BOT_TOKEN` is set.

Recommended local/dev setup (Telegram only):

```bash
export WHATSAPP_ENABLED=0
export TELEGRAM_BOT_TOKEN="..."
./scripts/start.sh telegram-only
```

Main channel behavior:
- `main` responds to all messages.
- Non-main chats only respond if the message starts with the trigger word (default `@FarmFriend`).
  - The trigger word is `@<ASSISTANT_NAME>` where `ASSISTANT_NAME` defaults to `FarmFriend` (see `src/config.ts`).

Ways to make your Telegram DM the `main` channel:
- Set `TELEGRAM_MAIN_CHAT_ID` (numeric chat id) and restart.
- Or set `TELEGRAM_ADMIN_SECRET` on the host and run `/main <secret>` in the bot DM.
  - `/id` replies with the current chat id.
- Main/admin service controls from chat: `/gateway status` and `/gateway restart`.


## Z.AI (GLM) Provider For Pi Runtime

The agent runs in a container. LLM credentials must be provided to the container via the allowlisted env passthrough.

Use `.env` at repo root for the container runtime:

```dotenv
PI_API=zai
PI_MODEL=glm-4.7
ZAI_API_KEY=...
```

Notes:
- Avoid committing secrets. `.env` is gitignored.
- `pi` session/auth/model state is stored per group under `data/pi/<group>/.pi/` on the host and mounted to `/home/node/.pi` in the container.

## Coding Agent (/coder)

- In the main/admin chat you can use: `@FarmFriend /coder <task>`.
- `/coding <task>` is an alias for `/coder <task>`.
- `/coder-plan <task>` and `/coder_plan <task>` run the coding worker in read-only planning mode.
- Main/admin substantial natural-language coding requests can auto-route to the real coding worker.
- Execute-mode coder runs use a host-managed isolated worktree by default; they report the worktree path, changed files, and test commands in the final result.
- `/subagents` manages real worker runs owned by the host orchestrator.
- When spawning subagents, prefer `gpt-5.4-mini` whenever possible; only use a larger model when the task clearly requires it.

## Main Workspace + Heartbeat

- Main/admin container working directory maps to `~/nano` by default.
- Override workspace path with `FFT_NANO_MAIN_WORKSPACE_DIR=/absolute/path`.
- Main workspace bootstrap/context files are auto-seeded if missing:
  - `AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`, `PRINCIPLES.md`, `TOOLS.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, `MEMORY.md` + `memory/`
- Heartbeat is enabled by default and reads `HEARTBEAT.md` periodically.
- Configure heartbeat cadence with `FFT_NANO_HEARTBEAT_EVERY` (default `30m`).
- Optional heartbeat tuning: `FFT_NANO_HEARTBEAT_ACK_MAX_CHARS`, `FFT_NANO_HEARTBEAT_ACTIVE_HOURS`.

## Pi-Native Project Skills

- Two skill types:
  - Setup-only skills: `skills/setup/`
  - Runtime agent skills: `skills/runtime/`
- Main workspace user-created runtime skills live at `~/nano/skills/`.
- On each run, runtime skills are mirrored into per-group Pi home:
  - host: `data/pi/<group>/.pi/skills/`
  - container: `/home/node/.pi/skills/`
- Main/admin runs merge project runtime skills + `~/nano/skills/` (main workspace overrides on name collision).
- Non-main groups only get project runtime skills by default.
- Validate skill metadata/frontmatter with:
  - `npm run validate:skills`

## Debugging / Tracing

Useful env vars on the host:
- `LOG_LEVEL=debug` to log container args/mounts and write verbose container logs.
- `FFT_NANO_DRY_RUN=1` to bypass LLM calls and smoke-test end-to-end routing.

Container logs:
- Per-group logs at `groups/<group-folder>/logs/`.

## Runtime / Service Model

This repo has two different ways to run the host, and they are not interchangeable:

- `./scripts/start.sh start` or `npm run start`
  - Runs the built host in the foreground from `dist/index.js`.
  - Best for manual local runs when you are intentionally not using the installed service manager.
- `./scripts/start.sh dev` or `npm run dev`
  - Runs `src/index.ts` via `tsx`.
  - Debug-only path; use this when actively developing and you want source-level changes without rebuilding.
- `./scripts/service.sh ...`
  - Manages the long-running OS service.
  - On macOS this is a user LaunchAgent with label `com.fft_nano`.
  - On Linux this is a systemd unit named `fft-nano` by default.

Important operational rule:
- If the machine is already running the launchd/systemd service, do not also start a second foreground host with `start.sh` or `npm run start`.
- The host acquires a singleton lock at `data/fft_nano.lock`.
- A second instance can fail on the lock, or still cause upstream channel conflicts such as Telegram polling collisions.

What actually runs on macOS:
- The installed LaunchAgent label is `com.fft_nano`.
- The service keeps the main host alive and restarts it if it exits.
- The web UI and TUI gateway are served by that same host process.
  - TUI websocket default: `127.0.0.1:28989`
  - Web UI default: `127.0.0.1:28990`

Rebuild + restart after code changes:

```bash
npm run build
./scripts/service.sh restart
```

Equivalent direct macOS restart:

```bash
launchctl kickstart -k gui/$(id -u)/com.fft_nano
```

Recommended verification after restart:

```bash
launchctl list | grep com.fft_nano
cat data/fft_nano.lock
lsof -nP -iTCP:28989 -sTCP:LISTEN
lsof -nP -iTCP:28990 -sTCP:LISTEN
```

When to use each path:
- Normal installed runtime on macOS: `./scripts/service.sh restart`
- One-off foreground production-style run: `./scripts/start.sh start`
- Source-level debugging run: `./scripts/start.sh dev`

If you want to run a foreground debug/dev instance on a machine that already has the service installed:
- Stop the service first with `./scripts/service.sh stop`
- Then run your manual `start.sh` or `dev` command
- Restart the service when finished

Why this matters:
- The launchd service may be running with environment and channel settings that differ from your current shell.
- Restarting the service is the correct way to pick up a rebuilt `dist/` while preserving the installed runtime model.
- Running `npm run start` from a shell does not replace the existing service; it creates a second process attempt.

Common failure modes:
- Missing provider key: `pi` reports "No models available" (no API key passed through).
- Wrong `PI_API`/`PI_MODEL`: `pi` reports "Model '<provider>'/'<model>' not found".
- Multiple instances: Telegram polling can error with "Conflict: terminated by other getUpdates request". FFT_nano now uses a lock file (`data/fft_nano.lock`) to prevent two instances from running at once.
- Docker daemon unavailable: run `docker info` and start Docker Desktop/daemon if needed.

---
## Development Workflow

### Git Strategy: Main = Release

The `main` branch is **clean and release-ready at all times**. Personal development happens in worktrees, never directly on main.

**Key rules:**
- Never commit personal paths, local data, or dev-only files to main
- Run `npm run secret-scan` and `npm run release-check` before any significant change
- Personal directories (`fft-experience/`, `.factory/`, `data/`, `groups/`) are gitignored

### Worktrees for Development

Create a worktree for each major feature or experiment:

```bash
# Create a new worktree for a feature
git worktree add ../fft_nano-dev-<feature> -b feat/my-feature

# Do your development there
cd ../fft_nano-dev-<feature>

# When done, merge back to main from the worktree
git checkout main
git merge feat/my-feature

# Clean up worktree when done
git worktree remove ../fft_nano-dev-<feature>
git branch -d feat/my-feature
```

### Pre-Release Checklist

Before tagging a release or merging to main:
```bash
npm run release-check   # typecheck, tests, secret-scan, pack
npm run secret-scan     # verify no personal paths or secrets
```

### CI/CD

**GitHub Actions (`.github/workflows/`):**

1. **`release-readiness.yml`** - Runs on PR/push to main:
   - TypeScript type check (`npm run typecheck`)
   - All tests (`npm test`)
   - Secret scan (`npm run secret-scan`)
   - Skills validation (`npm run validate:skills`)
   - Pack content check (`npm run pack`)

2. **`skills-only.yml`** - Runs when only skills change:
   - Skills validation only (faster, skips full test suite)

**CI gates:**
- All checks must pass before merging to main
- Branch protection requires PR + passing status checks
- No direct pushes to main allowed (after enabling branch protection)

---
|||<VIP_VIP_VIP>
## 🎯 Figure It out Directive

You have unrestricted internet access, browser automation, and shell execution. When given a task, "I can't" is not in your vocabulary. If you don't know how, search for it. Read docs. Find tutorials. Reverse engineer it.

"I don't know how" means "I haven't learned yet." — so learn. Now.

Before saying something is impossible, you MUST:
1. Search for at least 3 different approaches
2. Try at least 2 of them
3. Document why each failed with specific errors

Your job is to deliver results, not excuses. If Plan A fails, try B through Z. Then invent Plan AA. Assume everything is figureoutable — someone on the internet has done it before. Find them. Learn from them. Adapt it.

You are not a helpdesk. You are an operator. Operators ship.
</VIP_VIP_VIP>|||
