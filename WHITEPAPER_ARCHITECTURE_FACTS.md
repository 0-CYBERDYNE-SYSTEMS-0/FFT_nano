# FFT Nano — Whitepaper Architecture Facts

**Version:** 0.1.0
**Repository:** https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano.git
**License:** MIT
**Runtime:** Node.js >= 20, TypeScript, ESM
**Codebase:** 88 TypeScript source files, 9,333 lines across the three core modules alone

---

## 1. Tools/Skills System

### Runtime Skills (Agent-facing, repo-tracked)
**Count: 12 runtime skills**
**Location:** `skills/runtime/`

| Skill | Purpose |
|-------|---------|
| `agent-browser` | Automated browser sessions (auth, forms, snapshots, video recording, proxy support) |
| `autoresearch-create` | Create autonomous experiment/research loops |
| `autoresearch-finalize` | Finalize and package research results |
| `fft-coder-ops` | Coding agent orchestration (plan, execute, worktree management) |
| `fft-dashboard-ops` | Dashboard deployment and management |
| `fft-debug` | Debug snapshot collection and diagnostics |
| `fft-farm-bootstrap` | Farm operation initial setup |
| `fft-farm-onboarding` | Farm onboarding workflows |
| `fft-farm-ops` | Day-to-day farm operations |
| `fft-setup` | Prerequisite checking and installation |
| `fft-telegram-ops` | Telegram bot management commands |
| `rapid-research` | Quick research with templates and source logs |

**Evidence:** `ls skills/runtime/` — 12 directories each with `SKILL.md`

### Setup Skills (Operator-facing, one-time)
**Count: 3 setup skills**
**Location:** `skills/setup/`

| Skill | Purpose |
|-------|---------|
| `customize` | Agent customization guide |
| `debug` | Debugging setup guide |
| `setup` | Initial setup guide |

**Evidence:** `ls skills/setup/` — 3 directories each with `SKILL.md`

### Required Skills (hardcoded)
**Count: 4 required skills**
Defined in `src/pi-skills.ts` line 13-18:
- `fft-setup`
- `fft-debug`
- `fft-telegram-ops`
- `fft-coder-ops`

### Pi-Coding-Agent Built-in Tools
The agent runs inside `@mariozechner/pi-coding-agent` (^0.67.6), which provides standard coding agent tools:
- `bash` — shell command execution (audited via `src/bash-guard.ts`)
- `write` — file writing (permission-gated)
- `edit` — file editing (permission-gated)
- `read` / `glob` / `grep` — file system search and reading

**Permission gate extension:** `src/extensions/fft-permission-gate.ts` intercepts `tool_call` events for `bash`, `write`, and `edit`, applying policy from `src/permission-gate-policy.ts`.

### Custom Extension Tools
**Count: 3 custom tools** from the autoresearch extension (`src/extensions/pi-autoresearch/index.ts`):
- `run_experiment` — run any command, time it, capture output, detect pass/fail
- `log_experiment` — record results with session-persisted state
- One additional registered tool (line 2403)

### Skill Mirroring Architecture
Two-layer skill system:
1. **Repo layer:** `skills/runtime/` — version-controlled, available to all groups
2. **Personal layer:** `~/nano/skills/` — untracked, workspace-scoped, only available to main/admin

On each run, both layers merge into `data/pi/<group>/.pi/skills/`, then mount to container at `/home/node/.pi/skills/`. Non-main groups get repo layer only. Managed via manifest file `.fft_nano_managed_skills.json`.

---

## 2. AI Provider Integrations

**Count: 9 provider presets** (defined in `src/runtime-config.ts` lines 32-110)

