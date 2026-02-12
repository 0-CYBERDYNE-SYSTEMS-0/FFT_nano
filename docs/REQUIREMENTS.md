# FFT_nano Requirements

Original requirements and design decisions from the project creator.

---

## Why This Exists

FFT_nano is a focused, security-first AI assistant built for farm workflows. It keeps things small and understandable: one Node.js process, minimal complexity, and real isolation through containers.

The goal is a personal farm assistant that's:
- Simple enough to reason about
- Secure by design (not by exception)
- Built for real agricultural work

---

## Philosophy

### Small Enough to Understand

The entire codebase should be something you can read and understand. One Node.js process. A handful of source files. No microservices, no message queues, no abstraction layers.

### Security Through True Isolation

Instead of application-level permission systems trying to prevent agents from accessing things, agents run in actual Linux containers (Apple Container on macOS, Docker on Linux). The isolation is at the OS level. Agents can only see what's explicitly mounted. Bash access is safe because commands run inside the container, not on your host.

### Built for One User

This isn't a framework or a platform. It's working software for focused operational needs. FFT_nano currently supports Telegram and WhatsApp. Keep integrations intentional and avoid unnecessary platform sprawl.

### Customization = Code Changes

No configuration sprawl. If you want different behavior, modify the code. The codebase is small enough that this is safe and practical. Very minimal things like the trigger word are in config. Everything else - just change the code to do what you want.

### AI-Native Development

No installation wizard. No monitoring dashboard. Ask FarmFriend what's happening. Debug by asking it to read the logs/state and propose fixes.

The codebase assumes you have an AI collaborator. It doesn't need to be excessively self-documenting or self-debugging because your agent can read the repo and logs.

### Product-Focused Contributions

FFT_nano is not trying to be a general-purpose platform. Prefer changes that directly improve farm workflows while keeping the code small and the security boundaries clear.

---

## Vision

A personal farm assistant accessible via chat, with minimal custom code.

**Core components:**
- **Pi agent runtime** as the core agent
- **Apple Container or Docker** for isolated agent execution
- **Telegram and WhatsApp** as chat I/O channels
- **Persistent memory** per conversation and globally
- **Scheduled tasks** that run FarmFriend and can message back
- **Web access** via bash/curl or browser automation
- **Browser automation** via agent-browser

**Implementation approach:**
- Use existing tools (WhatsApp connector, Pi runtime, filesystem IPC)
- Minimal glue code
- File-based systems where possible (SOUL.md for memory, folders for groups)

---

## Architecture Decisions

### Message Routing
- A router listens to Telegram and/or WhatsApp and routes messages based on configuration
- Only messages from registered groups are processed
- Trigger: `@FarmFriend` prefix (case insensitive), configurable via `ASSISTANT_NAME` env var
- Unregistered groups are ignored completely

### Memory System
- **Per-group memory**: Each group has a folder with its own `SOUL.md`
- **Global memory**: `groups/global/SOUL.md` is read by all groups, but only writable from "main" (self-chat)
- **Files**: Groups can create/read files in their folder and reference them
- Agent runs in the group's folder, automatically inherits both SOUL.md files

### Session Management
- Each group maintains a conversation session (persisted by Pi under per-group `~/.pi`)
- Sessions auto-compact when context gets too long, preserving critical information

### Container Isolation
- Agents run inside Apple Container on macOS or Docker on Linux
- Each agent invocation spawns a container with mounted directories
- Containers provide filesystem isolation - agents can only see mounted paths
- Bash access is safe because commands run inside the container, not on the host
- Browser automation via agent-browser with Chromium in the container

### Scheduled Tasks
- Users can ask FarmFriend to schedule recurring or one-time tasks from any group
- Tasks run as full agents in the context of the group that created them
- Tasks have access to all tools including Bash (safe in container)
- Tasks can optionally send messages to their group via IPC, or complete silently
- Task runs are logged to the database with duration and result
- Schedule types: cron expressions, intervals (ms), or one-time (ISO timestamp)
- From main: can schedule tasks for any group, view/manage all tasks
- From other groups: can only manage that group's tasks

### Group Management
- New groups are added explicitly via the main channel
- Groups are registered by editing `data/registered_groups.json`
- Each group gets a dedicated folder under `groups/`
- Groups can have additional directories mounted via `containerConfig`

### Main Channel Privileges
- Main channel is the admin/control group (typically self-chat)
- Can write to global memory (`groups/global/SOUL.md`)
- Can schedule tasks for any group
- Can view and manage tasks from all groups
- Can configure additional directory mounts for any group

---

## Integration Points

### WhatsApp
- Using baileys library for WhatsApp Web connection
- Messages stored in SQLite, polled by router
- QR code authentication during setup

### Telegram
- Bot API polling + command handling (`/help`, `/status`, `/id`, admin commands in main only)
- Main/admin chat can be claimed with `/main <secret>` when `TELEGRAM_ADMIN_SECRET` is set
- Media uploads are persisted to group inbox paths for agent access

### Scheduler
- Built-in scheduler runs on the host, spawns containers for task execution
- File-based IPC (`/workspace/ipc`) provides messaging + scheduling
- Tools: `schedule_task`, `list_tasks`, `pause_task`, `resume_task`, `cancel_task`, `send_message`
- Tasks stored in SQLite with run history
- Scheduler loop checks for due tasks every minute
- Tasks execute the Pi runtime in containerized group context

### Web Access
- Use command-line tools (e.g. curl) and optional browser automation

### Browser Automation
- agent-browser CLI with Chromium in container
- Snapshot-based interaction with element references (@e1, @e2, etc.)
- Screenshots, PDFs, video recording
- Authentication state persistence

---

## Setup & Customization

### Philosophy
- Minimal configuration files
- Setup and customization done by editing the repo (or having your coding agent do it)
- Users clone the repo and configure credentials + runtime
- Each user gets a custom setup matching their exact needs

### Common Tasks
- One-time setup: `./scripts/setup.sh`
- WhatsApp auth: `npm run auth`
- Run (dev): `./scripts/start.sh dev`
- Run (dev, Telegram-only): `./scripts/start.sh dev telegram-only`
- Build: `npm run build`

### Deployment
- Runs on local Mac via launchd
- Single Node.js process handles everything

---

## Personal Configuration (Reference)

These are the creator's settings, stored here for reference:

- **Trigger**: `@FarmFriend` (case insensitive)
- **Response prefix**: `FarmFriend:`
- **Persona**: FarmFriend
- **Main channel**: Admin chat (WhatsApp self-chat or Telegram DM)

---

## Project Name

**FFT_nano** - FarmFriendTerminal_nano (a fork/evolution of NanoClaw).
