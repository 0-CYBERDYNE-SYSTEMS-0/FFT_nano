# singleton-lock

- Source file: src/singleton-lock.ts
- Lines: 94
- Responsibility: Singleton lock acquisition and stale lock cleanup.

## Exported API

```ts
export function acquireSingletonLock(lockPath: string): void {
```

## Environment Variables Referenced

None in this module.

## Notable Internal Symbols

```ts
function pidIsAlive(pid: number): boolean {
```
