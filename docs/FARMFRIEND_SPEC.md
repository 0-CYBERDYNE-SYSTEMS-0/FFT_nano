# FarmFriendTerminal_nano (FFT_nano) — Product & Architecture Spec

This document describes how to evolve FFT_nano from a secure “agent-in-a-container” foundation into a **full-service agricultural assistant** that feels proactive (Jarvis-like), works for farms of any size, and runs both **locally (edge)** and **online (cloud)**.

## 1) What FFT_nano Is Today

FFT_nano currently consists of:

- A single Node.js host process that:
  - Receives messages from chat channels (WhatsApp is built-in today; Telegram is optional)
  - Stores messages (and scheduling state) in SQLite
  - Runs the agent in an isolated Linux container
  - Relays agent responses back to chat
- A containerized “agent runner” that:
  - Runs Pi agent runtime
  - Has filesystem mounts that define what the agent can see
  - Uses filesystem IPC (`/workspace/ipc`) for outbound messages and scheduling operations

This is already an unusually good base for a “real” assistant because it has:

- OS-level isolation (container boundary)
- Persistent per-conversation memory (`groups/<group>/SOUL.md`, session transcripts)
- Scheduled tasks (a prerequisite for proactive behavior)

## 2) Product Goal: “Invisible Frictionless Farming”

FarmFriendTerminal_nano should feel like a farm operator’s *second brain*:

- It **notices** what matters (weather changes, supply levels, compliance deadlines, equipment hours)
- It **asks only the minimum questions** needed to act correctly
- It **logs everything** without the farmer needing to “do paperwork”
- It works even with **spotty internet** (edge-first) and upgrades seamlessly when online

## 3) Deployment Targets (Local + Online)

### 3.1 Edge-first (recommended)

Run on a Raspberry Pi / small server on-farm:

- Docker runtime
- SQLite stored locally
- Optional local model(s) for basic tasks when offline
- Sync upstream when internet is available

This mode is for:

- Data sovereignty (farm logs stay on the farm)
- Low latency
- Resilience

### 3.2 Hybrid edge + cloud

- Edge keeps the operational database and sensor integrations
- Cloud provides heavy compute (LLM, satellite imagery processing, large-scale forecasting)
- Encrypted replication/sync between edge and cloud

### 3.3 Cloud-only

- Useful for very small deployments without hardware
- Lower resilience; higher privacy risk

## 4) Channels (WhatsApp + Telegram + future)

### 4.1 WhatsApp

- Good UX (farmers already use it)
- But operationally fragile at scale (WhatsApp Web / Baileys constraints)

### 4.2 Telegram

- Bot-native and deployment-friendly
- Better for edge devices and multi-user scenarios

### 4.3 Future channels

- WhatsApp Business API (for larger orgs)
- SMS/Voice (Twilio) for no-smartphone workflows
- Web UI (for dashboards and audits)

## 5) The “Jarvis” Experience: Proactivity Without Spam

The assistant should not require constant prompting. That means FFT_nano must become *event-driven*, not just “chat-driven”.

### 5.1 Signals (what the assistant observes)

- Time (scheduled jobs)
- Weather and forecasts
- Sensor streams (soil moisture, tank levels, irrigation pressure, temperature)
- Equipment telemetry (hours, fault codes)
- Inventory movements (feed, seed, fertilizer, chemicals)
- Work orders / field activities
- Compliance calendars (spray records, withholding periods, organic audits)
- Market prices and buyer schedules

### 5.2 Actions (what the assistant can do)

- Generate daily/weekly plans
- Send reminders and checklists
- Log field operations in structured form
- Produce compliance-ready reports
- Recommend interventions (irrigation, pest scouting, nutrient adjustments)
- Draft purchase orders / reorder suggestions
- Summarize “what changed since yesterday”

### 5.3 Attention policy (how it avoids being annoying)

Implement a simple policy layer:

- Only send proactive messages when:
  - A threshold is crossed (e.g., freeze risk, moisture below minimum)
  - A deadline is imminent
  - A plan is blocked (missing key info)
  - The user explicitly opted-in to that category
