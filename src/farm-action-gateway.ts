import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

import YAML, { parseDocument } from 'yaml';
import { z } from 'zod';

import {
  FARM_MODE,
  FARM_PROFILE_PATH,
  FARM_STATE_DIR,
  FFT_DASHBOARD_REPO_PATH,
} from './config.js';
import { HomeAssistantAdapter } from './home-assistant.js';
import { logger } from './logger.js';
import type {
  CanvasCard,
  CanvasPatchOp,
  CanvasSpec,
  DashboardPatchOp,
  FarmActionRequest,
  FarmActionResult,
} from './types.js';

const execFileAsync = promisify(execFile);

const DEFAULT_STAGING_DASHBOARD_PATH = '/workspace/dashboard/ui-lovelace-staging.yaml';
const DEFAULT_LIVE_DASHBOARD_PATH = '/workspace/dashboard/ui-lovelace.yaml';
const DEFAULT_CANVAS_SPEC_PATH = '/workspace/dashboard/www/agent-canvas-spec.json';
const DEFAULT_CANVAS_TITLE = 'Agent Canvas';

type JsonObject = Record<string, unknown>;

type DashboardDocumentShape = JsonObject & {
  views?: unknown;
  theme?: unknown;
};

interface CardContainerRef {
  cards: unknown[];
  sectionIndex?: number;
}

interface CardLocation extends CardContainerRef {
  index: number;
  card: JsonObject;
}

const actionRequestSchema = z.object({
  type: z.literal('farm_action'),
  action: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  requestId: z.string().min(1),
});

const lovelaceViewSchema = z.record(z.string(), z.unknown());
const cardPayloadSchema = z.object({ id: z.string().min(1) }).passthrough();
const looseObjectSchema = z.record(z.string(), z.unknown());

const dashboardPatchOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_view'),
    view: lovelaceViewSchema,
    index: z.number().int().min(0).optional(),
  }),
  z.object({
    op: z.literal('update_view'),
    viewPath: z.string().min(1),
    patch: looseObjectSchema,
  }),
  z.object({
    op: z.literal('remove_view'),
    viewPath: z.string().min(1),
  }),
  z.object({
    op: z.literal('add_card'),
    viewPath: z.string().min(1),
    card: cardPayloadSchema,
    sectionIndex: z.number().int().min(0).optional(),
    index: z.number().int().min(0).optional(),
  }),
  z.object({
    op: z.literal('update_card'),
    viewPath: z.string().min(1),
    cardId: z.string().min(1),
    patch: looseObjectSchema,
  }),
  z.object({
    op: z.literal('remove_card'),
    viewPath: z.string().min(1),
    cardId: z.string().min(1),
  }),
  z.object({
    op: z.literal('move_card'),
    viewPath: z.string().min(1),
    cardId: z.string().min(1),
    toIndex: z.number().int().min(0),
    toSectionIndex: z.number().int().min(0).optional(),
  }),
  z.object({
    op: z.literal('set_theme'),
    theme: z.string().min(1),
  }),
]);

const canvasLayoutSchema = z.object({
  columns: z.number().int().min(1).max(12),
  gap: z.number().int().min(0).max(200),
  rowHeight: z.number().int().min(80).max(2000),
});

const canvasCardSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['line', 'bar', 'radial', 'comparison', 'kpi', 'markdown', 'iframe']),
  title: z.string().optional(),
  entities: z.array(z.string().min(1)).optional(),
  labels: z.array(z.string()).optional(),
  span: z.number().int().min(1).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});

const canvasSpecSchema = z.object({
  version: z.literal('1.0'),
  title: z.string().min(1),
  layout: canvasLayoutSchema,
  cards: z.array(canvasCardSchema),
});

const canvasPatchOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_card'),
    card: canvasCardSchema,
    index: z.number().int().min(0).optional(),
  }),
  z.object({
    op: z.literal('update_card'),
    cardId: z.string().min(1),
    patch: canvasCardSchema.partial(),
  }),
  z.object({
    op: z.literal('remove_card'),
    cardId: z.string().min(1),
  }),
  z.object({
    op: z.literal('move_card'),
    cardId: z.string().min(1),
    toIndex: z.number().int().min(0),
  }),
  z.object({
    op: z.literal('set_layout'),
    layout: canvasLayoutSchema.partial(),
  }),
  z.object({
    op: z.literal('set_title'),
    title: z.string().min(1),
  }),
]);

