![FFT_nano Logo](logo.png)

```text
FFT_NANO
```

FarmFriend_Terminal:nano (FFT_nano): a secure, containerized AI assistant for farmers.

## What This Is

FFT_nano is different from any software you've used before.

Most farm software is rigid - you learn its menus, work around its limits, and call a dealer when something breaks. FFT_nano isn't like that. It's small enough to understand, and it talks to you. When something goes wrong, you ask it what's happening. When you want it to work differently, you tell it what you need and it adapts.

This is software that learns. It reads its own documentation, understands its own code, and can modify itself based on what you ask for. You're not using software - you're working with it.

## The Difference

| Traditional Farm Software | FFT_nano |
|-------------------------|----------|
| Fixed menus and workflows | Tell it what you want, it figures it out |
| Call a dealer to fix issues | "What's wrong?" - it reads the logs and tells you |
| Configuration files and menus | Just ask: "change the trigger to @Bob" |
| Updates that break your workflow | It's small enough that you control every change |
| Closed and rigid | Open, readable, bendable to your needs |

## What It Does

FFT_nano connects to Telegram or WhatsApp and becomes your farm's second brain:
- Logs field work, equipment hours, inputs applied
- Creates weather-aware fieldwork plans
- Sends reminders when maintenance is due
- Answers questions about your operation
- Learns from every conversation

All through a simple chat interface on your phone.

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

## Talk to It Like a Hand

FFT_nano understands plain language. No menus to learn:

```
@FarmFriend create a weekly fieldwork plan for the next 7 days (weather-aware)
@FarmFriend remind me to service the tractor every 50 hours of runtime
@FarmFriend log that we sprayed Field 3 with product X at rate Y today
@FarmFriend why isn't the scheduler running?
@FarmFriend change the trigger word to @Bob
```

From the main channel, manage your operation:
```
@FarmFriend list all scheduled tasks across groups
@FarmFriend pause the Monday briefing task
@FarmFriend join the Family Chat group

Coding delegation (main/admin only, explicit triggers):
@FarmFriend /coder implement a new feature and run checks
@FarmFriend /coder-plan propose a refactor plan for auth middleware
@FarmFriend use coding agent
@FarmFriend use your coding agent skill
```

Notes:
- Natural-language coding requests do not auto-delegate by default.
- Delegation is explicit via `/coder`, `/coder-plan`, or the exact alias phrases above.
- In main chat, FarmFriend may proactively suggest these delegation triggers when a request looks like substantial software-engineering work.
- Non-main chats cannot trigger coder delegation.
- Telegram slash commands are available from the bot command menu (`/help`, `/status`, `/id` globally; admin commands in main chat only).
- Telegram admin quick actions are available via `/panel` with inline buttons.
- Telegram uploads (images, docs, voice, audio, video, stickers) are stored in `groups/<group>/inbox/telegram/` and surfaced to the agent as `/workspace/group/inbox/telegram/...` paths.

## It Reads Its Own Docs

Unlike traditional software that comes with a manual you never read, FFT_nano knows how it works. Ask it:

- "How do I add a new scheduled task?"
- "What files control the trigger word?"
- "Why did the container fail to start?"
- "Show me the security model"

It reads the documentation and explains it in context. You don't need to learn the codebase - just ask.

## It Debugged Itself

When something breaks, you don't guess. You ask:

- "What's in the logs?"
- "Why did the container exit with code 1?"
- "Is the scheduler running?"
- "What changed in the last hour?"

FFT_nano reads its own logs, checks its own state, and tells you what's wrong. Often it can fix it too.

## Built for Real Farms

- **Small enough to understand** - One process, a few source files
- **Secure by design** - Agents run in isolated containers
- **Runs anywhere** - Raspberry Pi, Mac, Linux server
- **Your data stays yours** - SQLite locally, no cloud dependencies
- **No vendor lock-in** - Fork it, own it, change it

## How It Thinks

FFT_nano runs a single Node.js process that:
1. Receives messages from Telegram or WhatsApp
2. Stores everything in SQLite
3. Spins up an isolated Linux container for the AI agent
4. Returns the response to your phone

The agent runs inside a real container with only the files you allow mounted. Secure by default.

## Core Philosophy

**Small enough to understand.** No microservices, no queues, no abstraction layers you can't see.

**Secure by isolation.** Agents run in containers. They only see what you mount. Bash is safe because it runs inside the container.

**Customization = conversation.** No configuration files to learn. Just tell FFT_nano what you want.

**AI-native operations.** No monitoring dashboard needed. Ask FarmFriend what's happening.

## Customizing

There are no configuration files to learn. Change behavior by asking:

- "Remember in the future to make responses shorter"
- "Add a custom greeting when I say good morning"
- "Log conversation summaries weekly"
- "Change the trigger word to @Bob"

The codebase is small enough that the agent can read, understand, and modify it. You're not fighting software - you're directing it.

## Architecture

```
You (Telegram/WhatsApp) --> FFT_nano (Node.js) --> Container (AI Agent) --> Response
                                      |
                                      v
                               SQLite (local storage)
```

Key files:
- `src/index.ts` - Main app: channels, routing, IPC
- `src/container-runner.ts` - Spawns isolated agent containers
- `src/task-scheduler.ts` - Runs scheduled tasks
- `src/db.ts` - SQLite operations
- `groups/*/SOUL.md` - Per-group memory and preferences

## Requirements

- macOS or Linux
- Node.js 20+
- An LLM API key (e.g., Z.AI, OpenAI, Anthropic)
- Apple Container (macOS) or Docker (Linux/RPi)

## Configuration

| Variable | Purpose |
|----------|---------|
| `PI_API` | LLM provider (zai, openai, anthropic) |
| `PI_MODEL` | Model name (glm-4.7, etc.) |
| `ZAI_API_KEY` | Your API key |
| `CONTAINER_RUNTIME` | apple or docker |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_MAIN_CHAT_ID` | Maps Telegram chat to main group |
| `TELEGRAM_ADMIN_SECRET` | Secret to claim admin via /main |
| `TELEGRAM_AUTO_REGISTER` | Auto-register Telegram chats (1/0) |
| `TELEGRAM_MEDIA_MAX_MB` | Max inbound Telegram upload size to persist |
| `FFT_NANO_APPLE_CONTAINER_SELF_HEAL` | Auto-restart Apple Container on transient failures |
| `WHATSAPP_ENABLED` | 1 or 0 |

## FAQ

**Telegram or WhatsApp?**

Telegram: Bot-native, server-friendly, always-on. No phone required.
WhatsApp: Convenient for personal use, uses your phone.

Pick what works for your operation.

**How do I make Telegram my main channel?**

1. Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_SECRET` to `.env`
2. Start FFT_nano
3. Message your bot `/id` then `/main <secret>`
4. Use `/help` for command list and `/panel` for admin shortcuts

**Can I run this on Linux?**

Yes. Install Docker, build with `./container/build-docker.sh`, run with `CONTAINER_RUNTIME=docker`.

**Is this secure?**

Agents run in isolated containers with only mounted directories visible. The small codebase means you can actually review what it does. See [docs/SECURITY.md](docs/SECURITY.md).

**Why no configuration files?**

Configuration files become their own complexity. Here, you customize by changing code. The codebase is small enough that this is safer than managing a dozen config files.

**How do I debug?**

Ask FarmFriend. "Why isn't the scheduler running?" "What's in the logs?" It reads them for you.

**What makes this different from other farm software?**

Most software tells you what you can do. FFT_nano asks what you want, then finds a way to make it happen. It's not a tool you learn - it's a partner you work with.

## License

MIT
