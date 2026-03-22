# coding-orchestrator

- Source file: `src/coding-orchestrator.ts`
- Responsibility: host-side lifecycle manager for real coding worker runs, isolated worktrees, and structured worker results.

## Exported API

```ts
export type CodingWorkerRoute =
export interface CodingWorkerRequest {
export interface CodingWorkerResult {
export interface CodingTaskRunResult {
export interface EphemeralWorktree {
export async function createDefaultEphemeralWorktree(params: {
export function createCodingOrchestrator(deps: CodingOrchestratorDeps): {
```

## Environment Variables Referenced

None directly.

## Notable Internal Areas

```ts
function extractCommands(toolExecutions: ContainerOutput['toolExecutions']): string[] {
function extractTestsRun(commands: string[]): string[] {
function buildWorkerPrompt(request: CodingWorkerRequest): string {
function formatFinalMessage(params: {
```

## Notes

- Execute mode creates an isolated git worktree and fails closed if that setup fails.
- Plan mode runs `pi` with read-only tools and no worktree.
- Publishes lifecycle and tool-progress events back to the host event bus.
