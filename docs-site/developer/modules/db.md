# db

- Source file: src/db.ts
- Lines: 526
- Responsibility: SQLite initialization, chat/message/task persistence, and transcript FTS search.

## Exported API

```ts
export function initDatabase(): void {
export function initDatabaseAtPath(dbPath: string): void {
export function closeDatabase(): void {
export function storeChatMetadata(
export function updateChatName(chatJid: string, name: string): void {
export interface ChatInfo {
export function getAllChats(): ChatInfo[] {
export function getLastGroupSync(): string | null {
export function setLastGroupSync(): void {
export function storeTextMessage(input: {
export function storeMessage(
export function getNewMessages(
export function getMessagesSince(
export function createTask(
export function getTaskById(id: string): ScheduledTask | undefined {
export function getTasksForGroup(groupFolder: string): ScheduledTask[] {
export function getAllTasks(): ScheduledTask[] {
export function updateTask(
export function deleteTask(id: string): void {
export function getDueTasks(): ScheduledTask[] {
export function updateTaskAfterRun(
export function logTaskRun(log: TaskRunLog): void {
export function getTaskRunLogs(taskId: string, limit = 10): TaskRunLog[] {
export interface TranscriptSearchRow {
export function searchMessagesByFts(
```

## Environment Variables Referenced

None in this module.

## Notable Internal Symbols

```ts
function buildFtsQuery(raw: string): string {
```
