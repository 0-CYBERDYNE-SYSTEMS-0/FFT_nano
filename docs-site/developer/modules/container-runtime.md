# container-runtime

- Source file: src/container-runtime.ts
- Lines: 38
- Responsibility: Selects runtime backend (apple vs docker) and runtime command.

## Exported API

```ts
export type ContainerRuntime = 'apple' | 'docker';
export function getContainerRuntime(): ContainerRuntime {
export function getRuntimeCommand(runtime: ContainerRuntime): string {
```

## Environment Variables Referenced

- CONTAINER_RUNTIME

## Notable Internal Symbols

```ts
function commandExists(cmd: string): boolean {
```
