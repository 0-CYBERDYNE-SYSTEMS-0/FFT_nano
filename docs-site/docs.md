# FFT_nano Documentation

> **AI Agent Note:** This document is optimized for token-efficient extraction. All essential information is in plain text blocks.

## Project Overview

**FFT_nano** (FarmFriend Terminal nano) is a secure, containerized AI farm assistant that runs as a single Node.js process and routes chat I/O through Telegram and/or WhatsApp.

- **Repository:** https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano
- **Version:** 1.0.1
- **License:** MIT
- **Languages:** TypeScript, Node.js

---

## 🤖 The Agent Advantage

FFT_nano is a **living instruction manual**. Once your agent has:

1. A **primary LLM provider** (OpenAI, Anthropic, Ollama, etc.)
2. **Web access** (via curl, browser automation)

It can sign up for services, configure integrations, and build on top of FFT_nano by itself. You're the farmer; your agent is the farmhand.

**Philosophy:** Most setup tasks—signing up for providers, configuring integrations, debugging—your agent can handle. You give it a goal, it figures out the how.

---

## Quickstart

```bash
# 1. Clone
git clone https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano.git
cd FFT_nano

# 2. Bootstrap
./scripts/setup.sh

# 3. Configure .env (see Credentials section)

# 4. Auth WhatsApp (if using)
npm run auth

# 5. Start
./scripts/start.sh dev
```

---

## ⚠️ Important Things to Know

FFT_nano is powerful AI technology. A few things to keep in mind:

- **Your agent is helpful, not infallible** — always review major decisions
- **API keys cost money** — keep an eye on usage, especially with paid providers
- **The agent can only work with what it can see** — if something's not working, check what folders it has access to
- **Scheduled tasks run automatically** — make sure you know what's scheduled

---

## 🔑 Credentials & API Keys

> **🔐 Security:** Never share your API keys in public. Your keys live in `.env`—keep that file private. If your agent helps configure things, stay in the conversation.

### Required

| Credential | How to Get | Env Variable |
|------------|------------|--------------|
| Telegram Bot Token | @BotFather on Telegram | `TELEGRAM_BOT_TOKEN` |
| LLM Provider API Key | See providers below | See providers below |

### Optional

| Credential | How to Get | Env Variable |
|------------|------------|--------------|
| WhatsApp | `npm run auth` (QR scan) | `WHATSAPP_ENABLED=true` |
| Vision Model | LM Studio / Ollama | `VISION_PROVIDER`, `LMSTUDIO_VISION_MODEL` |
| Brave Search | brave.com/search/api | `BRAVE_API_KEY` |
| Tavily | tavily.com | `TAVILY_API_KEY` |
| Perplexity | perplexity.ai/pro | `PERPLEXITY_API_KEY` |
| xAI (Grok) | x.ai | `XAI_API_KEY` |

---

## Telegram Setup

1. **Create Bot:** Message @BotFather → `/newbot` → follow prompts → copy token
2. **Configure:**
   ```
   TELEGRAM_BOT_TOKEN=your_token_here
   TELEGRAM_ADMIN_SECRET=your_secure_secret
   ```
3. **Claim Main:** DM bot → send `/main your_secure_secret`

---

## WhatsApp Setup

1. Run `npm run auth`
2. Scan QR with WhatsApp → Settings → Linked Devices
3. Set `WHATSAPP_ENABLED=true` in `.env`

---

## LLM Providers

> **💰 About Provider Costs:** Most LLM providers charge by usage (per-token). Check your provider's pricing. Local options like Ollama and LM Studio run on your machine but need a capable computer.

### OpenAI

```
OPENAI_API_KEY=sk-...
PRIMARY_PROVIDER=openai
OPENAI_MODEL=gpt-4o
```
Signup: https://platform.openai.com/signup

### Anthropic (Claude)

```
ANTHROPIC_API_KEY=sk-ant-...
PRIMARY_PROVIDER=anthropic
```
Signup: https://www.anthropic.com/api

### OpenRouter (200+ models)

```
OPENROUTER_API_KEY=sk-or-...
PRIMARY_PROVIDER=openrouter
```
Signup: https://openrouter.ai

### Ollama (Local)

```
PRIMARY_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
```
Install: https://ollama.com

### LM Studio (Local + Vision)

```
PRIMARY_PROVIDER=lmstudio
LMSTUDIO_BASE_URL=http://localhost:1234/v1
LMSTUDIO_MODEL=lmstudio-community/llama3.2-vision
LMSTUDIO_VISION_MODEL=llama3.2-vision
```
Install: https://lmstudio.ai

---

## Vision Models

```
VISION_PROVIDER=lmstudio
LMSTUDIO_VISION_MODEL=llama3.2-vision
```

Or with Ollama:
```
VISION_PROVIDER=ollama
OLLAMA_VISION_MODEL=llama3.2-vision
```

---

## Search Tools

### Brave Search
```
BRAVE_API_KEY=your_key
```
Get: https://brave.com/search/api/

### Tavily
```
TAVILY_API_KEY=your_key
```
Get: https://tavily.com

### Perplexity
```
PERPLEXITY_API_KEY=your_key
```
Get: https://www.perplexity.ai/pro

