# coding-delegation

- Source file: src/coding-delegation.ts
- Responsibility: Parses explicit delegation triggers and substantial-coding heuristics for host worker routing.

## Exported API

```ts
export type CodingHint =
export type DelegationTrigger =
export function normalizeDelegationAlias(text: string): string {
export function parseDelegationTrigger(text: string): DelegationParseResult {
export function isSubstantialCodingTask(text: string): boolean {
```

## Environment Variables Referenced

None in this module.

## Notable Internal Symbols

```ts
interface DelegationParseResult {
```
