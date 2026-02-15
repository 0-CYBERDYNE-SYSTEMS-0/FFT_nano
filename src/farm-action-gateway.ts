import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

import { parseDocument } from 'yaml';
import { z } from 'zod';

import {
  FARM_MODE,
  FARM_PROFILE_PATH,
  FARM_STATE_DIR,
  FFT_DASHBOARD_REPO_PATH,
  HA_URL,
} from './config.js';
import { HomeAssistantAdapter } from './home-assistant.js';
import { logger } from './logger.js';
import type { FarmActionRequest, FarmActionResult } from './types.js';

const execFileAsync = promisify(execFile);

const actionRequestSchema = z.object({
  type: z.literal('farm_action'),
  action: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  requestId: z.string().min(1),
});

const allowedActions = new Set([
  'ha_get_status',
  'ha_call_service',
  'ha_set_entity',
  'ha_restart',
  'ha_apply_dashboard',
  'ha_capture_screenshot',
  'farm_state_refresh',
]);

const adapter = new HomeAssistantAdapter();
const controlActions = new Set([
  'ha_call_service',
  'ha_set_entity',
  'ha_restart',
  'ha_apply_dashboard',
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

function toHostDashboardPath(inputPath: string): string {
  const normalizedInput = inputPath.trim();
  if (!normalizedInput) {
    throw new Error('stagingFile is required');
  }

  const haConfigDir = path.join(FFT_DASHBOARD_REPO_PATH, 'ha_config');
  if (!FFT_DASHBOARD_REPO_PATH || !fs.existsSync(haConfigDir)) {
    throw new Error(
      'FFT_DASHBOARD_REPO_PATH/ha_config is not available on host for dashboard apply',
    );
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

  const safeRoot = path.resolve(haConfigDir);
  const safeResolved = path.resolve(resolvedPath);
  if (!safeResolved.startsWith(safeRoot)) {
    throw new Error('stagingFile resolves outside ha_config; refusing apply');
  }

  return safeResolved;
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

async function handleHaApplyDashboard(params: Record<string, unknown>): Promise<unknown> {
  const stagingFile = params.stagingFile;
  if (typeof stagingFile !== 'string') {
    throw new Error('ha_apply_dashboard requires params.stagingFile');
  }

  const stagingPath = toHostDashboardPath(stagingFile);
  if (!fs.existsSync(stagingPath)) {
    throw new Error(`Staging file not found: ${stagingPath}`);
  }

  const content = fs.readFileSync(stagingPath, 'utf-8');
  const parsed = parseDocument(content);
  if (parsed.errors.length > 0) {
    throw new Error(`Dashboard YAML parse failed: ${parsed.errors[0]?.message || 'unknown error'}`);
  }

  const livePath = path.join(FFT_DASHBOARD_REPO_PATH, 'ha_config', 'ui-lovelace.yaml');
  const backupPath = `${livePath}.bak`;

  if (fs.existsSync(livePath)) {
    fs.copyFileSync(livePath, backupPath);
  }
  fs.copyFileSync(stagingPath, livePath);

  return {
    stagingFile: stagingPath,
    liveFile: livePath,
    backupFile: fs.existsSync(backupPath) ? backupPath : null,
  };
}

function resolveScreenshotUrl(view: unknown): string {
  const base = HA_URL.replace(/\/$/, '');
  if (typeof view !== 'string' || !view.trim()) {
    return `${base}/lovelace/0`;
  }

  const trimmed = view.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return `${base}${trimmed}`;
  return `${base}/lovelace/${trimmed}`;
}

async function handleHaCaptureScreenshot(params: Record<string, unknown>): Promise<unknown> {
  const screenshotsDir = path.join(FARM_STATE_DIR, 'screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `dashboard-${timestamp}.png`;
  const outputPath = path.join(screenshotsDir, fileName);

  const url = resolveScreenshotUrl(params.view);
  const zoomRaw = Number(params.zoom);
  const zoom = Number.isFinite(zoomRaw) && zoomRaw > 0 ? zoomRaw : 1;

  const script = `
    (async () => {
      const { chromium } = await import('playwright');
      const url = process.argv[1];
      const outputPath = process.argv[2];
      const zoom = Number(process.argv[3]) || 1;

      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
        if (zoom !== 1) {
          await page.evaluate((z) => {
            document.documentElement.style.zoom = String(z);
          }, zoom);
          await new Promise((resolve) => setTimeout(resolve, 500));
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
    ]);

    return {
      screenshotPath: outputPath,
      view: url,
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