### xAI (Grok)
```
XAI_API_KEY=your_key
```
Get: https://x.ai

---

## Skills System

### Skill Types

| Type | Location | Description |
|------|----------|-------------|
| Setup | `skills/setup/` | Bootstrap/install guidance |
| Runtime | `skills/runtime/` | Mirrored into container on each run |
| User | `~/nano/skills/` | Main workspace skills (admin only) |

### Built-in Skills

- `fft-setup` — Setup and configuration
- `fft-debug` — Debugging and diagnostics
- `fft-farm-bootstrap` — Farm mode selection, prerequisite checks
- `fft-farm-onboarding` — Production entity discovery
- `fft-farm-validate` — Readiness checks
- `fft-farm-ops` — Farm operations

### Validate Skills

```bash
npm run validate:skills
```

---

## Memory System

- **Per-group:** `groups/<group>/SOUL.md` + `groups/<group>/memory/*.md`
- **Global:** `groups/global/SOUL.md` (read by all, write from main only)
- **Session:** Each group maintains a conversation session persisted by Pi

> **📝 Privacy Note:** Your agent remembers conversations. If you discuss sensitive info, it stays in your local `groups/` folders. Nothing goes to external servers except via your LLM provider.

---

## Scheduling

Users can schedule recurring or one-time tasks. Tasks run as full agents in their group's context.

- **Cron:** e.g., `0 6 * * *` (daily at 6am)
- **Intervals:** e.g., every 30 minutes
- **One-time:** ISO timestamp

Task runs logged to SQLite with duration and result.

> **⏰ Scheduling Awareness:** Each scheduled task uses API calls (may cost money). If you schedule every 5 minutes, that adds up. Start with less frequent schedules.

---

## Container Isolation

Agents run inside:
- **macOS:** Apple Container
- **Linux:** Docker

Each invocation spawns a container with mounted directories. Bash access is safe—commands run inside the container, not on your host.

> **🛡️ What This Means for You:** Your agent runs in an isolated sandbox. It can only see files you explicitly give it access to. Even if something goes wrong, your main computer stays protected.
> 
> **👨‍🌾 Farmer Note:** This is designed so you can let your agent work autonomously without worrying it'll accidentally delete your photos or mess up your system.

---

## Architecture

| Component | Purpose |
|-----------|---------|
| `src/index.ts` | Main router, message handling |
| `src/whatsapp/` | WhatsApp Baileys integration |
| `src/telegram/` | Telegram Bot API |
| `src/scheduler/` | Cron-style task scheduling |
| `container/` | Container build definitions |
| `skills/` | Agent skill definitions |

~22K lines of TypeScript—small enough for your agent to read and understand.

---

## Contributing

FFT_nano is product-focused. Contributions should:

- Preserve security model (container isolation + minimal mounts)
- Stay understandable (prefer direct code over framework layers)
- Include threat-model notes for new integrations

**Accepted:** bug fixes, security fixes, farm-assistant features, docs updates

**Avoid:** "platform/framework" work without user value

### Local Checks

```bash
npm run validate:skills
npm run typecheck
npm test
```

---

## Release Process

### Pre-Release

```bash
npm ci
npm run release-check
```

### Cut Release

1. Bump version in `package.json`
2. Commit
3. Tag: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
4. Push: `git push origin main && git push origin vX.Y.Z`
5. Generate SHA256s: `./scripts/release/generate-sha256s.sh vX.Y.Z`
6. Create GitHub Release

---

## Environment Variables Reference

```
# Required
TELEGRAM_BOT_TOKEN=           # From @BotFather
PRIMARY_PROVIDER=             # openai, anthropic, ollama, lmstudio, openrouter

# Provider Keys
OPENAI_API_KEY=               # sk-...
ANTHROPIC_API_KEY=            # sk-ant-...
OPENROUTER_API_KEY=           # sk-or-...
XAI_API_KEY=

# Provider URLs/Models
OPENAI_MODEL=gpt-4o
ANTHROPIC_MODEL=claude-sonnet-4-20250514
OPENROUTER_MODEL=google/gemini-2.0-flash-exp
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
LMSTUDIO_BASE_URL=http://localhost:1234/v1
LMSTUDIO_MODEL=llama3.2-vision

# Vision
VISION_PROVIDER=lmstudio      # or ollama
LMSTUDIO_VISION_MODEL=llama3.2-vision
OLLAMA_VISION_MODEL=llama3.2-vision

# Search
BRAVE_API_KEY=
TAVILY_API_KEY=
PERPLEXITY_API_KEY=

# Chat Platforms
TELEGRAM_ADMIN_SECRET=        # For claiming main channel
WHATSAPP_ENABLED=true

# Paths
FFT_NANO_MAIN_WORKSPACE_DIR=~/nano
ASSISTANT_NAME=FarmFriend     # Trigger word
```

---

## Links

- Releases: https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano/releases
- Security Policy: https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano/blob/main/.github/SECURITY.md
- Contributing: https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano/blob/main/CONTRIBUTING.md
- Changelog: https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano/blob/main/CHANGELOG.md

---

*Your agent can help you with all of this. Once configured with a primary provider and web access, just ask: "Help me set up Claude" or "I need to add search tools."*
