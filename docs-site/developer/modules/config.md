# config

- Source file: src/config.ts
- Lines: 132
- Responsibility: Centralized runtime config defaults, env parsing, and trigger pattern composition.

## Exported API

```ts
export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'FarmFriend';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;
export const MOUNT_ALLOWLIST_PATH = path.join(
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';
export const MAIN_WORKSPACE_DIR = path.resolve(
export const FARM_STATE_ENABLED = envFlag(process.env.FARM_STATE_ENABLED, false);
export const FARM_MODE = (process.env.FARM_MODE || 'demo').trim().toLowerCase();
export const FARM_STATE_DIR = path.resolve(DATA_DIR, 'farm-state');
export const FARM_PROFILE_PATH = path.resolve(
export const FARM_STATE_FAST_MS = envInt(
export const FARM_STATE_MEDIUM_MS = envInt(
export const FARM_STATE_SLOW_MS = envInt(
export const HA_URL = process.env.HA_URL || 'http://localhost:8123';
export const HA_TOKEN = process.env.HA_TOKEN || '';
export const FFT_DASHBOARD_REPO_PATH = process.env.FFT_DASHBOARD_REPO_PATH || '';
export const CONTAINER_IMAGE =
export const CONTAINER_TIMEOUT = parseInt(
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
export const IPC_POLL_INTERVAL = 1000;
export const TELEGRAM_MEDIA_MAX_MB = Math.max(
export const MEMORY_RETRIEVAL_GATE_ENABLED = envFlag(
export const MEMORY_TOP_K = envInt(process.env.MEMORY_TOP_K, 8, 1, 32);
export const MEMORY_CONTEXT_CHAR_BUDGET = envInt(
export const ASSISTANT_TRIGGER_ALIASES = Array.from(
export const TRIGGER_PATTERN = new RegExp(
export const TIMEZONE =
```

## Environment Variables Referenced

- ASSISTANT_ALIASES
- ASSISTANT_NAME
- CONTAINER_IMAGE
- CONTAINER_MAX_OUTPUT_SIZE
- CONTAINER_TIMEOUT
- FARM_MODE
- FARM_PROFILE_PATH
- FARM_STATE_ENABLED
- FARM_STATE_FAST_MS
- FARM_STATE_MEDIUM_MS
- FARM_STATE_SLOW_MS
- FFT_DASHBOARD_REPO_PATH
- FFT_NANO_MAIN_WORKSPACE_DIR
- HA_TOKEN
- HA_URL
- HOME
- MEMORY_CONTEXT_CHAR_BUDGET
- MEMORY_RETRIEVAL_GATE_ENABLED
- MEMORY_TOP_K
- TELEGRAM_MEDIA_MAX_MB
- TZ

## Notable Internal Symbols

```ts
function expandHomePath(input: string): string {
function envFlag(value: string | undefined, defaultValue: boolean): boolean {
function envInt(
function escapeRegex(str: string): string {
```