| Provider | PI API | Default Model | API Key Env |
|----------|--------|---------------|-------------|
| OpenAI | `openai` | `gpt-4o-mini` | `OPENAI_API_KEY` |
| LM Studio (local) | `openai` | `qwen2.5-coder-7b-instruct` | `PI_API_KEY` |
| Anthropic | `anthropic` | `claude-3-5-sonnet-latest` | `ANTHROPIC_API_KEY` |
| Gemini | `gemini` | `gemini-2.0-flash` | `GEMINI_API_KEY` |
| OpenRouter | `openrouter` | `anthropic/claude-3.5-sonnet` | `OPENROUTER_API_KEY` |
| ZAI | `zai` | `glm-4.7` | `ZAI_API_KEY` |
| MiniMax | `minimax` | `MiniMax-M2.1` | `MINIMAX_API_KEY` |
| Kimi Coding | `kimi-coding` | `kimi-k2-thinking` | `KIMI_API_KEY` |
| Ollama (local) | `ollama` | `qwen3.5:4b` | `PI_API_KEY` |

Plus a **manual mode** for any OpenAI-compatible endpoint via `PI_API_KEY` + `PI_BASE_URL`.

**Fallback system:** Configurable provider fallback chain (`FFT_NANO_PROVIDER_FALLBACK_ORDER`) with retry logic (3 max retries, exponential backoff with jitter).

**Evidence:** `src/runtime-config.ts`, `src/provider-auth.ts`

---

## 3. Key Architectural Components

### Core Source Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/index.ts` | 6,277 | Main host process: channel listeners, message routing, group management, heartbeat, Telegram/WhatsApp integration, admin commands |
| `src/pi-runner.ts` | 1,999 | Container lifecycle: spawns pi-coding-agent, manages mounts, handles streaming, retries, provider fallback, session management |
| `src/system-prompt.ts` | 1,057 | System prompt construction: context injection, memory retrieval, skill catalog, prompt caching |
| `src/extensions/pi-autoresearch/index.ts` | 3,396 | Autonomous experiment loop infrastructure |
| `src/db.ts` | 708 | SQLite database: schema, migrations, FTS5, scheduled tasks, message storage |
| `src/pi-skills.ts` | 811 | Skill validation, syncing, catalog building |

### Architectural Layers

1. **Host Process** (`src/index.ts`) — Single Node.js process that:
   - Receives messages from Telegram and/or WhatsApp
   - Routes to per-group isolated containers
   - Manages group registration, chat preferences, admin commands
   - Runs heartbeat scheduler, cron scheduler

2. **Container Agent** (`src/pi-runner.ts`) — Spawns `pi` CLI (`@mariozechner/pi-coding-agent`) with:
   - Per-group Docker containers (image: `fft-nano-agent:latest`)
   - Isolated filesystem mounts (workspace, data, skills)
   - Session persistence across turns
   - Streaming output (text, thinking, tool execution)
   - Lifecycle management (6-hour hard timeout, stale detection, fresh session fallback)

3. **System Prompt Engine** (`src/system-prompt.ts`) — Builds layered prompts:
   - Base layer with identity, constraints, tool documentation
   - Context files: `NANO.md`, `SOUL.md`, `TODOS.md`, `MEMORY.md`
   - Memory retrieval context (up to 6,000 chars, top-K=8)
   - Skill catalog (up to 6,000 chars)
   - Prompt caching via SHA-256 hash
   - Configurable budget: 12K chars/file, 48K total max

---

## 4. Messaging Channels

**Count: 2 primary channels + 2 UI channels**

### Primary Chat Channels

| Channel | Library | Trigger |
|---------|---------|---------|
| **Telegram** | Custom implementation (`src/telegram.ts`, ~400 lines interface) | `TELEGRAM_BOT_TOKEN` env var |
| **WhatsApp** | `@whiskeysockets/baileys` ^7.0.0-rc.9 | `WHATSAPP_ENABLED` env var |

**Key details:**
- Telegram: supports photo, video, audio, document, voice message types; streaming text delivery; tool progress indicators; inline keyboard settings panels
- WhatsApp: uses Baileys (web API); QR code auth; group metadata sync; LID JID support
- Main/admin chat concept: one designated chat gets full bot access; non-main chats require trigger word (`@FarmFriend` or configured aliases)
- Chat JID format: Telegram uses `telegram:<numeric_id>`, WhatsApp uses `<phone>@s.whatsapp.net` or `<gid>@g.whatsapp.net`

