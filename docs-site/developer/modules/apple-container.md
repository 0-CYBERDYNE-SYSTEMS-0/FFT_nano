# apple-container

- Source file: src/apple-container.ts
- Lines: 64
- Responsibility: Apple Container self-heal error detection and restart single-flight.

## Exported API

```ts
export function shouldSelfHealAppleContainer(error: string): boolean {
export async function restartAppleContainerSystemSingleFlight(
```

## Environment Variables Referenced

None in this module.

## Notable Internal Symbols

```ts
function sh(cmd: string): void {
```
