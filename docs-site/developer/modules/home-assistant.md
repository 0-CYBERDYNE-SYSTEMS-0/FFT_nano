# home-assistant

- Source file: src/home-assistant.ts
- Lines: 138
- Responsibility: Typed Home Assistant HTTP adapter for states/services/calendar APIs.

## Exported API

```ts
export interface HAEntity {
export interface CalendarEvent {
export class HomeAssistantAdapter {
```

## Environment Variables Referenced

None in this module.

## Notable Internal Symbols

```ts
function normalizeCalendarDate(value: unknown): string {
function ensureTrailingSlashless(value: string): string {
```