const haDashboardGetParamsSchema = z.object({
  dashboardFile: z.string().optional(),
  viewPath: z.string().optional(),
});

const haDashboardValidateParamsSchema = z
  .object({
    dashboardFile: z.string().optional(),
    content: z.string().optional(),
    checkEntities: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const hasDashboardFile = typeof value.dashboardFile === 'string' && value.dashboardFile.trim().length > 0;
    const hasContent = typeof value.content === 'string';
    if (hasDashboardFile === hasContent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one of dashboardFile or content',
      });
    }
  });

const haDashboardPatchParamsSchema = z.object({
  dashboardFile: z.string().optional(),
  operations: z.array(dashboardPatchOpSchema).min(1),
  dryRun: z.boolean().optional(),
});

const haApplyDashboardParamsSchema = z.object({
  stagingFile: z.string().min(1),
  targetFile: z.string().optional(),
  backup: z.boolean().optional(),
});

const haCaptureScreenshotParamsSchema = z.object({
  view: z.string().optional(),
  dashboard: z.string().optional(),
  zoom: z.number().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  waitMs: z.number().int().min(0).optional(),
  selector: z.string().optional(),
});

const haCanvasGetSpecParamsSchema = z.object({
  specFile: z.string().optional(),
});

const haCanvasSetSpecParamsSchema = z.object({
  specFile: z.string().optional(),
  spec: canvasSpecSchema,
  title: z.string().optional(),
});

const haCanvasPatchSpecParamsSchema = z.object({
  specFile: z.string().optional(),
  operations: z.array(canvasPatchOpSchema).min(1),
});

const allowedActions = new Set([
  'ha_get_status',
  'ha_call_service',
  'ha_set_entity',
  'ha_restart',
  'ha_apply_dashboard',
  'ha_capture_screenshot',
  'ha_dashboard_get',
  'ha_dashboard_patch',
  'ha_dashboard_validate',
  'ha_canvas_get_spec',
  'ha_canvas_set_spec',
  'ha_canvas_patch_spec',
  'farm_state_refresh',
]);

const adapter = new HomeAssistantAdapter();

const controlActions = new Set([
  'ha_call_service',
  'ha_set_entity',
  'ha_restart',
  'ha_apply_dashboard',
  'ha_dashboard_patch',
  'ha_canvas_set_spec',
  'ha_canvas_patch_spec',
]);

function appendAudit(record: Record<string, unknown>): void {
  fs.mkdirSync(FARM_STATE_DIR, { recursive: true });
  const auditFile = path.join(FARM_STATE_DIR, 'audit.ndjson');
  fs.appendFileSync(auditFile, `${JSON.stringify(record)}\n`);
}

function ensureMainChatOnly(isMain: boolean, action: string): void {
  if (!isMain) {
    throw new Error(
      `Action "${action}" rejected: farm actions are main-chat-only in this deployment`,
    );
  }
}

function ensureAllowedAction(action: string): void {
  if (!allowedActions.has(action)) {
    throw new Error(`Action "${action}" is not allowlisted`);
  }
}

