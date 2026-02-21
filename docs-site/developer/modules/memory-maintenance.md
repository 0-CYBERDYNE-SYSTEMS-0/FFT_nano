# memory-maintenance

- Source file: src/memory-maintenance.ts
- Lines: 118
- Responsibility: Compaction migration and MEMORY.md append helpers.

## Exported API

```ts
export interface CompactionMigrationResult {
export function migrateCompactionSectionsFromSoul(
export function migrateCompactionsForGroup(groupFolder: string): CompactionMigrationResult {
export function appendCompactionSummaryToMemory(
```

## Environment Variables Referenced

None in this module.

## Notable Internal Symbols

```ts
function splitCompactionSections(content: string): {
```
