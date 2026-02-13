import fs from 'fs';
import path from 'path';

import {
  FARM_STATE_DIR,
  FARM_STATE_FAST_MS,
  FARM_STATE_MEDIUM_MS,
  FARM_STATE_SLOW_MS,
} from './config.js';
import { HomeAssistantAdapter, type CalendarEvent, type HAEntity } from './home-assistant.js';
import { logger } from './logger.js';

type AlertSeverity = 'info' | 'warning' | 'critical';

interface DerivedAlert {
  id: string;
  severity: AlertSeverity;
  since: string;
  entity: string;
  message: string;
}

interface FarmContext {
  timeOfDay: 'night' | 'morning' | 'afternoon' | 'evening';
  season: 'winter' | 'spring' | 'summer' | 'fall';
  weatherCondition: string;
  alertLevel: 'normal' | 'warning' | 'critical';
  suggestedTheme:
    | 'dawn'
    | 'midday'
    | 'dusk'
    | 'night'
    | 'storm'
    | 'frost'
    | 'harvest';
}

interface CurrentLedger {
  timestamp: string;
  haConnected: boolean;
  stale: boolean;
  lastSuccessfulPoll: string | null;
  entities: Record<string, Pick<HAEntity, 'state' | 'attributes' | 'last_changed'>>;
  alerts: Array<Pick<DerivedAlert, 'id' | 'severity' | 'since' | 'entity'>>;
  context: FarmContext;
}

let running = false;
let stopFns: Array<() => void> = [];
let lastSuccessfulPoll: string | null = null;
let latestEntities: Record<string, HAEntity> = {};
let latestAlerts: DerivedAlert[] = [];
let lastAlertSnapshot = new Map<string, DerivedAlert>();
let activeTelemetryDay: string | null = null;

const adapter = new HomeAssistantAdapter();

function ensureFarmStateDir(): void {
  fs.mkdirSync(FARM_STATE_DIR, { recursive: true });
  fs.mkdirSync(path.join(FARM_STATE_DIR, 'screenshots'), { recursive: true });
}

