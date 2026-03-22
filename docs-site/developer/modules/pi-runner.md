# pi-runner

- Source file: `src/pi-runner.ts`
- Responsibility: launch `pi`, assemble prompt/runtime input, stream tool events, and parse structured output.

## Exported API

```ts
export interface ContainerInput {
export interface ContainerOutput {
export interface ContainerRuntimeEvent {
export function normalizeTelegramDraftText(text: string): string {
export function deriveTelegramDraftId(seed: string): number {
export function collectRuntimeSecrets(projectRoot: string): Record<string, string> {
export async function runContainerAgent(
```

## Environment Variables Referenced

- `PI_API`
- `PI_MODEL`
- `PI_BASE_URL`
- `PI_API_KEY`
- `FFT_NANO_DRY_RUN`
- `FFT_NANO_PROMPT_FILE_MAX_CHARS`
- `FFT_NANO_PROMPT_TOTAL_MAX_CHARS`

## Notable Internal Areas

```ts
function resolveWorkspacePaths(
function buildPiArgs(
function appendToolVerboseSection(
```

## Notes

- Supports `toolMode=default|read_only|full`.
- Supports `workspaceDirOverride` for isolated coder workspaces.
- Returns parsed `toolExecutions` so the host orchestrator can report commands and tests.
