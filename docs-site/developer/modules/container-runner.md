# container-runner

- Source file: src/container-runner.ts
- Lines: 832
- Responsibility: Builds mounts/env/runtime args and runs containerized agent with output parsing.

## Exported API

```ts
export interface ContainerInput {
export interface ContainerOutput {
export async function runContainerAgent(
export function writeTasksSnapshot(
export interface AvailableGroup {
export function writeGroupsSnapshot(
```

## Environment Variables Referenced

- LOG_LEVEL

## Notable Internal Symbols

```ts
interface VolumeMount {
function ensureMainWorkspaceSeed(): void {
function buildVolumeMounts(
function buildContainerArgs(
```
