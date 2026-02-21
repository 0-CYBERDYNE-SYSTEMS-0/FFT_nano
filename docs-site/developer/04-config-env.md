# Configuration and Environment Variables

Primary source: `src/config.ts` plus direct env reads in `src/index.ts`, `src/telegram.ts`, and scripts.

## Core Runtime Defaults (`src/config.ts`)

- `ASSISTANT_NAME` default: `FarmFriend`
- `POLL_INTERVAL`: `2000` ms
- `SCHEDULER_POLL_INTERVAL`: `60000` ms
- `MAIN_GROUP_FOLDER`: `main`
- `MAIN_WORKSPACE_DIR`: `~/nano` (expanded)
- `FARM_MODE`: `demo`
- `HA_URL`: `http://localhost:8123`
- `CONTAINER_IMAGE`: `fft-nano-agent:latest`
- `CONTAINER_TIMEOUT`: `300000` ms
- `CONTAINER_MAX_OUTPUT_SIZE`: `10485760` bytes
- `IPC_POLL_INTERVAL`: `1000` ms
- `MEMORY_RETRIEVAL_GATE_ENABLED`: true
- `MEMORY_TOP_K`: `8` (bounded 1..32)
- `MEMORY_CONTEXT_CHAR_BUDGET`: `6000` (bounded 1000..50000)

## Host Runtime Env Vars

### Messaging and identity
- `ASSISTANT_NAME`
- `ASSISTANT_ALIASES`
- `WHATSAPP_ENABLED`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_API_BASE_URL`
- `TELEGRAM_MAIN_CHAT_ID`
- `TELEGRAM_ADMIN_SECRET`
- `TELEGRAM_AUTO_REGISTER`
- `TELEGRAM_MEDIA_MAX_MB`

### Runtime and paths
- `CONTAINER_RUNTIME` (`auto|apple|docker`)
- `CONTAINER_IMAGE`
- `CONTAINER_TIMEOUT`
- `CONTAINER_MAX_OUTPUT_SIZE`
- `FFT_NANO_MAIN_WORKSPACE_DIR`
- `TZ`
- `HOME`

### Reliability/debug
- `LOG_LEVEL`
- `FFT_NANO_APPLE_CONTAINER_SELF_HEAL`
- `FFT_NANO_HEARTBEAT_EVERY`
- `FFT_NANO_HEARTBEAT_PROMPT`

### Memory retrieval
- `MEMORY_RETRIEVAL_GATE_ENABLED`
- `MEMORY_TOP_K`
- `MEMORY_CONTEXT_CHAR_BUDGET`

### Farm integration
- `FARM_STATE_ENABLED`
- `FARM_MODE`
- `FARM_PROFILE_PATH`
- `FARM_STATE_FAST_MS`
- `FARM_STATE_MEDIUM_MS`
- `FARM_STATE_SLOW_MS`
- `HA_URL`
- `HA_TOKEN`
- `FFT_DASHBOARD_REPO_PATH`

### Pi provider hints used for per-chat defaults
- `PI_API`
- `PI_MODEL`

## Telegram Transport Tuning Env Vars (`src/telegram.ts`)

- `FFT_NANO_TELEGRAM_RETRY_ATTEMPTS` (default 4, bounded 1..10)
- `FFT_NANO_TELEGRAM_RETRY_MIN_MS` (default 300)
- `FFT_NANO_TELEGRAM_RETRY_MAX_MS` (default 2500)
- `FFT_NANO_TELEGRAM_TYPING_REFRESH_MS` (default 4000)

## Container Env Allowlist (Host -> Container)

Built in `src/container-runner.ts`:
- `PI_BASE_URL`, `PI_API_KEY`, `PI_MODEL`, `PI_API`
- `OPENAI_API_KEY`, `OPENAI_BASE_URL`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `OPENROUTER_API_KEY`
- `GROQ_API_KEY`
- `ZAI_API_KEY`
- `FFT_NANO_DRY_RUN`
- `HA_URL`, `HA_TOKEN`

Also forced in container env file:
- `HOME=/home/node`
- `PI_CODING_AGENT_DIR=/home/node/.pi/agent`

## Trigger Pattern Construction

`TRIGGER_PATTERN` is built from:
- `ASSISTANT_NAME`
- hardcoded alias `F-15`
- optional comma-separated `ASSISTANT_ALIASES`

Regex form: `^(?:@Alias1\b|@Alias2\b|...)` (case-insensitive).

## Script-Level Variables

Operational scripts additionally consume variables such as:
- `FFT_DASHBOARD_REPO_URL`
- `FFT_DASHBOARD_REPO_REF`

These are primarily used by `scripts/farm-bootstrap.sh` and persisted into `.env`.
