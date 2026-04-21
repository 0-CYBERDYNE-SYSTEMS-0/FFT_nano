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
- Main/admin natural-language coding requests stay in the main assistant unless the operator explicitly approves coder escalation.
- When a message looks like coding work, the bot offers approval controls for `Plan`, `Execute`, or `Cancel` instead of silently auto-running coder.
- `/coder-plan` is the recommended first step; `/coder` and `/coding` stay explicit execute commands.
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

Skills give the pi agent specific capabilities it can invoke during its work loop. They are
organized in two layers:

### Skill directory layout

```
fft_nano-dev/
  skills/
    setup/          ← operator-facing guides (one-time setup tasks)
    runtime/        ← repo-tracked agent skills (fft-coder-ops, agent-browser, etc.)

~/nano/
  skills/           ← your personal agent skills (untracked, not in git)
```

### The two layers

**`skills/runtime/`** — repo-tracked, version-controlled, part of the install package.
These are FFT_nano's standard agent skills. Any operator or agent can see and use them.
They are the source of record for distributed deploys.

**`~/nano/skills/`** — your personal skills layer. Lives inside the agent's workspace,
untracked by git. Add skills here when you want the agent to have a capability that
should not be committed to the repo (e.g., proprietary workflows, integrations with
your personal tools, domain-specific skills).

### How skill mirroring works

On each run, FFT_nano merges both layers and syncs them into the agent's home:

```
skills/runtime/  +  ~/nano/skills/
        ↓ merge
data/pi/<group>/.pi/skills/
        ↓ mount
container: /home/node/.pi/skills/
```

- **Main/admin runs:** both layers are merged. Repo skills and personal skills coexist.
  On name collision, `~/nano/skills/` wins (it is sourced last).
- **Non-main group runs:** only repo skills are synced. Personal skills are intentionally
  not available to group members — access is workspace-scoped, not global.
- **Sync safety:** FFT_nano uses a manifest file (`.fft_nano_managed_skills.json`) to
  track which skills it manages. Only repo-tracked skills are managed — personal skills
  in `~/nano/skills/` are never overwritten or removed by sync. You can safely add,
  modify, or delete personal skills without affecting the repo layer.
- **Validation:** `npm run validate:skills` checks frontmatter and structure for both
  layers. Personal skills go through the same validation as repo skills.

### Adding a personal skill

```bash
# Create the skill directory in your personal skills layer
mkdir -p ~/nano/skills/my-custom-skill
# Add a SKILL.md with name + description frontmatter
$EDITOR ~/nano/skills/my-custom-skill/SKILL.md
```

The next time the main agent runs, it will be available. No restart needed.

### Setup skills (skills/setup/)

These are **not** agent skills. They are step-by-step operator guides for one-time
installation and configuration tasks (Gmail setup, Docker conversion, etc.). They are
human-facing documentation, not tools the agent invokes.

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

The root checkout used as the local runtime/release checkout should stay on `main`.
`main` is **clean and release-ready at all times**.
Do not start unrelated feature work directly in the root checkout.

**Key rules:**
- Never commit personal paths, local data, or dev-only files to main
- Do not use the root checkout as a general-purpose dev sandbox
- Run `npm run secret-scan` and `npm run release-check` before promoting a release candidate
- Personal directories (`fft-experience/`, `.factory/`, `data/`, `groups/`) are gitignored
- A public release must come from the exact tested commit that will be tagged

### Two-Checkout Operating Model (Local)

- Keep one local release/runtime checkout on `main`.
- Keep a separate local development checkout for day-to-day feature work.
- Do implementation work in the development checkout, push feature branches to `origin`, and open a PR to `main`.
- Never push directly to `origin/main`; promotion to `main` happens only through reviewed PRs.
- After merge, fast-forward the local release/runtime checkout on `main` before runtime/service validation.

### Authoritative Local Workflow (Release-Parity Runtime)

This is the canonical operator workflow and is intentional:

1. Implement and test in the dev checkout/worktree (for example `fft_nano-dev`).
2. Open PR and merge to `origin/main`.
3. Fast-forward the local runtime/release checkout on `main`.
4. Build/restart service from that local `main` checkout.

Implications:
- Seeing code edits in a dev checkout while the service runs from a separate local `main` checkout is expected.
- Treat checkout-path differences as context, not as a workflow error, unless the runtime checkout is not on `main` or is not fast-forwarded after merge.
- Runtime behavior investigation should always start from the active service checkout and its `.env`/logs, then map findings back to the dev checkout for fixes.

### Worktrees for Development

Use one reusable general-purpose dev worktree for unrelated feature work:

```bash
# Create the reusable dev worktree from main
git worktree add ../fft_nano-dev -b feat/current-work main

# Do feature work there
cd ../fft_nano-dev

# When done, merge or park the branch, then remove the worktree
git checkout main
git merge --ff-only feat/current-work

git worktree remove ../fft_nano-dev
git branch -d feat/current-work
```

Workflow policy:
- Keep the root checkout on `main` as the stable local runtime/release checkout.
- Keep at most one active general-purpose dev worktree for unrelated work.
- If an active non-main worktree already exists, reuse it only if the new task belongs to that branch.
- Otherwise finish it, checkpoint it, or remove it before starting a new unrelated task.

Feature-worktree runtime validation:
- Default runtime/service behavior should come from the root checkout on `main`.
- A feature worktree may be used for temporary runtime validation when intentionally testing that branch.
- Before doing that, stop the existing service or otherwise avoid channel/runtime conflicts.
- After validation, restore the root `main` runtime.

Before removing a worktree:
- Commit the changes, or stash them intentionally, before cleanup.
- Do not delete a worktree with unreviewed work just to start a new task.

### Fresh-Install Reality Check

For public releases, "tests passed" is necessary but not sufficient.

The real fresh-install surface is:
- `README.md`
- `docs/ONBOARDING.md`
- `scripts/setup.sh`
- `scripts/onboard-all.sh`
- `.env.example`
- `scripts/service.sh`

Before tagging a release, verify that a new user could follow the docs and scripts from a clean checkout on a blank machine. Do not rely only on upgrade testing from an already-configured personal install.

### Pre-Release Checklist

Before tagging a release or merging to main:
```bash
npm run release-check   # validate:skills, typecheck, tests, secret-scan, pack-check
npm run secret-scan     # verify no personal paths, chat ids, or secrets
git diff --check        # no merge markers / whitespace breakage
git status --short      # clean release candidate before promotion/tagging
```

Release expectations:
- Run the checks from the clean release candidate worktree/branch, not from a dirty personal checkout.
- Verify the scripted install path, not just upgrades from an existing machine.
- Tag only after those checks pass on the exact commit being released.

### CI/CD

**GitHub Actions (`.github/workflows/`):**

1. **`release-readiness.yml`** - Runs on PR/push to main:
   - TypeScript type check (`npm run typecheck`)
   - All tests (`npm test`)
   - Secret scan (`npm run secret-scan`)
   - Skills validation (`npm run validate:skills`)
   - Full release gate (`npm run release-check`), which includes pack-content policy via `npm run pack-check`

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
