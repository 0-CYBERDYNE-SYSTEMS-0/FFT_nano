<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="FFT_nano" width="400">
</p>

<p align="center">
  FarmFriendTerminal_nano (FFT_nano): a secure, containerized AI assistant for farmers.
</p>

## What This Is

FFT_nano is a fork/evolution of NanoClaw: a minimal, security-first “AI agent in a container” runtime.

The goal here is to turn that foundation into a **paradigm-shifting agricultural assistant** that:
- Works for farmers of all sizes (solo → enterprise)
- Runs *locally where it counts* (edge devices like Raspberry Pi) and *online where it helps*
- Is usable from a phone (WhatsApp and/or Telegram)
- Is proactive (scheduled tasks + event-driven workflows), not just reactive prompting
- Has long-term memory that feels like “Jarvis”: context-aware, quietly helpful, low-friction

The codebase stays intentionally small: one Node process + one containerized agent runner.

## Quick Start

```bash
git clone <your-fft_nano-fork>
cd fft_nano

npm install
./container/build.sh        # macOS (Apple Container)
# or ./container/build-docker.sh  # Linux/RPi

# If using WhatsApp:
npm run auth

npm run dev
```

Then configure your runtime, build the agent image, and start the service.

## Core Principles

**Small enough to understand.** One process, a few source files. No microservices, no message queues, no abstraction layers.

**Secure by isolation.** Agents run in Linux containers (Apple Container on macOS, or Docker). They can only see what's explicitly mounted. Bash access is safe because commands run inside the container, not on your host.

**Built for one user (or one farm).** Fork it and tailor it.

**Customization = code changes.** No configuration sprawl. Want different behavior? Modify the code. The codebase is small enough that this is safe.

**AI-native.** No monitoring dashboard; ask FarmFriend what's happening. Debug by asking it to read logs and state.

**Security by isolation.** The agent runs inside an actual Linux container (Apple Container on macOS; Docker on Linux/RPi). It can only see what you mount.

**Minimal harness, real isolation.** The agent runs inside a real Linux container and can write/read code and memory files in its workspace.

## What It Supports

- **WhatsApp I/O** - Message from your phone (via Baileys / WhatsApp Web)
- **Telegram I/O (optional)** - Bot-based I/O for simpler, server-friendly deployments
- **Isolated group context** - Each group has its own `CLAUDE.md` memory, isolated filesystem, and runs in its own container sandbox with only that filesystem mounted
- **Main channel** - Your private channel (self-chat) for admin control; every other group is completely isolated
- **Scheduled tasks** - Recurring jobs that run FarmFriend and can message you back
- **Web access** - Use bash (curl) and browser automation
- **Container isolation** - Agents sandboxed in Apple Container (macOS) or Docker (Linux/RPi)

## Usage

Talk to your assistant with the trigger word (default: `@FarmFriend`):

```
@FarmFriend create a weekly fieldwork plan for the next 7 days (weather-aware)
@FarmFriend remind me to service the tractor every 50 hours of runtime
@FarmFriend log that we sprayed Field 3 with product X at rate Y today
```

From the main channel (your self-chat), you can manage groups and tasks:
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

FFT_nano is intentionally a “fork-that-becomes-a-product”. Keep changes security-first and easy to reason about.

### Roadmap

- WhatsApp Business API channel (scale/robustness)
- Farm ledger (fields, operations, inventory, equipment)
- Event-driven proactivity (alerts + digests)
- Optional on-farm sensor ingestion (MQTT)

## Requirements

- macOS or Linux
- Node.js 20+
- An LLM API key usable by `pi` (pi-coding-agent)
- [Apple Container](https://github.com/apple/container) (macOS) or [Docker](https://docker.com/products/docker-desktop) (macOS/Linux)

## Configuration

- `PI_BASE_URL`: optional; if set, also treated as `OPENAI_BASE_URL` for OpenAI-compatible endpoints
- `PI_API_KEY`: optional; passed to `pi` via `--api-key`
- `PI_MODEL`: optional; passed to `pi` via `--model`
- `PI_API`: optional; passed to `pi` via `--provider` (e.g. `openai`, `anthropic`, `google`)
- `CONTAINER_RUNTIME`: `auto` (default), `apple`, or `docker`
- `WHATSAPP_ENABLED`: `1` (default) or `0`
- `TELEGRAM_BOT_TOKEN`: enables Telegram
- `TELEGRAM_MAIN_CHAT_ID`: optional; maps a Telegram chat to the `main` group folder
- `TELEGRAM_ADMIN_SECRET`: required to claim the main/admin chat via Telegram command `/main <secret>`
- `TELEGRAM_AUTO_REGISTER`: `1` (default) or `0`

Build the agent container image:

```bash
./build.sh                  # Apple Container (macOS)
./build-docker.sh           # Docker (Linux/RPi)
# (or run the scripts directly under ./container/)
```

Smoke test without an LLM (container only):

- Set `FFT_NANO_DRY_RUN=1` on the host (so it gets mounted into the container via `.env`/env allowlist)
- Send any message; the agent runner will return a deterministic `DRY_RUN:` response

## Architecture

```
Channels (WhatsApp / Telegram) --> SQLite --> Polling loop --> Container (Pi agent runtime) --> Response
```

Single Node.js process. Agents execute in isolated Linux containers with mounted directories. IPC via filesystem. No daemons, no queues, no complexity.

Key files:
- `src/index.ts` - Main app: WhatsApp connection, routing, IPC
- `src/container-runner.ts` - Spawns agent containers
- `src/task-scheduler.ts` - Runs scheduled tasks
- `src/db.ts` - SQLite operations
- `groups/*/CLAUDE.md` - Per-group memory

## FAQ

**WhatsApp vs Telegram?**

WhatsApp is convenient when you want to talk from your personal account; Telegram is bot-native and often easier to deploy on servers/edge devices. FFT_nano supports WhatsApp and has optional Telegram support.

**How do I make Telegram my main/admin channel?**

1. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_SECRET` in the host environment
2. Start FFT_nano
3. DM your bot:
   - `/id` to see your chat id
   - `/main <secret>` to claim this DM as the `main` channel (persists in `data/registered_groups.json`)

**Why Apple Container instead of Docker?**

On macOS, Apple Container is lightweight and fast. On Linux/RPi, Docker is the default. You can force either with `CONTAINER_RUNTIME`.

**Can I run this on Linux?**

Yes. Install Docker, build the agent image with `./container/build-docker.sh`, and run FFT_nano with `CONTAINER_RUNTIME=docker`.

**Is this secure?**

Agents run in containers, not behind application-level permission checks. They can only access explicitly mounted directories. You should still review what you're running, but the codebase is small enough that you actually can. See [docs/SECURITY.md](docs/SECURITY.md) for the full security model.

**Why no configuration files?**

We don't want configuration sprawl. Every user should customize it so that the code matches exactly what they want rather than configuring a generic system.

**How do I debug issues?**

Ask FarmFriend. "Why isn't the scheduler running?" "What's in the recent logs?" "Why did this message not get a response?" That's the AI-native approach.

**Why isn't it working?**

Check logs, then ask FarmFriend to diagnose.

**What changes will be accepted into the codebase?**

Security fixes, bug fixes, and changes that advance the FarmFriend mission while keeping the system understandable.

## License

MIT