function ensureControlActionGate(action: string): void {
  if (!controlActions.has(action)) return;
  if (FARM_MODE !== 'production') return;

  if (!fs.existsSync(FARM_PROFILE_PATH)) {
    throw new Error(
      `Action "${action}" blocked: production mode requires validated farm profile at ${FARM_PROFILE_PATH}`,
    );
  }

  const raw = fs.readFileSync(FARM_PROFILE_PATH, 'utf-8');
  let profile: unknown;
  try {
    profile = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Action "${action}" blocked: farm profile is not valid JSON (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const validation = (profile as { validation?: { status?: string } }).validation;
  if (validation?.status !== 'pass') {
    throw new Error(
      `Action "${action}" blocked: production validation status is "${validation?.status || 'missing'}"; run farm-validate first`,
    );
  }
}

function getHaConfigDir(): string {
  const haConfigDir = path.join(FFT_DASHBOARD_REPO_PATH, 'ha_config');
  if (!FFT_DASHBOARD_REPO_PATH || !fs.existsSync(haConfigDir)) {
    throw new Error(
      'FFT_DASHBOARD_REPO_PATH/ha_config is not available on host for dashboard actions',
    );
  }
  return path.resolve(haConfigDir);
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveDashboardPath(
  inputPath: string | undefined,
  defaultWorkspacePath: string,
  fieldName: string,
): string {
  const haConfigDir = getHaConfigDir();
  const normalizedInput = (inputPath || defaultWorkspacePath).trim();
  if (!normalizedInput) {
    throw new Error(`${fieldName} is required`);
  }

  let resolvedPath: string;
  if (normalizedInput.startsWith('/workspace/dashboard/')) {
    resolvedPath = path.join(
      haConfigDir,
      normalizedInput.slice('/workspace/dashboard/'.length),
    );
  } else if (path.isAbsolute(normalizedInput)) {
    resolvedPath = normalizedInput;
  } else {
    resolvedPath = path.join(haConfigDir, normalizedInput);
  }

  const safeResolved = path.resolve(resolvedPath);
  if (!isWithinRoot(haConfigDir, safeResolved)) {
    throw new Error(`${fieldName} resolves outside ha_config; refusing operation`);
  }

  return safeResolved;
}

function resolveCanvasSpecPath(specFile?: string): string {
  return resolveDashboardPath(specFile, DEFAULT_CANVAS_SPEC_PATH, 'specFile');
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseDashboardYaml(content: string): DashboardDocumentShape {
  const parsed = parseDocument(content);
  if (parsed.errors.length > 0) {
    throw new Error(
      `Dashboard YAML parse failed: ${parsed.errors[0]?.message || 'unknown error'}`,
    );
  }

  const js = parsed.toJS();
  if (!isJsonObject(js)) {
    throw new Error('Dashboard YAML root must be an object');
  }

  return js as DashboardDocumentShape;
}

function readDashboardFile(dashboardPath: string): DashboardDocumentShape {
  if (!fs.existsSync(dashboardPath)) {
    throw new Error(`Dashboard file not found: ${dashboardPath}`);
  }
  const content = fs.readFileSync(dashboardPath, 'utf-8');
  return parseDashboardYaml(content);
}

function writeDashboardFile(dashboardPath: string, dashboard: DashboardDocumentShape): void {
  fs.mkdirSync(path.dirname(dashboardPath), { recursive: true });
  fs.writeFileSync(dashboardPath, YAML.stringify(dashboard), 'utf-8');
}

function ensureViewsArray(dashboard: DashboardDocumentShape): unknown[] {
  if (!Array.isArray(dashboard.views)) {
    dashboard.views = [];
  }
  return dashboard.views as unknown[];
}

function getViewByPath(dashboard: DashboardDocumentShape, viewPath: string): JsonObject {
  const views = ensureViewsArray(dashboard);
  const view = views.find(
    (candidate) =>
      isJsonObject(candidate) &&
      typeof candidate.path === 'string' &&
      candidate.path === viewPath,
  );
  if (!isJsonObject(view)) {
    throw new Error(`View not found for path: ${viewPath}`);
  }
  return view;
}

function normalizeInsertIndex(index: number | undefined, length: number): number {
  if (index === undefined) return length;
  if (!Number.isInteger(index) || index < 0 || index > length) {
    throw new Error(`Index ${index} is out of bounds for length ${length}`);
  }
  return index;
}

function getCardContainers(view: JsonObject): CardContainerRef[] {
  const containers: CardContainerRef[] = [];

  if (Array.isArray(view.cards)) {
    containers.push({ cards: view.cards as unknown[] });
  }

  if (Array.isArray(view.sections)) {
    view.sections.forEach((section, idx) => {
      if (isJsonObject(section) && Array.isArray(section.cards)) {
        containers.push({ cards: section.cards as unknown[], sectionIndex: idx });
      }
    });
  }

  return containers;
}

function getOrCreateCardContainer(
  view: JsonObject,
  sectionIndex: number | undefined,
): CardContainerRef {
  const hasSections = Array.isArray(view.sections);

  if (hasSections) {
    const sections = view.sections as unknown[];
    const targetSectionIndex = sectionIndex ?? 0;
    if (!Number.isInteger(targetSectionIndex) || targetSectionIndex < 0 || targetSectionIndex >= sections.length) {
      throw new Error(`sectionIndex ${targetSectionIndex} is out of bounds for view sections`);
    }

    const section = sections[targetSectionIndex];
    if (!isJsonObject(section)) {
      throw new Error(`Section at index ${targetSectionIndex} is not an object`);
    }
    if (!Array.isArray(section.cards)) {
      section.cards = [];
    }
    return { cards: section.cards as unknown[], sectionIndex: targetSectionIndex };
  }

  if (sectionIndex !== undefined) {
    throw new Error('sectionIndex is only valid for views that use sections');
  }

  if (!Array.isArray(view.cards)) {
    view.cards = [];
  }

  return { cards: view.cards as unknown[] };
}

function findCardInView(view: JsonObject, cardId: string): CardLocation {
  const matches: CardLocation[] = [];

  for (const container of getCardContainers(view)) {
    container.cards.forEach((card, idx) => {
      if (isJsonObject(card) && card.id === cardId) {
        matches.push({
          cards: container.cards,
          sectionIndex: container.sectionIndex,
          index: idx,
          card,
        });
      }
    });
  }

  if (matches.length === 0) {
    throw new Error(`Card id "${cardId}" not found in view`);
  }
  if (matches.length > 1) {
    throw new Error(`Card id "${cardId}" appears multiple times in view; ids must be unique`);
  }

  return matches[0];
}

function ensureCardIdUniqueInView(view: JsonObject, cardId: string): void {
  const duplicateFound = getCardContainers(view).some((container) =>
    container.cards.some((card) => isJsonObject(card) && card.id === cardId),
  );
  if (duplicateFound) {
    throw new Error(`Card id "${cardId}" already exists in view`);
  }
}

function applyDashboardPatch(
  dashboard: DashboardDocumentShape,
  operation: DashboardPatchOp,
): void {
  switch (operation.op) {
    case 'set_theme': {
      dashboard.theme = operation.theme;
      return;
    }
    case 'add_view': {
      const views = ensureViewsArray(dashboard);
      const insertAt = normalizeInsertIndex(operation.index, views.length);
      views.splice(insertAt, 0, operation.view);
      return;
    }
    case 'update_view': {
      const view = getViewByPath(dashboard, operation.viewPath);
      Object.assign(view, operation.patch);
      return;
    }
    case 'remove_view': {
      const views = ensureViewsArray(dashboard);
      const idx = views.findIndex(
        (candidate) =>
          isJsonObject(candidate) &&
          typeof candidate.path === 'string' &&
          candidate.path === operation.viewPath,
      );
      if (idx === -1) {
        throw new Error(`View not found for path: ${operation.viewPath}`);
      }
      views.splice(idx, 1);
      return;
    }
    case 'add_card': {
      const view = getViewByPath(dashboard, operation.viewPath);
      const cardId = operation.card.id;
      if (typeof cardId !== 'string' || cardId.trim().length === 0) {
        throw new Error('add_card requires card.id (string)');
      }
      ensureCardIdUniqueInView(view, cardId);
      const target = getOrCreateCardContainer(view, operation.sectionIndex);
      const insertAt = normalizeInsertIndex(operation.index, target.cards.length);
      target.cards.splice(insertAt, 0, operation.card);
      return;
    }
    case 'update_card': {
      const view = getViewByPath(dashboard, operation.viewPath);
      const located = findCardInView(view, operation.cardId);
      const nextCard = { ...located.card, ...operation.patch };
      if (typeof nextCard.id !== 'string' || nextCard.id.trim().length === 0) {
        throw new Error('Card patch must preserve a non-empty id');
      }
      if (nextCard.id !== operation.cardId) {
        ensureCardIdUniqueInView(view, nextCard.id);
      }
      located.cards[located.index] = nextCard;
      return;
    }
    case 'remove_card': {
      const view = getViewByPath(dashboard, operation.viewPath);
      const located = findCardInView(view, operation.cardId);
      located.cards.splice(located.index, 1);
      return;
    }
    case 'move_card': {
      const view = getViewByPath(dashboard, operation.viewPath);
      const located = findCardInView(view, operation.cardId);
      const [card] = located.cards.splice(located.index, 1);
      const destination =
        operation.toSectionIndex === undefined
          ? located
          : getOrCreateCardContainer(view, operation.toSectionIndex);
      let insertAt = normalizeInsertIndex(operation.toIndex, destination.cards.length);
      if (destination.cards === located.cards && located.index < insertAt) {
        insertAt -= 1;
      }
      destination.cards.splice(insertAt, 0, card);
      return;
    }
    default:
      return;
  }
}

function looksLikeEntityId(value: string): boolean {
  return /^[a-z0-9_]+\.[a-z0-9_]+$/i.test(value);
}

function collectEntityIds(value: unknown, set: Set<string>, parentKey?: string): void {
  if (typeof value === 'string') {
    if ((parentKey === 'entity' || parentKey === 'entity_id') && looksLikeEntityId(value)) {
      set.add(value);
    }
    if (parentKey === 'entities' && looksLikeEntityId(value)) {
      set.add(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectEntityIds(item, set, parentKey);
    }
    return;
  }

  if (!isJsonObject(value)) return;

  for (const [key, entry] of Object.entries(value)) {
    collectEntityIds(entry, set, key);
  }
}

function readCanvasSpec(specPath: string): CanvasSpec {
  if (!fs.existsSync(specPath)) {
    throw new Error(`Canvas spec file not found: ${specPath}`);
  }
  const raw = fs.readFileSync(specPath, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  return canvasSpecSchema.parse(parsed) as CanvasSpec;
}

function writeCanvasSpec(specPath: string, spec: CanvasSpec): void {
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf-8');
}

function findCanvasCardIndex(spec: CanvasSpec, cardId: string): number {
  return spec.cards.findIndex((card) => card.id === cardId);
}

function applyCanvasPatch(spec: CanvasSpec, operation: CanvasPatchOp): void {
  switch (operation.op) {
    case 'add_card': {
      if (spec.cards.some((card) => card.id === operation.card.id)) {
        throw new Error(`Canvas card id "${operation.card.id}" already exists`);
      }
      const insertAt = normalizeInsertIndex(operation.index, spec.cards.length);
      spec.cards.splice(insertAt, 0, operation.card);
      return;
    }
    case 'update_card': {
      const idx = findCanvasCardIndex(spec, operation.cardId);
      if (idx === -1) {
        throw new Error(`Canvas card id "${operation.cardId}" not found`);
      }
      const nextCard = { ...spec.cards[idx], ...operation.patch };
      if (typeof nextCard.id !== 'string' || nextCard.id.trim().length === 0) {
        throw new Error('Canvas card patch must preserve a non-empty id');
      }
      if (
        nextCard.id !== operation.cardId &&
        spec.cards.some((card, cardIdx) => card.id === nextCard.id && cardIdx !== idx)
      ) {
        throw new Error(`Canvas card id "${nextCard.id}" already exists`);
      }
      spec.cards[idx] = nextCard;
      return;
    }
    case 'remove_card': {
      const idx = findCanvasCardIndex(spec, operation.cardId);
      if (idx === -1) {
        throw new Error(`Canvas card id "${operation.cardId}" not found`);
      }
      spec.cards.splice(idx, 1);
      return;
    }
    case 'move_card': {
      const idx = findCanvasCardIndex(spec, operation.cardId);
      if (idx === -1) {
        throw new Error(`Canvas card id "${operation.cardId}" not found`);
      }
      const [card] = spec.cards.splice(idx, 1);
      let insertAt = normalizeInsertIndex(operation.toIndex, spec.cards.length);
      if (idx < insertAt) {
        insertAt -= 1;
      }
      spec.cards.splice(insertAt, 0, card);
      return;
    }
    case 'set_layout': {
      spec.layout = {
        ...spec.layout,
        ...operation.layout,
      };
      return;
    }
    case 'set_title': {
      spec.title = operation.title;
      return;
    }
    default:
      return;
  }
}

async function handleHaGetStatus(): Promise<unknown> {
  const states = await adapter.getAllStates();
  return {
    timestamp: new Date().toISOString(),
    entityCount: states.length,
    entities: states,
  };
}

async function handleHaCallService(params: Record<string, unknown>): Promise<unknown> {
  const domain = params.domain;
  const service = params.service;

  if (typeof domain !== 'string' || !domain) {
    throw new Error('ha_call_service requires params.domain (string)');
  }
  if (typeof service !== 'string' || !service) {
    throw new Error('ha_call_service requires params.service (string)');
  }

  const data =
    params.data && typeof params.data === 'object' && !Array.isArray(params.data)
      ? (params.data as Record<string, unknown>)
      : {};

  return adapter.callService(domain, service, data);
}

async function handleHaSetEntity(params: Record<string, unknown>): Promise<unknown> {
  const entityId = params.entityId;
  if (typeof entityId !== 'string' || !entityId.includes('.')) {
    throw new Error('ha_set_entity requires params.entityId (domain.entity)');
  }

  const value = params.value;
  const domain = entityId.split('.')[0];

  if (!['input_number', 'input_boolean', 'switch'].includes(domain)) {
    throw new Error(
      `ha_set_entity only supports input_number/input_boolean/switch (got ${domain})`,
    );
  }

  if (domain === 'input_number') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error('ha_set_entity for input_number requires numeric value');
    }
    return adapter.callService('input_number', 'set_value', {
      entity_id: entityId,
      value: parsed,
    });
  }

  const boolValue =
    value === true || value === 'on' || value === 1 || value === '1' || value === 'true';

  return adapter.callService(domain, boolValue ? 'turn_on' : 'turn_off', {
    entity_id: entityId,
  });
}

async function handleHaRestart(): Promise<unknown> {
  const { stdout, stderr } = await execFileAsync('docker', ['restart', 'homeassistant']);
  return {
    exitCode: 0,
    stdout: (stdout || '').toString().trim(),
    stderr: (stderr || '').toString().trim(),
  };
}

async function handleHaDashboardGet(params: Record<string, unknown>): Promise<unknown> {
  const parsed = haDashboardGetParamsSchema.parse(params);
  const dashboardPath = resolveDashboardPath(
    parsed.dashboardFile,
    DEFAULT_STAGING_DASHBOARD_PATH,
    'dashboardFile',
  );
  const dashboard = readDashboardFile(dashboardPath);

  if (parsed.viewPath) {
    const view = getViewByPath(dashboard, parsed.viewPath);
    return {
      dashboardFile: dashboardPath,
      viewPath: parsed.viewPath,
      view,
    };
  }

  return {
    dashboardFile: dashboardPath,
    dashboard,
  };
}

async function handleHaDashboardValidate(params: Record<string, unknown>): Promise<unknown> {
  const parsed = haDashboardValidateParamsSchema.parse(params);

  let dashboard: DashboardDocumentShape;
  let source: string;
  if (parsed.dashboardFile) {
    const dashboardPath = resolveDashboardPath(
      parsed.dashboardFile,
      DEFAULT_STAGING_DASHBOARD_PATH,
      'dashboardFile',
    );
    source = dashboardPath;
    dashboard = readDashboardFile(dashboardPath);
  } else {
    source = 'inline-content';
    dashboard = parseDashboardYaml(parsed.content || '');
  }

  const views = dashboard.views;
  if (!Array.isArray(views)) {
    throw new Error('Dashboard validation failed: top-level "views" must be an array');
  }

  const entityIds = new Set<string>();
  collectEntityIds(dashboard, entityIds);

  let missingEntities: string[] = [];
  if (parsed.checkEntities) {
    const states = await adapter.getAllStates();
    const known = new Set(states.map((state) => state.entity_id));
    missingEntities = Array.from(entityIds).filter((entityId) => !known.has(entityId));
  }

  return {
    valid: missingEntities.length === 0,
    source,
    viewCount: views.length,
    discoveredEntityCount: entityIds.size,
    checkedEntities: parsed.checkEntities === true,
    missingEntities,
  };
}

async function handleHaDashboardPatch(params: Record<string, unknown>): Promise<unknown> {
  const parsed = haDashboardPatchParamsSchema.parse(params);
  const dashboardPath = resolveDashboardPath(
    parsed.dashboardFile,
    DEFAULT_STAGING_DASHBOARD_PATH,
    'dashboardFile',
  );

  const dashboard = readDashboardFile(dashboardPath);
  const operations = parsed.operations as DashboardPatchOp[];
  for (const operation of operations) {
    applyDashboardPatch(dashboard, operation);
  }

  if (!parsed.dryRun) {
    writeDashboardFile(dashboardPath, dashboard);
  }

  return {
    dashboardFile: dashboardPath,
    dryRun: parsed.dryRun === true,
    operationsApplied: operations.length,
    viewCount: Array.isArray(dashboard.views) ? dashboard.views.length : 0,
    dashboard: parsed.dryRun ? dashboard : undefined,
  };
}

async function handleHaApplyDashboard(params: Record<string, unknown>): Promise<unknown> {
  const parsed = haApplyDashboardParamsSchema.parse(params);
  const stagingPath = resolveDashboardPath(parsed.stagingFile, '', 'stagingFile');

  if (!fs.existsSync(stagingPath)) {
    throw new Error(`Staging file not found: ${stagingPath}`);
  }

  const content = fs.readFileSync(stagingPath, 'utf-8');
  parseDashboardYaml(content);

  const livePath = resolveDashboardPath(
    parsed.targetFile,
    DEFAULT_LIVE_DASHBOARD_PATH,
    'targetFile',
  );
  const backupEnabled = parsed.backup !== false;
  const backupPath = `${livePath}.bak`;

  fs.mkdirSync(path.dirname(livePath), { recursive: true });
  if (backupEnabled && fs.existsSync(livePath)) {
    fs.copyFileSync(livePath, backupPath);
  }
  fs.copyFileSync(stagingPath, livePath);

  return {
    stagingFile: stagingPath,
    targetFile: livePath,
    backupEnabled,
    backupFile: backupEnabled && fs.existsSync(backupPath) ? backupPath : null,
  };
}

function resolveScreenshotUrl(view: unknown, dashboard: unknown): string {
  const base = adapter.getActiveBaseUrl().replace(/\/$/, '');
  const normalizedView = typeof view === 'string' && view.trim().length > 0 ? view.trim() : '';
  const normalizedDashboard =
    typeof dashboard === 'string' && dashboard.trim().length > 0
      ? dashboard.trim().replace(/^\/+|\/+$/g, '')
      : '';

  if (normalizedView) {
    if (/^https?:\/\//i.test(normalizedView)) return normalizedView;
    if (normalizedView.startsWith('/')) return `${base}${normalizedView}`;
    if (normalizedDashboard) {
      return `${base}/${normalizedDashboard}/${normalizedView}`;
    }
    return `${base}/lovelace/${normalizedView}`;
  }

  if (normalizedDashboard) {
    return `${base}/${normalizedDashboard}`;
  }

  return `${base}/lovelace/0`;
}

async function handleHaCaptureScreenshot(params: Record<string, unknown>): Promise<unknown> {
  const parsed = haCaptureScreenshotParamsSchema.parse(params);

  const screenshotsDir = path.join(FARM_STATE_DIR, 'screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `dashboard-${timestamp}.png`;
  const outputPath = path.join(screenshotsDir, fileName);

  const url = resolveScreenshotUrl(parsed.view, parsed.dashboard);
  const zoom = parsed.zoom ?? 1;
  const width = parsed.width ?? 1920;
  const height = parsed.height ?? 1080;
  const waitMs = parsed.waitMs ?? 1200;
  const selectorArg = parsed.selector && parsed.selector.trim() ? parsed.selector.trim() : '__none__';

  const script = `
    (async () => {
      const { chromium } = await import('playwright');
      const url = process.argv[1];
      const outputPath = process.argv[2];
      const zoom = Number(process.argv[3]) || 1;
      const width = Number(process.argv[4]) || 1920;
      const height = Number(process.argv[5]) || 1080;
      const waitMs = Number(process.argv[6]) || 1200;
      const selector = process.argv[7];

      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width, height } });
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
        if (selector && selector !== '__none__') {
          await page.waitForSelector(selector, { timeout: Math.max(waitMs, 1000) });
        }
        if (zoom !== 1) {
          await page.evaluate((z) => {
            document.documentElement.style.zoom = String(z);
          }, zoom);
        }
        if (waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
        await page.screenshot({ path: outputPath, fullPage: true });
      } finally {
        await page.close();
        await browser.close();
      }
    })().catch((err) => {
      console.error(err?.stack || String(err));
      process.exit(1);
    });
  `;

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      '-e',
      script,
      url,
      outputPath,
      String(zoom),
      String(width),
      String(height),
      String(waitMs),
      selectorArg,
    ]);

    return {
      screenshotPath: outputPath,
      view: parsed.view,
      dashboard: parsed.dashboard,
      resolvedUrl: url,
      width,
      height,
      zoom,
      waitMs,
      selector: parsed.selector,
      stdout: (stdout || '').toString().trim() || undefined,
      stderr: (stderr || '').toString().trim() || undefined,
    };
  } catch (err) {
    const detail = err as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    const stderr = (detail.stderr || '').toString();
    const stdout = (detail.stdout || '').toString();
    throw new Error(
      `Screenshot capture failed. Ensure playwright is installed and HA is reachable. ${
        detail.message || ''
      } ${stderr || stdout}`.trim(),
    );
  }
}

async function handleHaCanvasGetSpec(params: Record<string, unknown>): Promise<unknown> {
  const parsed = haCanvasGetSpecParamsSchema.parse(params);
  const specPath = resolveCanvasSpecPath(parsed.specFile);
  const spec = readCanvasSpec(specPath);

  return {
    specFile: specPath,
    spec,
  };
}

async function handleHaCanvasSetSpec(params: Record<string, unknown>): Promise<unknown> {
  const parsed = haCanvasSetSpecParamsSchema.parse(params);
  const specPath = resolveCanvasSpecPath(parsed.specFile);

  const nextSpec: CanvasSpec = {
    ...parsed.spec,
    title: parsed.title && parsed.title.trim().length > 0 ? parsed.title.trim() : parsed.spec.title,
  };

  const validated = canvasSpecSchema.parse(nextSpec) as CanvasSpec;
  writeCanvasSpec(specPath, validated);

  return {
    specFile: specPath,
    spec: validated,
  };
}

async function handleHaCanvasPatchSpec(params: Record<string, unknown>): Promise<unknown> {
  const parsed = haCanvasPatchSpecParamsSchema.parse(params);
  const specPath = resolveCanvasSpecPath(parsed.specFile);
  const spec = readCanvasSpec(specPath);

  const operations = parsed.operations as CanvasPatchOp[];
  for (const operation of operations) {
    applyCanvasPatch(spec, operation);
  }

  const validated = canvasSpecSchema.parse(spec) as CanvasSpec;
  writeCanvasSpec(specPath, validated);

  return {
    specFile: specPath,
    operationsApplied: operations.length,
    spec: validated,
  };
}

async function handleFarmStateRefresh(): Promise<unknown> {
  const states = await adapter.getAllStates();
  return {
    timestamp: new Date().toISOString(),
    entityCount: states.length,
  };
}

export async function executeFarmAction(
  request: FarmActionRequest,
  isMain: boolean,
): Promise<FarmActionResult> {
  const executedAt = new Date().toISOString();

  try {
    const parsed = actionRequestSchema.parse(request);
    ensureAllowedAction(parsed.action);
    ensureMainChatOnly(isMain, parsed.action);
    ensureControlActionGate(parsed.action);

    let result: unknown;
    switch (parsed.action) {
      case 'ha_get_status':
        result = await handleHaGetStatus();
        break;
      case 'ha_call_service':
        result = await handleHaCallService(parsed.params);
        break;
      case 'ha_set_entity':
        result = await handleHaSetEntity(parsed.params);
        break;
      case 'ha_restart':
        result = await handleHaRestart();
        break;
      case 'ha_apply_dashboard':
        result = await handleHaApplyDashboard(parsed.params);
        break;
      case 'ha_capture_screenshot':
        result = await handleHaCaptureScreenshot(parsed.params);
        break;
      case 'ha_dashboard_get':
        result = await handleHaDashboardGet(parsed.params);
        break;
      case 'ha_dashboard_patch':
        result = await handleHaDashboardPatch(parsed.params);
        break;
      case 'ha_dashboard_validate':
        result = await handleHaDashboardValidate(parsed.params);
        break;
      case 'ha_canvas_get_spec':
        result = await handleHaCanvasGetSpec(parsed.params);
        break;
      case 'ha_canvas_set_spec':
        result = await handleHaCanvasSetSpec(parsed.params);
        break;
      case 'ha_canvas_patch_spec':
        result = await handleHaCanvasPatchSpec(parsed.params);
        break;
      case 'farm_state_refresh':
        result = await handleFarmStateRefresh();
        break;
      default:
        throw new Error(`Unsupported action: ${parsed.action}`);
    }

    const successResult: FarmActionResult = {
      requestId: parsed.requestId,
      status: 'success',
      result,
      executedAt,
    };

    appendAudit({
      timestamp: executedAt,
      requestId: parsed.requestId,
      action: parsed.action,
      status: successResult.status,
      isMain,
      result,
    });

    return successResult;
  } catch (err) {
    const parsedRequestId =
      request && typeof request.requestId === 'string' ? request.requestId : 'unknown';

    const errorResult: FarmActionResult = {
      requestId: parsedRequestId,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      executedAt,
    };

    appendAudit({
      timestamp: executedAt,
      requestId: parsedRequestId,
      action: request?.action,
      status: errorResult.status,
      isMain,
      error: errorResult.error,
    });

    logger.warn(
      { requestId: parsedRequestId, action: request?.action, isMain, err },
      'Farm action execution failed',
    );

    return errorResult;
  }
}
