![FFT_nano Logo](logo.png)

```text
FFT_NANO
```

FarmFriend_Terminal:nano (FFT_nano): a secure, containerized AI assistant for farmers.

## What This Is

FarmFriend_Terminal:nano (FFT_nano) is a minimal, security-first AI agent in a container runtime for farm workflows. **Telegram and WhatsApp** - your channel, your choice.

The goal here is to turn that foundation into a paradigm-shifting agricultural assistant that:
- Works for farmers of all sizes (solo → enterprise)
- Runs locally where it counts (edge devices like Raspberry Pi) and online where it helps
- Is usable from a phone (Telegram or WhatsApp)
- Is proactive (scheduled tasks + event-driven workflows), not just reactive prompting
- Has long-term memory that feels like "Jarvis": context-aware, quietly helpful, low-friction

The codebase stays intentionally small: one Node process + one containerized agent runner.

## Quick Start

```bash
git clone https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano.git
cd FFT_nano

npm install
./container/build.sh        # macOS (Apple Container)
# or ./container/build-docker.sh  # Linux/RPi

# Configure LLM (example: Z.AI GLM) and your chat channel
cat > .env <<'EOF'
PI_API=zai
PI_MODEL=glm-4.7
ZAI_API_KEY=...

# Choose your channel:
# Telegram: add your bot token
TELEGRAM_BOT_TOKEN=your_bot_token_here

# OR WhatsApp: run npm run auth instead
EOF

# Start FFT_nano:
# - Telegram: message /start to your bot after adding the token
# - WhatsApp: npm run auth first, then start

npm run dev
```

Then configure your runtime, build the agent image, and start the service.

## Core Principles

**Small enough to understand.** One process, a few source files. No microservices, no message queues, no abstraction layers.

**Secure by isolation.** Agents run in Linux containers (Apple Container on macOS, or Docker). They can only see what's explicitly mounted. Bash access is safe because commands run inside the container, not on your host.

**Built for one user (or one farm).** Fork it and tailor it.

**Customization = code changes.** No configuration sprawl. Want different behavior? Modify the code. The codebase is small enough that this is safe.

**AI-native.** No monitoring dashboard; ask FarmFriend what's happening. Debug by asking it to read logs and state.

## What It Supports

- **Telegram I/O** - Built-in bot-based messaging (server-friendly, always-on)
- **WhatsApp I/O** - Personal WhatsApp via Baileys
- **Isolated group context** - Each group has its own memory, filesystem, and container sandbox
- **Main channel** - Your private channel for admin control
- **Scheduled tasks** - Recurring jobs that run FarmFriend and message you back
- **Web access** - bash (curl) and browser automation
- **Container isolation** - Sandboxed agents in Apple Container (macOS) or Docker (Linux/RPi)

## Usage

Talk to your assistant with the trigger word (default: `@FarmFriend`):

```
@FarmFriend create a weekly fieldwork plan for the next 7 days (weather-aware)
@FarmFriend remind me to service the tractor every 50 hours of runtime
@FarmFriend log that we sprayed Field 3 with product X at rate Y today
```

From the main channel, you can manage groups and tasks:
```
@FarmFriend list all scheduled tasks across groups
@FarmFriend pause the Monday briefing task
@FarmFriend join the Family Chat group
```

## Customizing

There are no configuration files to learn. Just change the code and memory files:

- "Change the trigger word to @Bob"
- "Remember in the future to make responses shorter and more direct"
- "Add a custom greeting when I say good morning"
- "Store conversation summaries weekly"

The codebase is small enough that the agent can modify it.

## Contributing

FFT_nano is intentionally a "fork-that-becomes-a-product". Keep changes security-first and easy to reason about.

### Roadmap

- WhatsApp Business API channel (scale/robustness)
- Farm ledger (fields, operations, inventory, equipment)
- Event-driven proactivity (alerts + digests)
- Optional on-farm sensor ingestion (MQTT)

## Requirements

- macOS or Linux
- Node.js 20+
- An LLM API key usable by `pi` (pi-coding-agent)
- Apple Container (macOS) or Docker (macOS/Linux)

## Configuration

| Variable | Purpose |
|----------|---------|
| `PI_API` | LLM provider (e.g. `zai`, `openai`, `anthropic`) |
| `PI_MODEL` | Model name (e.g. `glm-4.7`) |
| `ZAI_API_KEY` | Your API key |
| `CONTAINER_RUNTIME` | `auto`, `apple`, or `docker` |
| `TELEGRAM_BOT_TOKEN` | Enables Telegram bot |
| `TELEGRAM_MAIN_CHAT_ID` | Maps Telegram chat to main group |
| `TELEGRAM_ADMIN_SECRET` | Required to claim admin via `/main <secret>` |
| `WHATSAPP_ENABLED` | `1` (default) or `0` |

## Architecture

```
Channels (Telegram / WhatsApp) --> SQLite --> Polling loop --> Container (Pi agent) --> Response
```

Single Node.js process. Agents in isolated Linux containers with mounted directories. IPC via filesystem. No daemons, no queues, no complexity.

Key files:
- `src/index.ts` - Main app: channel connections, routing, IPC
- `src/container-runner.ts` - Spawns agent containers
- `src/task-scheduler.ts` - Runs scheduled tasks
- `src/db.ts` - SQLite operations
- `groups/*/CLAUDE.md` - Per-group memory

## FAQ

**Telegram or WhatsApp?**

Telegram is bot-native and server-friendly (always-on, no phone required). WhatsApp is convenient for personal use. FFT_nano supports both - pick what works for you.

**How do I make Telegram my main/admin channel?**

1. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_SECRET` in `.env`
2. Start FFT_nano
3. DM your bot:
   - `/id` to see your chat id
   - `/main <secret>` to claim the main channel

**Why Apple Container instead of Docker?**

On macOS, Apple Container is lightweight and fast. On Linux/RPi, Docker is the default. Force either with `CONTAINER_RUNTIME`.

**Can I run this on Linux?**

Yes. Install Docker, build with `./container/build-docker.sh`, run with `CONTAINER_RUNTIME=docker`.

**Is this secure?**

Agents run in containers, not application-level permission checks. They only access mounted directories. The codebase is small enough to review. See [docs/SECURITY.md](docs/SECURITY.md).

**Why no configuration files?**

No configuration sprawl. Customize the code directly - it's small enough to be safe.

**How do I debug?**

Ask FarmFriend. "Why isn't the scheduler running?" "What's in the logs?" That's the AI-native approach.

**What changes will be accepted?**

Security fixes, bug fixes, and changes that advance the FarmFriend mission while keeping things understandable.

## License

MIT