### UI Channels

| Channel | Port | Purpose |
|---------|------|---------|
| **Web Control Center** | 28990 (default) | Browser-based admin dashboard |
| **TUI Gateway** | 28989 (default) | Terminal UI with WebSocket gateway |

**Evidence:** `src/config.ts` lines 176-212, `src/web/control-center-server.ts`, `src/tui/`

---

## 5. Storage/Memory System

### Database: SQLite via better-sqlite3

**Location:** `store/messages.db`
**Schema (from `src/db.ts`):**

| Table | Purpose |
|-------|---------|
| `chats` | Chat metadata (JID, name, last message time) |
| `messages` | Full message content (id, chat_jid, sender, content, timestamp) |
| `messages_fts` | FTS5 full-text search index over messages |
| `scheduled_tasks` | Cron/interval/one-time scheduled tasks |
| `task_run_logs` | Task execution history with timing and status |

### FTS5 Full-Text Search

- Virtual table: `messages_fts USING fts5(chat_jid UNINDEXED, sender_name, content, timestamp UNINDEXED)`
- Content-synced with auto-increment triggers (INSERT, DELETE, UPDATE)
- Powers transcript memory search for episodic recall

### Document Memory System

Two-tier memory retrieval (`src/memory-search.ts`):

1. **Document Memory** — Searches Markdown files:
   - Canonical docs: `NANO.md`, `SOUL.md`, `TODOS.md`, `canonical/*.md`
   - Primary: `MEMORY.md` / `memory/` directory
   - Chunked at 800 chars max, tokenized with stopword filtering
   - Lexical scoring with TF-IDF-like coverage + density + phrase matching
   - Path-based priority boosts (`_hot.md` > `constraints.md` > `commitments.md`)

2. **Transcript Memory** — Searches FTS5-indexed chat history
   - Per-group and global search
   - Top-K retrieval (default 8, max 64)
   - Character budget: 6,000 chars (configurable 1K-50K)

### Memory File Architecture

```
groups/
  main/                    ← main/admin workspace
    MEMORY.md              ← canonical memory file
    memory/                ← additional memory docs
    canonical/
      _hot.md              ← high-priority context
      constraints.md       ← operational constraints
      commitments.md       ← standing commitments
  global/
    MEMORY.md              ← shared across all groups
  <group>/                 ← per-group isolated workspace
    MEMORY.md
    memory/
```

### Bootstrapped Files (auto-seeded for main workspace)

`AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`, `PRINCIPLES.md`, `TOOLS.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, `MEMORY.md`, `memory/`

**Evidence:** `src/db.ts`, `src/memory-search.ts`, `src/memory-paths.ts`, `src/memory-retrieval.ts`, `src/workspace-bootstrap.ts`

---

## 6. Containerized Execution

### Container Runtime
**File:** `src/container-runtime.ts`

| Mode | Details |
|------|---------|
| **Docker** (default) | Auto-detected; image: `fft-nano-agent:latest` |
| **Host** (opt-in) | Requires `FFT_NANO_ALLOW_HOST_RUNTIME=1` |

### Sandbox Modes
**File:** `src/sandbox.ts` (123 lines)

| Mode | Details |
|------|---------|
| `docker` | Full Docker container sandbox with volume mounts |
| `bwrap` | Bubblewrap sandbox (read-only root, tmpfs /tmp, no network) |
| `none` (default) | No sandboxing |

### Container Configuration

| Parameter | Default | Configurable |
|-----------|---------|-------------|
| Container image | `fft-nano-agent:latest` | `CONTAINER_IMAGE` env |
| Hard timeout | 6 hours | `CONTAINER_TIMEOUT` env |
| Max output size | 10 MB | `CONTAINER_MAX_OUTPUT_SIZE` env |
| Tool mode | `default` / `read_only` / `full` | Per-run parameter |

### Per-Group Isolation

Each group gets:
- Isolated data directory: `data/pi/<group>/.pi/` (mounted to `/home/node/.pi`)
- Isolated workspace: `groups/<group>/`
- Isolated skills: merged from repo + personal (main only)
- Isolated session state (conversation history persists across turns)

### Mount Security

**File:** `src/mount-security.ts`

- External allowlist at `~/.config/fft_nano/mount-allowlist.json`
- Default blocked patterns (SSH keys, cloud credentials, wallet files, etc.)
- Path traversal prevention
- Read-only enforcement for sensitive paths
- Main group gets wider mount privileges

### Destructive Command Guard

**File:** `src/bash-guard.ts` (69 lines)

14 destructive command patterns blocked:
- `rm -r/-f`, `rmdir`, `dd of=`, `mkfs`, `chmod -R 777/000`, `chown -R`
- `git clean -f`, `git reset --hard`, `git push --force/-f`, `truncate`, `shred`

---

## 7. Key Unique Features

### Voice-to-Automation
- Voice message transcription via OpenAI Whisper API (`skills/setup/add-voice-transcription/`)
- ~$0.006/minute cost; transcribes WhatsApp voice notes for agent comprehension
- Fallback message when transcription unavailable

### Coding Agent with Approval Gates
- Natural language coding requests detected; bot offers Plan/Execute/Cancel controls
- `/coder`, `/coding`, `/coder-plan` commands
- Host-managed isolated worktrees for execution
- Subagent spawning with model preference (`gpt-5.4-mini` for efficiency)

### Autonomous Experiment Loops
- Custom pi extension (`src/extensions/pi-autoresearch/index.ts`, 3,396 lines)
- `run_experiment` and `log_experiment` tools
- Status widget with experiment count + best metric
- Dashboard with Ctrl+X toggle

### Session Compaction
- Automatic memory compaction from conversation history
- Generates structured markdown: Summary, Decisions, Open Tasks, Important Paths/Files

### Prompt Lifecycle Management
- Prompt caching via SHA-256 hashing (`src/prompt-lifecycle.ts`)
- Preflight decisions to skip redundant LLM calls
- Runtime state tracking

### X/Twitter Integration
- Setup skill with scripts for post, like, retweet, reply, quote
- Browser-based automation via agent-browser skill

### Gmail Integration
- Setup skill (`skills/setup/add-gmail/`)

### Parallel Execution
- Setup skill for concurrent task processing (`skills/setup/add-parallel/`)

### Picture-to-Setup
- Telegram supports photo upload; agent-browser skill handles screenshot capture and workflow automation
- File delivery supports photos, videos, audio, documents

---

## 8. Home Assistant Integration

**File:** `src/home-assistant.ts` (306 lines)

### Architecture
- `HomeAssistantAdapter` class with REST API integration
- Bearer token authentication (`HA_TOKEN` env)
- Multi-endpoint failover with auto-probe

### API Capabilities

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `getAllStates()` | `/api/states` | Get all entity states |
| `getState(id)` | `/api/states/<id>` | Get specific entity |
| `callService()` | `/api/services/<domain>/<service>` | Call HA service |
| `getCalendarEvents()` | `/api/calendars/<id>` | Get calendar events |

### Endpoint Resolution
- Primary URL: `HA_URL` env (default `http://localhost:8123`)
- Candidates: `HA_URL_CANDIDATES` env + built-in fallbacks (`localhost:8123`, `192.168.64.1:8123`)
- Auto-probes candidates on startup; failover on network errors (5xx, ECONNREFUSED, etc.)
- Zod schema validation for all responses

### Farm State Collector
**File:** `src/farm-state-collector.ts`

Three collection cadences:
- Fast: 15s (sensors, real-time data)
- Medium: 2min (device states)
- Slow: 15min (historical data)

**Evidence:** `src/home-assistant.ts`, `src/farm-state-collector.ts`, `src/farm-action-gateway.ts`

---

## 9. Cron/Scheduling System