function atomicWriteJson(filePath: string, payload: unknown): void {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function toEntityMap(entities: HAEntity[]): Record<string, HAEntity> {
  const out: Record<string, HAEntity> = {};
  for (const entity of entities) {
    out[entity.entity_id] = entity;
  }
  return out;
}

function parseNumericState(entity: HAEntity | undefined): number | null {
  if (!entity) return null;
  const parsed = Number.parseFloat(entity.state);
  return Number.isFinite(parsed) ? parsed : null;
}

function findEntitiesByRegex(
  entities: Record<string, HAEntity>,
  pattern: RegExp,
): HAEntity[] {
  return Object.values(entities).filter((entity) => pattern.test(entity.entity_id));
}

function getFirstEntityByRegex(
  entities: Record<string, HAEntity>,
  pattern: RegExp,
): HAEntity | undefined {
  return Object.values(entities).find((entity) => pattern.test(entity.entity_id));
}

function computeAverage(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return Number((sum / values.length).toFixed(2));
}

function inferTimeOfDay(now: Date): FarmContext['timeOfDay'] {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

function inferSeason(now: Date): FarmContext['season'] {
  const month = now.getMonth() + 1;
  if (month === 12 || month <= 2) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'fall';
}

function inferWeatherCondition(entities: Record<string, HAEntity>): string {
  const weatherEntity = getFirstEntityByRegex(entities, /^weather\./i);
  if (weatherEntity?.state) return weatherEntity.state.toLowerCase();

  const sensorEntity = getFirstEntityByRegex(
    entities,
    /^sensor\..*(weather|condition)/i,
  );
  if (sensorEntity?.state) return sensorEntity.state.toLowerCase();

  return 'unknown';
}

function deriveAlerts(
  entities: Record<string, HAEntity>,
  nowIso: string,
): DerivedAlert[] {
  const alerts: DerivedAlert[] = [];

  for (const entity of Object.values(entities)) {
    const entityId = entity.entity_id;
    const state = entity.state.toLowerCase();
    const since = entity.last_changed || nowIso;

    if (/frost/.test(entityId) && ['on', 'true', '1', 'detected'].includes(state)) {
      alerts.push({
        id: 'frost_risk',
        severity: 'warning',
        since,
        entity: entityId,
        message: 'Frost risk detected',
      });
      continue;
    }

    if (
      entityId.startsWith('binary_sensor.') &&
      ['on', 'true', '1', 'detected', 'problem', 'open'].includes(state)
    ) {
      const severity: AlertSeverity =
        /(alarm|fire|critical|smoke|intrusion)/.test(entityId) ? 'critical' : 'warning';
      const id = entityId.replace(/[^a-zA-Z0-9]+/g, '_');
      alerts.push({
        id,
        severity,
        since,
        entity: entityId,
        message: `${entityId} is ${entity.state}`,
      });
      continue;
    }

    if (entityId.includes('soil_moisture')) {
      const moisture = parseNumericState(entity);
      if (moisture !== null && moisture < 20) {
        alerts.push({
          id: `${entityId.replace(/[^a-zA-Z0-9]+/g, '_')}_low`,
          severity: moisture < 12 ? 'critical' : 'warning',
          since,
          entity: entityId,
          message: `Low soil moisture (${moisture})`,
        });
      }
    }
  }

  return alerts;
}

function deriveContext(
  entities: Record<string, HAEntity>,
  alerts: DerivedAlert[],
  now: Date,
): FarmContext {
  const timeOfDay = inferTimeOfDay(now);
  const season = inferSeason(now);
  const weatherCondition = inferWeatherCondition(entities);

  const hasCritical = alerts.some((alert) => alert.severity === 'critical');
  const hasWarning = alerts.some((alert) => alert.severity === 'warning');
  const alertLevel: FarmContext['alertLevel'] = hasCritical
    ? 'critical'
    : hasWarning
      ? 'warning'
      : 'normal';

  let suggestedTheme: FarmContext['suggestedTheme'];
  if (alerts.some((alert) => alert.id === 'frost_risk') || /frost|snow|freez/.test(weatherCondition)) {
    suggestedTheme = 'frost';
  } else if (/(storm|rain|thunder|hail)/.test(weatherCondition) || alertLevel === 'critical') {
    suggestedTheme = 'storm';
  } else if (season === 'fall') {
    suggestedTheme = 'harvest';
  } else if (timeOfDay === 'morning') {
    suggestedTheme = 'dawn';
  } else if (timeOfDay === 'afternoon') {
    suggestedTheme = 'midday';
  } else if (timeOfDay === 'evening') {
    suggestedTheme = 'dusk';
  } else {
    suggestedTheme = 'night';
  }

  return {
    timeOfDay,
    season,
    weatherCondition,
    alertLevel,
    suggestedTheme,
  };
}

function toCurrentLedger(
  entities: Record<string, HAEntity>,
  alerts: DerivedAlert[],
  nowIso: string,
  stale: boolean,
): CurrentLedger {
  const serializedEntities: CurrentLedger['entities'] = {};
  for (const [entityId, entity] of Object.entries(entities)) {
    serializedEntities[entityId] = {
      state: entity.state,
      attributes: entity.attributes || {},
      last_changed: entity.last_changed,
    };
  }

  return {
    timestamp: nowIso,
    haConnected: !stale,
    stale,
    lastSuccessfulPoll,
    entities: serializedEntities,
    alerts: alerts.map((alert) => ({
      id: alert.id,
      severity: alert.severity,
      since: alert.since,
      entity: alert.entity,
    })),
    context: deriveContext(entities, alerts, new Date(nowIso)),
  };
}

function ensureTelemetryFileForDate(now: Date): string {
  const day = now.toISOString().slice(0, 10);
  const activePath = path.join(FARM_STATE_DIR, 'telemetry.ndjson');

  if (activeTelemetryDay && activeTelemetryDay !== day && fs.existsSync(activePath)) {
    const rotatedPath = path.join(FARM_STATE_DIR, `telemetry-${activeTelemetryDay}.ndjson`);
    if (fs.existsSync(rotatedPath)) {
      const existing = fs.readFileSync(activePath, 'utf-8');
      if (existing) {
        fs.appendFileSync(rotatedPath, existing);
      }
      fs.unlinkSync(activePath);
    } else {
      fs.renameSync(activePath, rotatedPath);
    }
  }

  activeTelemetryDay = day;
  return activePath;
}

function appendTelemetry(nowIso: string, entities: Record<string, HAEntity>): void {
  const now = new Date(nowIso);
  const activePath = ensureTelemetryFileForDate(now);

  const soilReadings = findEntitiesByRegex(entities, /soil_moisture/i)
    .map((entity) => parseNumericState(entity))
    .filter((value): value is number => value !== null);

  const solarKw =
    parseNumericState(getFirstEntityByRegex(entities, /sensor\..*(solar|pv).*(kw|power)/i)) ||
    0;
  const batteryPct =
    parseNumericState(getFirstEntityByRegex(entities, /sensor\..*battery.*(pct|percent|level)?/i)) ||
    0;
  const waterTotal =
    parseNumericState(getFirstEntityByRegex(entities, /sensor\..*(water.*total|total.*water)/i)) ||
    0;

  const telemetry = {
    t: nowIso,
    solarKw,
    batteryPct,
    waterTotal,
    soilMoistureAvg: computeAverage(soilReadings),
  };

  fs.appendFileSync(activePath, `${JSON.stringify(telemetry)}\n`);
}

function updateAlertsSnapshot(alerts: DerivedAlert[], nowIso: string): {
  active: Array<Pick<DerivedAlert, 'id' | 'severity' | 'since' | 'message' | 'entity'>>;
  resolved: Array<{ id: string; resolvedAt: string }>;
} {
  const current = new Map<string, DerivedAlert>();
  for (const alert of alerts) {
    current.set(alert.id, alert);
  }

  const resolved: Array<{ id: string; resolvedAt: string }> = [];
  for (const [id] of lastAlertSnapshot.entries()) {
    if (!current.has(id)) {
      resolved.push({ id, resolvedAt: nowIso });
    }
  }

  lastAlertSnapshot = current;

  return {
    active: alerts.map((alert) => ({
      id: alert.id,
      severity: alert.severity,
      since: alert.since,
      message: alert.message,
      entity: alert.entity,
    })),
    resolved,
  };
}

function parseEventDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toClockString(value: string): string {
  const parsed = parseEventDate(value);
  if (!parsed) return value;
  return parsed.toISOString().slice(11, 16);
}

async function writeCurrentSnapshot(stale: boolean): Promise<void> {
  const nowIso = new Date().toISOString();
  const ledger = toCurrentLedger(latestEntities, latestAlerts, nowIso, stale);
  atomicWriteJson(path.join(FARM_STATE_DIR, 'current.json'), ledger);
}

async function runFastLoop(): Promise<void> {
  const nowIso = new Date().toISOString();

  try {
    const states = await adapter.getAllStates();
    latestEntities = toEntityMap(states);
    latestAlerts = deriveAlerts(latestEntities, nowIso);
    lastSuccessfulPoll = nowIso;

    await writeCurrentSnapshot(false);
    appendTelemetry(nowIso, latestEntities);
  } catch (err) {
    logger.warn({ err }, 'Farm state fast collector failed; writing stale snapshot');
    await writeCurrentSnapshot(true);
    throw err;
  }
}

async function runMediumLoop(): Promise<void> {
  const nowIso = new Date().toISOString();

  // Refresh entities if the fast loop has not populated yet.
  if (Object.keys(latestEntities).length === 0) {
    const states = await adapter.getAllStates();
    latestEntities = toEntityMap(states);
    latestAlerts = deriveAlerts(latestEntities, nowIso);
  }

  const snapshot = updateAlertsSnapshot(latestAlerts, nowIso);
  atomicWriteJson(path.join(FARM_STATE_DIR, 'alerts.json'), {
    timestamp: nowIso,
    active: snapshot.active,
    resolved: snapshot.resolved,
  });
}

async function runSlowLoop(): Promise<void> {
  const nowIso = new Date().toISOString();
  const states = await adapter.getAllStates();
  latestEntities = toEntityMap(states);
  latestAlerts = deriveAlerts(latestEntities, nowIso);

  const domains: Record<string, number> = {};
  for (const entity of states) {
    const domain = entity.entity_id.split('.')[0] || 'unknown';
    domains[domain] = (domains[domain] || 0) + 1;
  }

  atomicWriteJson(path.join(FARM_STATE_DIR, 'devices.json'), {
    timestamp: nowIso,
    entities: states.map((entity) => ({
      entity_id: entity.entity_id,
      state: entity.state,
      attributes: entity.attributes || {},
      last_changed: entity.last_changed,
      last_updated: entity.last_updated,
    })),
    entityCount: states.length,
    domains,
  });

  const calendarEntities = states
    .map((entity) => entity.entity_id)
    .filter((entityId) => entityId.startsWith('calendar.'));

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const windowEnd = new Date(todayStart);
  windowEnd.setDate(windowEnd.getDate() + 7);

  const allEvents: CalendarEvent[] = [];
  for (const entityId of calendarEntities) {
    try {
      const events = await adapter.getCalendarEvents(
        entityId,
        todayStart.toISOString(),
        windowEnd.toISOString(),
      );
      allEvents.push(...events);
    } catch (err) {
      logger.warn({ err, entityId }, 'Failed to fetch calendar events');
    }
  }

  const todayKey = todayStart.toISOString().slice(0, 10);
  const today: Array<{
    summary: string;
    start: string;
    end: string;
    description: string;
  }> = [];
  const upcoming: Array<{
    summary: string;
    date: string;
    start: string;
    end: string;
    description: string;
  }> = [];

  for (const event of allEvents) {
    const eventDate = parseEventDate(event.start) || parseEventDate(event.end);
    if (!eventDate) continue;

    const eventDay = eventDate.toISOString().slice(0, 10);
    const summary = event.summary || 'Untitled event';
    const description = event.description || '';

    if (eventDay === todayKey) {
      today.push({
        summary,
        start: toClockString(event.start),
        end: toClockString(event.end),
        description,
      });
    } else if (eventDay > todayKey) {
      upcoming.push({
        summary,
        date: eventDay,
        start: toClockString(event.start),
        end: toClockString(event.end),
        description,
      });
    }
  }

  today.sort((a, b) => a.start.localeCompare(b.start));
  upcoming.sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`));

  atomicWriteJson(path.join(FARM_STATE_DIR, 'calendar.json'), {
    timestamp: nowIso,
    today,
    upcoming,
  });
}

function scheduleLoop(
  loopName: 'fast' | 'medium' | 'slow',
  successIntervalMs: number,
  callback: () => Promise<void>,
): () => void {
  let timer: NodeJS.Timeout | null = null;
  let failureCount = 0;
  let cancelled = false;

  const run = async () => {
    if (!running || cancelled) return;

    let nextDelay = successIntervalMs;
    try {
      await callback();
      failureCount = 0;
    } catch (err) {
      failureCount += 1;
      nextDelay = Math.min(60000, 5000 * 2 ** (failureCount - 1));
      logger.warn({ err, loopName, failureCount, nextDelay }, 'Farm state collector loop error');
    }

    if (!running || cancelled) return;
    timer = setTimeout(run, nextDelay);
  };

  void run();

  return () => {
    cancelled = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

export function startFarmStateCollector(): void {
  if (running) {
    logger.debug('Farm state collector already running');
    return;
  }

  ensureFarmStateDir();
  running = true;

  stopFns = [
    scheduleLoop('fast', FARM_STATE_FAST_MS, runFastLoop),
    scheduleLoop('medium', FARM_STATE_MEDIUM_MS, runMediumLoop),
    scheduleLoop('slow', FARM_STATE_SLOW_MS, runSlowLoop),
  ];

  logger.info(
    {
      fastMs: FARM_STATE_FAST_MS,
      mediumMs: FARM_STATE_MEDIUM_MS,
      slowMs: FARM_STATE_SLOW_MS,
      dir: FARM_STATE_DIR,
    },
    'Farm state collector started',
  );
}

export function stopFarmStateCollector(): void {
  if (!running) return;

  running = false;
  for (const stop of stopFns) {
    stop();
  }
  stopFns = [];

  logger.info('Farm state collector stopped');
}