- Batch low-urgency updates into a single digest (e.g., 6pm “farm wrap-up”)

## 6) Memory: Long-term, Structured, Searchable

FFT_nano already has:

- Per-group memory via `groups/<group>/SOUL.md`
- Conversation archiving on compaction to `groups/<group>/conversations/`

To get “Jarvis memory”, add **structured memory** alongside freeform text:

### 6.1 Memory layers

- **Working memory**: current session context (Claude session)
- **Episodic memory**: conversation archives + farm activity history
- **Semantic memory**: durable facts (farm profile, fields, equipment, SOPs)

### 6.2 Suggested farm data primitives

- `farm_profile` (location(s), time zone, units, preferences)
- `fields` (name, crop, acreage/hectares, soil type, irrigation type)
- `operations_log` (sprays, fertigation, planting, harvest, scouting notes)
- `equipment` (machine, service intervals, last service, parts)
- `inventory` (items, min/max, reorder lead times)
- `contacts` (agronomist, vet, mechanic, buyer)

### 6.3 Retrieval

Start pragmatic:

- SQLite tables for structured records
- SQLite FTS5 for text search over logs and notes

Then upgrade:

- Optional embeddings-based retrieval (local embedding model or cloud)

## 7) Security Model (non-negotiable)

FFT_nano’s core advantage is real isolation. Preserve and extend it:

- Each farm / chat context runs with its own container mounts
- Only explicitly allowed directories are mounted
- Keep secrets out of the agent container when possible

### 7.1 Recommended additions

- Encrypt sensitive SQLite content at rest (SQLCipher or OS-level disk encryption)
- Add an **audit log** for:
  - Outbound messages
  - Scheduled task creation/changes
  - Any external integrations invoked
- Introduce per-channel admin controls:
  - Control channel(s) that can register new chats
  - Optional allowlist of Telegram user IDs

## 8) Container Strategy (Apple + Docker)

- macOS: Apple Container runtime (`container` CLI)
- Linux/RPi: Docker runtime (`docker` CLI)

Operational goals:

- Multi-arch images (`linux/amd64`, `linux/arm64`) for Raspberry Pi
- Minimal image size; stable Chromium dependencies
- Clear “one command” deploy for edge devices

## 9) Roadmap (practical sequence)

### Phase 1 — Foundation (now)

- Multi-runtime container runner (Apple Container + Docker)
- Telegram channel support
- Clear environment/config story for edge deployments

### Phase 2 — Farm primitives

- Add a “farm ledger” (structured tables + simple commands)
- Add minimal sensor ingestion (MQTT) as an optional module
- Add report generation (spray log, inventory, equipment maintenance)

### Phase 3 — Proactivity

- Event-triggered jobs (threshold alerts)
- Daily digest + weekly planning routines
- “Ask minimal questions” workflow patterns

### Phase 4 — Hybrid sync + enterprise

- Optional cloud sync
- Multi-user roles and permissions
- WhatsApp Business API channel

## 10) Current Implementation Notes

Environment variables introduced/used by FFT_nano:

- `PI_BASE_URL` = optional OpenAI-compatible base URL (also treated as `OPENAI_BASE_URL`)
- `PI_API_KEY` = optional API key override passed to `pi` via `--api-key`
- `PI_MODEL` = optional model override
- `PI_API` = optional provider name passed to `pi` via `--provider` (e.g. `openai`, `anthropic`)
- `FFT_NANO_DRY_RUN` = `1` to bypass LLM calls (smoke testing)
- `CONTAINER_RUNTIME` = `auto` (default) | `apple` | `docker`
- `WHATSAPP_ENABLED` = `1` (default) | `0`
- `TELEGRAM_BOT_TOKEN` = enables Telegram polling + sending
- `TELEGRAM_MAIN_CHAT_ID` = optional; maps a Telegram chat to the `main` group folder
- `TELEGRAM_AUTO_REGISTER` = `1` (default) | `0`
- `TELEGRAM_API_BASE_URL` = optional; override Telegram API endpoint (proxy/self-host)