### Architecture
**Files:** `src/cron/service.ts` (512 lines), `src/cron/types.ts` (35 lines), `src/cron/adapters.ts` (270 lines)

### Schedule Types (3)

| Type | Description | Example |
|------|-------------|---------|
| `cron` | Standard 5-field cron expression | `*/30 * * * *` |
| `interval` | Millisecond-based recurring | Every 30 minutes |
| `once` | One-time execution at specific time | `2026-01-01T09:00:00` |

### Policy System

| Policy | Options |
|--------|---------|
| Session target | `main` (reuse session) or `isolated` (fresh context) |
| Wake mode | `next-heartbeat` or `now` |
| Delivery | `none`, `announce` (send to chat), `webhook` (HTTP POST) |
| Delete after run | Boolean — auto-remove one-shot tasks |
| Timeout | Configurable per-task (max: 24 hours default) |
| Stagger | Random offset in ms to avoid thundering herd |

### Error Handling
- Exponential backoff: 30s → 60s → 5min → 15min → 60min
- Consecutive error tracking in DB
- Task status tracking: `active`, error states

### Persistence
- Tasks stored in `scheduled_tasks` SQLite table
- Run logs in `task_run_logs` table
- Snapshot written to `data/tasks-snapshot.json` for container access

**Evidence:** `src/cron/types.ts`, `src/cron/adapters.ts`, `src/cron/service.ts`, `src/db.ts`

---

## 10. Skills System Architecture

### Directory Layout
```
fft_nano/                     ← project root
  skills/
    setup/                    ← 8 operator-facing guides
    runtime/                  ← 12 repo-tracked agent skills
~/nano/
  skills/                     ← personal skills (untracked)

data/pi/<group>/.pi/skills/   ← merged destination (host)
container:/home/node/.pi/skills/  ← mounted in container
```

### Skill Definition Format
Each skill is a directory containing `SKILL.md` with YAML frontmatter:

```yaml
---
name: skill-name              # Required, lowercase + hyphens, max 64 chars
description: What it does     # Required, max 1024 chars
license: MIT                  # Optional
compatibility: ">=1.5.0"      # Optional, max 500 chars
allowed-tools: bash,write     # Optional
metadata:                     # Optional key/value map
  category: operations
---
## When to use this skill
...

## When not to use this skill
...
```

### Validation (`npm run validate:skills`)
- Frontmatter field validation (required: name, description)
- Name format: lowercase alphanumeric + hyphens, no leading/trailing/consecutive hyphens
- Path safety: no symlinks, no path traversal outside skill root
- High-risk skill names (containing ops/install/setup/debug/deploy/etc.) require "when not to use" guidance
- FFT policy guardrails: must include "never run destructive git commands" and "preserve unrelated worktree changes"

### Sync Flow
1. Scan `skills/runtime/` for directories with `SKILL.md`
2. If main group, also scan `~/nano/skills/`
3. Validate all skills
4. Sync to `data/pi/<group>/.pi/skills/`
5. Track managed skills in `.fft_nano_managed_skills.json`
6. Personal skills never overwritten by sync

### Catalog Injection
Skills are injected into the system prompt as a catalog:
```
Skill Catalog (N skills available):
- name: description [allowed-tools: ...]
```
Max catalog size: 6,000 chars (configurable)

**Evidence:** `src/pi-skills.ts`, `src/system-prompt.ts`, `skills/` directory

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| TypeScript source files | 88 |
| Core source lines (index + pi-runner + system-prompt) | 9,333 |
| Runtime skills | 12 |
| Setup skills | 8 |
| Required skills | 4 |
| Custom extension tools | 3 |
| AI provider presets | 9 + manual |
| Messaging channels | 2 (Telegram, WhatsApp) |
| UI interfaces | 2 (Web Control Center, TUI) |
| Schedule types | 3 (cron, interval, once) |
| SQLite tables | 5 |
| Destructive command patterns | 14 |
| Container sandbox modes | 3 (docker, bwrap, none) |
| Memory search types | 2 (document + transcript) |
| Bootstrapped workspace files | 10 |
