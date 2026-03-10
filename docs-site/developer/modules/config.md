# config

- Source file: `src/config.ts`
- Responsibility: centralized runtime defaults, env parsing/normalization, trigger pattern composition, and profile-aware defaults.

## Key Exports (abbreviated)

```ts
export const ASSISTANT_NAME: string;
export const STORE_DIR: string;
export const GROUPS_DIR: string;
export const DATA_DIR: string;
export const MAIN_GROUP_FOLDER = 'main';
export const MAIN_WORKSPACE_DIR: string;

export const CONTAINER_IMAGE: string;
export const CONTAINER_TIMEOUT: number;
export const IDLE_TIMEOUT: number;
export const CONTAINER_MAX_OUTPUT_SIZE: number;

export const FFT_NANO_WEB_ACCESS_MODE: 'localhost' | 'lan' | 'remote';
export const FFT_NANO_WEB_ENABLED: boolean;
export const FFT_NANO_WEB_PORT: number;
export const FFT_NANO_WEB_HOST: string;

export const FFT_NANO_TUI_ENABLED: boolean;
export const FFT_NANO_TUI_PORT: number;
export const FFT_NANO_TUI_HOST: string;

export const ASSISTANT_TRIGGER_ALIASES: string[];
export const TRIGGER_PATTERN: RegExp;
```

## Important Defaults

- `ASSISTANT_NAME` default is profile-aware:
  - `OpenClaw` in `core`
  - `FarmFriend` in `farm`
- `MAIN_WORKSPACE_DIR`: `~/nano` (expandable via `FFT_NANO_MAIN_WORKSPACE_DIR`)
- `CONTAINER_IMAGE`: `fft-nano-agent:latest`
- `CONTAINER_TIMEOUT`: `21600000` (6h)
- `IDLE_TIMEOUT`: defaults to `CONTAINER_TIMEOUT` (6h baseline)
- `TELEGRAM_MEDIA_MAX_MB`: default `20`

## Environment Variable Families

- identity + trigger: `ASSISTANT_NAME`, `ASSISTANT_ALIASES`
- runtime/container: `CONTAINER_*`, `FFT_NANO_ALLOW_HOST_RUNTIME*`
- web+tui surfaces: `FFT_NANO_WEB_*`, `FFT_NANO_TUI_*`
- farm bridge: `FARM_*`, `HA_*`, `FFT_DASHBOARD_REPO_PATH`
- memory retrieval: `MEMORY_*`
- timezone: `TZ`

## Internal Helpers

```ts
function envFlag(...): boolean;
function envInt(...): number;
function parseWebAccessMode(...): 'localhost' | 'lan' | 'remote';
function parseHaUrlCandidates(...): string[];
```
