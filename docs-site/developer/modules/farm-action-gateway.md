# farm-action-gateway

- Source file: src/farm-action-gateway.ts
- Lines: 406
- Responsibility: Validates and executes allowlisted farm actions with main/production gates.

## Exported API

```ts
export async function executeFarmAction(
```

## Environment Variables Referenced

None in this module.

## Notable Internal Symbols

```ts
function appendAudit(record: Record<string, unknown>): void {
function ensureMainChatOnly(isMain: boolean, action: string): void {
function ensureAllowedAction(action: string): void {
function ensureControlActionGate(action: string): void {
function toHostDashboardPath(inputPath: string): string {
async function handleHaGetStatus(): Promise<unknown> {
async function handleHaCallService(params: Record<string, unknown>): Promise<unknown> {
async function handleHaSetEntity(params: Record<string, unknown>): Promise<unknown> {
async function handleHaRestart(): Promise<unknown> {
async function handleHaApplyDashboard(params: Record<string, unknown>): Promise<unknown> {
function resolveScreenshotUrl(view: unknown): string {
async function handleHaCaptureScreenshot(params: Record<string, unknown>): Promise<unknown> {
async function handleFarmStateRefresh(): Promise<unknown> {
```
