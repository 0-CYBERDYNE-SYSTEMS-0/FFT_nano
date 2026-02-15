# FFT_nano Specification

A secure, containerized assistant accessible via chat (WhatsApp today; Telegram optional in FFT_nano), with persistent memory per conversation and scheduled tasks.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Folder Structure](#folder-structure)
3. [Configuration](#configuration)
4. [Memory System](#memory-system)
5. [Session Management](#session-management)
6. [Message Flow](#message-flow)
7. [Commands](#commands)
8. [Scheduled Tasks](#scheduled-tasks)
9. [MCP Servers](#mcp-servers)
10. [Deployment](#deployment)
11. [Security Considerations](#security-considerations)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        HOST (macOS)                                  │
│                   (Main Node.js Process)                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐                     ┌────────────────────┐        │
│  │  WhatsApp    │────────────────────▶│   SQLite Database  │        │
│  │  (baileys)   │◀────────────────────│   (messages.db)    │        │
│  └──────────────┘   store/send        └─────────┬──────────┘        │
│                                                  │                   │
│         ┌────────────────────────────────────────┘                   │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │  Message Loop    │    │  Scheduler Loop  │    │  IPC Watcher  │  │
│  │  (polls SQLite)  │    │  (checks tasks)  │    │  (file-based) │  │
│  └────────┬─────────┘    └────────┬─────────┘    └───────────────┘  │
│           │                       │                                  │
│           └───────────┬───────────┘                                  │
│                       │ spawns container                             │
│                       ▼                                              │
├─────────────────────────────────────────────────────────────────────┤
│                  CONTAINER RUNTIME (Linux VM / container)            │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    AGENT RUNNER                               │   │
│  │                                                                │   │
│  │  Working directory: /workspace/group (mounted from host)       │   │
│  │  Volume mounts:                                                │   │
│  │    • groups/{name}/ → /workspace/group                         │   │
│  │    • groups/global/ → /workspace/global/ (non-main only)        │   │
│  │    • data/pi/{group}/.pi/ → /home/node/.pi/                   │   │
│  │      (project .pi/skills/fft-* mirrored into /home/node/.pi/skills)│ │
│  │    • Additional dirs → /workspace/extra/*                      │   │
│  │                                                                │   │
│  │  Tools (all groups):                                           │   │
│  │    • Bash (safe - sandboxed in container!)                     │   │
│  │    • Read, Write, Edit, Glob, Grep (file operations)           │   │
│  │    • Web via bash/curl or browser automation                   │   │
│  │    • agent-browser (browser automation)                        │   │
│  │    • pi (pi-coding-agent; LLM runtime + tool calling)           │   │
│  │    • IPC files (/workspace/ipc) for messaging + scheduling      │   │
│  │                                                                │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| WhatsApp Connection | Node.js (@whiskeysockets/baileys) | Connect to WhatsApp, send/receive messages |
| Message Storage | SQLite (better-sqlite3) | Store messages for polling |
| Container Runtime | Apple Container (macOS) or Docker (Linux/RPi) | Isolated agent execution |
| Agent | Pi agent runtime (`pi`, pi-coding-agent) | Run the model with filesystem + bash tools |
| Browser Automation | agent-browser + Chromium | Web interaction and screenshots |
| Runtime | Node.js 20+ | Host process for routing and scheduling |

---

## Folder Structure

```
fft_nano/
├── SOUL.md                      # Project context
├── docs/
│   ├── SPEC.md                    # This specification document
│   ├── REQUIREMENTS.md            # Architecture decisions
│   ├── SECURITY.md                # Security model
│   └── PI_SKILLS.md               # Pi-native skill layout + validation
├── README.md                      # User documentation
├── package.json                   # Node.js dependencies
├── tsconfig.json                  # TypeScript configuration
├── .mcp.json                      # Legacy MCP config (not used)
├── .gitignore
├── .pi/
│   └── skills/                    # Project-local Pi-native skills (fft-*)
│
├── src/
│   ├── index.ts                   # Main application (channels + routing)
│   ├── config.ts                  # Configuration constants
│   ├── types.ts                   # TypeScript interfaces
│   ├── utils.ts                   # Generic utility functions
│   ├── db.ts                      # Database initialization and queries
│   ├── whatsapp-auth.ts           # Standalone WhatsApp authentication
│   ├── task-scheduler.ts          # Runs scheduled tasks when due
│   └── container-runner.ts        # Spawns agents in Apple Container or Docker
│
├── container/
│   ├── Dockerfile                 # Container image (runs as 'node' user)
│   ├── build.sh                   # Build with Apple Container
│   ├── build-docker.sh            # Build with Docker (Linux/RPi)
│   ├── agent-runner/              # Code that runs inside the container
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts           # Entry point (reads JSON, runs pi)
│   └── skills/
│       └── agent-browser.md       # Browser automation skill
│
├── dist/                          # Compiled JavaScript (gitignored)
│
├── groups/
│   ├── global/                    # Global memory scope
│   │   ├── MEMORY.md            # Global memory (all groups read; main can write)
│   │   ├── SOUL.md              # Global identity/policy context
│   ├── main/                      # Self-chat (main control channel)
│   │   ├── MEMORY.md            # Main channel memory
│   │   ├── SOUL.md              # Main channel identity/policy
│   │   └── logs/                  # Task execution logs
│   └── {Group Name}/              # Per-group folders (created on registration)
│       ├── MEMORY.md            # Group-specific memory
│       ├── SOUL.md              # Group-specific identity/policy
│       ├── memory/              # Additional memory notes
│       ├── logs/                  # Task logs for this group
│       └── *.md                   # Files created by the agent
│
├── store/                         # Local data (gitignored)
│   ├── auth/                      # WhatsApp authentication state
│   └── messages.db                # SQLite database (messages, scheduled_tasks, task_run_logs)
│
├── data/                          # Application state (gitignored)
│   ├── registered_groups.json     # Group JID → folder mapping
│   ├── router_state.json          # Last processed timestamp + last agent timestamps
│   ├── env/env                    # Copy of .env for container mounting
│   └── ipc/                       # Container IPC (messages/, tasks/)
│
├── logs/                          # Runtime logs (gitignored)
│   ├── fft_nano.log               # Host stdout
│   └── fft_nano.error.log         # Host stderr
│   # Note: Per-container logs are in groups/{folder}/logs/container-*.log
│
└── launchd/
    └── com.fft_nano.plist         # macOS service configuration
```

---

## Configuration

Configuration constants are in `src/config.ts`:

```typescript
import path from 'path';

export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'FarmFriend';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Paths are absolute (required for container mounts)
const PROJECT_ROOT = process.cwd();
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');

// Container configuration
export const CONTAINER_IMAGE = process.env.CONTAINER_IMAGE || 'fft-nano-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(process.env.CONTAINER_TIMEOUT || '300000', 10);
export const IPC_POLL_INTERVAL = 1000;

export const TRIGGER_PATTERN = new RegExp(`^@${ASSISTANT_NAME}\\b`, 'i');
```

**Note:** Paths must be absolute for Apple Container volume mounts to work correctly.

### Container Configuration

Groups can have additional directories mounted via `containerConfig` in `data/registered_groups.json`:

```json
{
  "1234567890@g.us": {
    "name": "Dev Team",
    "folder": "dev-team",
    "trigger": "@FarmFriend",
    "added_at": "2026-01-31T12:00:00Z",
    "containerConfig": {
      "additionalMounts": [
        {
          "hostPath": "~/projects/webapp",
          "containerPath": "webapp",
          "readonly": false
        }
      ],
      "timeout": 600000
    }
  }
}
```

Additional mounts appear at `/workspace/extra/{containerPath}` inside the container.

**Apple Container mount syntax note:** Read-write mounts use `-v host:container`, but readonly mounts require `--mount "type=bind,source=...,target=...,readonly"` (the `:ro` suffix doesn't work).

### LLM Authentication

Configure authentication in a `.env` file in the project root.

Typical options:

- OpenAI-compatible:
  - `PI_BASE_URL`, `PI_API_KEY`, `PI_MODEL` (used by the container runner)
  - or `OPENAI_BASE_URL`, `OPENAI_API_KEY`
- Provider-specific keys:
  - `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, etc.

Only a small allowlist of variables is extracted and mounted into the container at `/workspace/env-dir/env`, then sourced by the entrypoint script. This prevents leaking unrelated host environment into the agent.

### Changing the Assistant Name

Set the `ASSISTANT_NAME` environment variable:

```bash
ASSISTANT_NAME=Bot npm start
```

Or edit the default in `src/config.ts`. This changes:
- The trigger pattern (messages must start with `@YourName`)
- The response prefix (`YourName:` added automatically)

### Placeholder Values in launchd

Files with `{{PLACEHOLDER}}` values need to be configured:
- `{{PROJECT_ROOT}}` - Absolute path to your FFT_nano installation
- `{{NODE_PATH}}` - Path to node binary (detected via `which node`)
- `{{HOME}}` - User's home directory

---

## Memory System

FFT_nano uses a hierarchical memory system based on MEMORY.md files.

### Memory Hierarchy

| Level | Location | Read By | Written By | Purpose |
|-------|----------|---------|------------|---------|
| **Global** | `groups/global/MEMORY.md` | All groups | Main only | Preferences, facts, context shared across all conversations |
| **Group** | `groups/{name}/MEMORY.md` | That group | That group | Group-specific durable facts and compaction memory |
| **Files** | `groups/{name}/*.md` | That group | That group | Notes, research, documents created during conversation |

### How Memory Works

1. **Agent Context Loading**
   - Agent runs with `cwd` set to `groups/{group-name}/`
   - FFT_nano agent runner builds a system prompt that includes:
     - `../MEMORY.md` (global memory when mounted)
     - `./MEMORY.md` (group memory)

2. **Writing Memory**
   - When user says "remember this", agent writes to `./MEMORY.md`
   - When user says "remember this globally" (main channel only), agent writes to `../MEMORY.md`
   - Agent can create files like `notes.md`, `research.md` in the group folder

3. **Main Channel Privileges**
   - Only the "main" group (self-chat) can write to global memory
   - Main can manage registered groups and schedule tasks for any group
   - Main can configure additional directory mounts for any group
   - All groups have Bash access (safe because it runs inside container)

---

## Session Management

Sessions enable conversation continuity.

### How Sessions Work

1. Each group gets a dedicated `~/.pi` directory mounted into the container
2. The Pi runtime persists conversation state under that directory
3. The agent runner uses `pi -c` when possible

---

## Message Flow

### Incoming Message Flow

```
1. User sends WhatsApp message
   │
   ▼
2. Baileys receives message via WhatsApp Web protocol
   │
   ▼
3. Message stored in SQLite (store/messages.db)
   │
   ▼
4. Message loop polls SQLite (every 2 seconds)
   │
   ▼
5. Router checks:
   ├── Is chat_jid in registered_groups.json? → No: ignore
   └── Does message start with @Assistant? → No: ignore
   │
   ▼
6. Router catches up conversation:
   ├── Fetch all messages since last agent interaction
   ├── Format with timestamp and sender name
   └── Build prompt with full conversation context
   │
   ▼
7. Router invokes the Pi runtime:
   ├── cwd: groups/{group-name}/
   ├── prompt: conversation history + current message
   └── system prompt: memory + IPC conventions
   │
   ▼
8. FarmFriend processes message:
   ├── Reads MEMORY.md + memory/*.md for recall
   ├── Reads SOUL.md for stable behavior/policy
   └── Uses tools as needed (search, email, etc.)
   │
   ▼
9. Router prefixes response with assistant name and sends via WhatsApp
   │
   ▼
10. Router updates last agent timestamp
```

### Trigger Word Matching

Messages must start with the trigger pattern (default: `@FarmFriend`):
- `@FarmFriend what's the weather?` → ✅ Triggers FarmFriend
- `@andy help me` → ✅ Triggers (case insensitive)
- `Hey @FarmFriend` → ❌ Ignored (trigger not at start)
- `What's up?` → ❌ Ignored (no trigger)

### Conversation Catch-Up

When a triggered message arrives, the agent receives all messages since its last interaction in that chat. Each message is formatted with timestamp and sender name:

```
[Jan 31 2:32 PM] John: hey everyone, should we do pizza tonight?
[Jan 31 2:33 PM] Sarah: sounds good to me
[Jan 31 2:35 PM] John: @FarmFriend what toppings do you recommend?
```

This allows the agent to understand the conversation context even if it wasn't mentioned in every message.

---

## Commands

### Commands Available in Any Group

| Command | Example | Effect |
|---------|---------|--------|
| `@Assistant [message]` | `@FarmFriend what's the weather?` | Talk to FarmFriend |

### Commands Available in Main Channel Only

| Command | Example | Effect |
|---------|---------|--------|
| `@Assistant add group "Name"` | `@FarmFriend add group "Family Chat"` | Register a new group |
| `@Assistant remove group "Name"` | `@FarmFriend remove group "Work Team"` | Unregister a group |
| `@Assistant list groups` | `@FarmFriend list groups` | Show registered groups |
| `@Assistant remember [fact]` | `@FarmFriend remember I prefer dark mode` | Add to global memory |

---

## Scheduled Tasks

FFT_nano has a built-in scheduler that runs tasks as full agents in their group's context.

### How Scheduling Works

1. **Group Context**: Tasks created in a group run with that group's working directory and memory
2. **Full Agent Capabilities**: Scheduled tasks have access to bash + file operations
3. **Optional Messaging**: Tasks can send messages to their group using the `send_message` tool, or complete silently
4. **Main Channel Privileges**: The main channel can schedule tasks for any group and view all tasks

### Schedule Types

| Type | Value Format | Example |
|------|--------------|---------|
| `cron` | Cron expression | `0 9 * * 1` (Mondays at 9am) |
| `interval` | Milliseconds | `3600000` (every hour) |
| `once` | ISO timestamp | `2024-12-25T09:00:00Z` |

### Creating a Task

```
User: @FarmFriend remind me every Monday at 9am to review the weekly metrics

FarmFriend: writes /workspace/ipc/tasks/*.json (schedule_task)
        {
          "prompt": "Send a reminder to review weekly metrics. Be encouraging!",
          "schedule_type": "cron",
          "schedule_value": "0 9 * * 1"
        }

FarmFriend: Done! I'll remind you every Monday at 9am.
```

### One-Time Tasks

```
User: @FarmFriend at 5pm today, send me a summary of today's emails

FarmFriend: writes /workspace/ipc/tasks/*.json (schedule_task)
        {
          "prompt": "Search for today's emails, summarize the important ones, and send the summary to the group.",
          "schedule_type": "once",
          "schedule_value": "2024-01-31T17:00:00Z"
        }
```

### Managing Tasks

From any group:
- `@FarmFriend list my scheduled tasks` - View tasks for this group
- `@FarmFriend pause task [id]` - Pause a task
- `@FarmFriend resume task [id]` - Resume a paused task
- `@FarmFriend cancel task [id]` - Delete a task

From main channel:
- `@FarmFriend list all tasks` - View tasks from all groups
- `@FarmFriend schedule task for "Family Chat": [prompt]` - Schedule for another group

---

## MCP Servers

### FFT_nano MCP (built-in)

The `fft_nano` MCP server is created dynamically per agent call with the current group's context.

**Available Tools:**
| Tool | Purpose |
|------|---------|
| `schedule_task` | Schedule a recurring or one-time task |
| `list_tasks` | Show tasks (group's tasks, or all if main) |
| `get_task` | Get task details and run history |
| `update_task` | Modify task prompt or schedule |
| `pause_task` | Pause a task |
| `resume_task` | Resume a paused task |
| `cancel_task` | Delete a task |
| `send_message` | Send a WhatsApp message to the group |

---

## Deployment

FFT_nano runs as a single macOS launchd service.

### Startup Sequence

When FFT_nano starts, it:
1. **Ensures Apple Container system is running** - Automatically starts it if needed (survives reboots)
2. Initializes the SQLite database
3. Loads state (registered groups, sessions, router state)
4. Connects to WhatsApp
5. Starts the message polling loop
6. Starts the scheduler loop
7. Starts the IPC watcher for container messages

### Service: com.fft_nano

**launchd/com.fft_nano.plist:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "...">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.fft_nano</string>
    <key>ProgramArguments</key>
    <array>
        <string>{{NODE_PATH}}</string>
        <string>{{PROJECT_ROOT}}/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>{{PROJECT_ROOT}}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>{{HOME}}/.local/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>{{HOME}}</string>
        <key>ASSISTANT_NAME</key>
        <string>Andy</string>
    </dict>
    <key>StandardOutPath</key>
    <string>{{PROJECT_ROOT}}/logs/fft_nano.log</string>
    <key>StandardErrorPath</key>
    <string>{{PROJECT_ROOT}}/logs/fft_nano.error.log</string>
</dict>
</plist>
```

### Managing the Service

```bash
# Install service
cp launchd/com.fft_nano.plist ~/Library/LaunchAgents/

# Start service
launchctl load ~/Library/LaunchAgents/com.fft_nano.plist

# Stop service
launchctl unload ~/Library/LaunchAgents/com.fft_nano.plist

# Check status
launchctl list | grep fft_nano

# View logs
tail -f logs/fft_nano.log
```

---

## Security Considerations

### Container Isolation

All agents run inside Apple Container (lightweight Linux VMs), providing:
- **Filesystem isolation**: Agents can only access mounted directories
- **Safe Bash access**: Commands run inside the container, not on your Mac
- **Network isolation**: Can be configured per-container if needed
- **Process isolation**: Container processes can't affect the host
- **Non-root user**: Container runs as unprivileged `node` user (uid 1000)

### Prompt Injection Risk

WhatsApp messages could contain malicious instructions attempting to manipulate the agent's behavior.

**Mitigations:**
- Container isolation limits blast radius
- Only registered groups are processed
- Trigger word required (reduces accidental processing)
- Agents can only access their group's mounted directories
- Main can configure additional directories per group
- Model safety training (varies by provider)

**Recommendations:**
- Only register trusted groups
- Review additional directory mounts carefully
- Review scheduled tasks periodically
- Monitor logs for unusual activity

### Credential Storage

| Credential | Storage Location | Notes |
|------------|------------------|-------|
| Pi State | data/pi/{group}/.pi/ | Per-group isolation, mounted to /home/node/.pi/ |
| WhatsApp Session | store/auth/ | Auto-created, persists ~20 days |

### File Permissions

The groups/ folder contains personal memory and should be protected:
```bash
chmod 700 groups/
```

---

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| No response to messages | Service not running | Check `launchctl list | grep fft_nano` |
| "Agent runner exited with code 1" | Apple Container failed to start | Check logs; FFT_nano auto-starts container system but may fail |
| "Agent runner exited with code 1" | Pi home mount path wrong | Ensure mount is to `/home/node/.pi/` |
| Session not continuing | Pi state not persisted | Check `data/pi/<group>/.pi/` mount and container logs |
| Session not continuing | Mount path mismatch | Container user is `node` with HOME=/home/node; state must be at `/home/node/.pi/` |
| "QR code expired" | WhatsApp session expired | Delete store/auth/ and restart |
| "No groups registered" | Haven't added groups | Use `@FarmFriend add group "Name"` in main |

### Log Location

- `logs/fft_nano.log` - stdout
- `logs/fft_nano.error.log` - stderr

### Debug Mode

Run manually for verbose output:
```bash
npm run dev
# or
node dist/index.js
```
