# farm-state-collector

- Source file: src/farm-state-collector.ts
- Lines: 568
- Responsibility: Runs periodic HA polling loops and writes farm-state ledgers/telemetry.

## Exported API

```ts
export function startFarmStateCollector(): void {
export function stopFarmStateCollector(): void {
```

## Environment Variables Referenced

None in this module.

## Notable Internal Symbols

```ts
type AlertSeverity = 'info' | 'warning' | 'critical';
interface DerivedAlert {
interface FarmContext {
interface CurrentLedger {
function ensureFarmStateDir(): void {
function atomicWriteJson(filePath: string, payload: unknown): void {
function toEntityMap(entities: HAEntity[]): Record<string, HAEntity> {
function parseNumericState(entity: HAEntity | undefined): number | null {
function findEntitiesByRegex(
function getFirstEntityByRegex(
function computeAverage(values: number[]): number {
function inferTimeOfDay(now: Date): FarmContext['timeOfDay'] {
function inferSeason(now: Date): FarmContext['season'] {
function inferWeatherCondition(entities: Record<string, HAEntity>): string {
function deriveAlerts(
function deriveContext(
function toCurrentLedger(
function ensureTelemetryFileForDate(now: Date): string {
function appendTelemetry(nowIso: string, entities: Record<string, HAEntity>): void {
function updateAlertsSnapshot(alerts: DerivedAlert[], nowIso: string): {
function parseEventDate(value: string): Date | null {
function toClockString(value: string): string {
async function writeCurrentSnapshot(stale: boolean): Promise<void> {
async function runFastLoop(): Promise<void> {
async function runMediumLoop(): Promise<void> {
async function runSlowLoop(): Promise<void> {
function scheduleLoop(
```
