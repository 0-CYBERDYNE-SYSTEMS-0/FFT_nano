# Configuration and Environment Variables

Primary source of truth:
- `src/config.ts`
- direct env reads in `src/index.ts`, `src/telegram.ts`, `src/container-runner.ts`, and scripts

## Core Runtime Defaults (`src/config.ts`)

- `ASSISTANT_NAME` default:
  - `fft_nano` in `core` profile
  - `FarmFriend` in `farm` profile
- `POLL_INTERVAL`: `2000` ms
- `SCHEDULER_POLL_INTERVAL`: `60000` ms
- `MAIN_GROUP_FOLDER`: `main`
- `MAIN_WORKSPACE_DIR`: `~/nano` (expanded)
- `FARM_MODE`: `demo`
- `HA_URL`: `http://localhost:8123`
- `CONTAINER_IMAGE`: `fft-nano-agent:latest`
- `CONTAINER_TIMEOUT`: `21600000` ms (6h)
- `IDLE_TIMEOUT`: defaults to `CONTAINER_TIMEOUT` (6h baseline)
- `CONTAINER_MAX_OUTPUT_SIZE`: `10485760` bytes
- `IPC_POLL_INTERVAL`: `1000` ms
- `MEMORY_RETRIEVAL_GATE_ENABLED`: `true`
- `MEMORY_TOP_K`: `8` (bounded `1..32`)
- `MEMORY_CONTEXT_CHAR_BUDGET`: `6000` (bounded `1000..50000`)

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
- `CONTAINER_RUNTIME` (`auto|docker|host`)
- `FFT_NANO_ALLOW_HOST_RUNTIME`
- `FFT_NANO_ALLOW_HOST_RUNTIME_IN_PROD`
- `CONTAINER_IMAGE`
- `CONTAINER_TIMEOUT`
- `CONTAINER_MAX_OUTPUT_SIZE`
- `IDLE_TIMEOUT`
- `FFT_NANO_MAIN_WORKSPACE_DIR`
- `TZ`
- `HOME`
- `FFT_NANO_DOCKER_REUSE`
- `FFT_NANO_DOCKER_REUSE_MAX_RUNS`
- `FFT_NANO_DOCKER_REUSE_MAX_AGE_MS`
- `FFT_NANO_DOCKER_REUSE_MAX_IDLE_MS`

### TUI and web surfaces
- `FFT_NANO_TUI_ENABLED`
- `FFT_NANO_TUI_HOST`
- `FFT_NANO_TUI_PORT`
- `FFT_NANO_TUI_AUTH_TOKEN`
- `FFT_NANO_WEB_ENABLED`
- `FFT_NANO_WEB_ACCESS_MODE`
- `FFT_NANO_WEB_HOST`
- `FFT_NANO_WEB_PORT`
- `FFT_NANO_WEB_AUTH_TOKEN`

### Reliability/debug
- `LOG_LEVEL`
- `FFT_NANO_DRY_RUN`
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

### Pi provider hints
- `PI_API`
- `PI_MODEL`

## Telegram Transport Tuning (`src/telegram.ts`)

- `FFT_NANO_TELEGRAM_RETRY_ATTEMPTS` (default `4`, bounded `1..10`)
- `FFT_NANO_TELEGRAM_RETRY_MIN_MS` (default `300`)
- `FFT_NANO_TELEGRAM_RETRY_MAX_MS` (default `2500`)
- `FFT_NANO_TELEGRAM_TYPING_REFRESH_MS` (default `4000`)

## Container Env Allowlist (Host -> Runtime)

Allowlisted pass-through in `src/container-runner.ts`:
- `PI_BASE_URL`, `PI_API_KEY`, `PI_MODEL`, `PI_API`
- `OPENAI_API_KEY`, `OPENAI_BASE_URL`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `OPENROUTER_API_KEY`
- `GROQ_API_KEY`
- `ZAI_API_KEY`
- `FFT_NANO_DRY_RUN`
- `HA_URL`, `HA_TOKEN`
- `FFT_NANO_PROMPT_FILE_MAX_CHARS`, `FFT_NANO_PROMPT_TOTAL_MAX_CHARS`

Also injected/normalized by host runtime:
- `TZ`
- `OPENAI_BASE_URL` fallback from `PI_BASE_URL`

## Scheduled Task Timeout Ceiling

- `timeout_seconds` from cron task policy is capped by `FFT_NANO_TASK_TIMEOUT_MAX_SECONDS` (default `86400`, 24h).

## Trigger Pattern Construction

`TRIGGER_PATTERN` is built from `ASSISTANT_TRIGGER_ALIASES`:
- always includes `ASSISTANT_NAME`
- includes default alias `F-15` only in `farm` profile
- includes any `ASSISTANT_ALIASES` from env

Regex form: `^(?:@Alias1\b|@Alias2\b|...)` (case-insensitive).
