import { randomBytes } from 'crypto';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { DATA_DIR, MAIN_GROUP_FOLDER } from './config.js';
import { resolvePiExecutable } from './pi-executable.js';
import { parsePiListModelsResult } from './pi-models.js';
import { ensureOpenCodeGoModels } from './opencode-go-models.js';
import { ensureLocalProviderModels } from './local-provider-models.js';
import {
  applyProcessEnvUpdates,
  buildRuntimeProviderPresetUpdates,
  getDefaultDotEnvPath,
  getRuntimeProviderDefinitionByPreset,
  getRuntimeProviderDefinitionByPiApi,
  hasMeaningfulSecret,
  loadDotEnvMap,
  resolveRuntimeConfigSnapshot,
  RUNTIME_PROVIDER_PRESET_ENV,
  RUNTIME_PROVIDER_DEFINITIONS,
  type RuntimeProviderPreset,
  upsertDotEnv,
} from './runtime-config.js';
import type { TelegramInlineKeyboard } from './telegram.js';
import { resolveCoderProjectTarget } from './coder-project-resolver.js';
import { resolveCoderProjectWorkspace } from './coder-project-path.js';
import {
  state,
  activeCoderRuns,
  telegramSettingsPanelActions,
  telegramSetupInputStates,
  pendingTaskTokens,
  TELEGRAM_SETTINGS_PANEL_PREFIX,
  TELEGRAM_SETTINGS_PANEL_TTL_MS,
  TELEGRAM_SETUP_INPUT_TTL_MS,
  TELEGRAM_MODEL_PANEL_PAGE_SIZE,
  type ThinkLevel,
  type ReasoningLevel,
  type TelegramDeliveryMode,
  type QueueMode,
  type PiModelEntry,
  type TelegramSetupInputKind,
  type TelegramSetupInputState,
  type TelegramSettingsPanelAction,
} from './app-state.js';
import { getEffectiveVerboseMode } from './verbose-mode.js';
import type { VerboseMode } from './verbose-mode.js';
import { getEffectiveModelLabel as getEffectiveModelLabelCore } from './chat-preferences.js';

// --- Runtime config helpers ---

export function getRuntimeConfigEnv(): Record<string, string | undefined> {
  const saved = loadDotEnvMap(getDefaultDotEnvPath(process.cwd()));
  return { ...saved, ...process.env };
}

export function getRuntimeConfigSummaryLines(): string[] {
  const snapshot = resolveRuntimeConfigSnapshot(getRuntimeConfigEnv());
  const label =
    snapshot.providerPreset === 'manual'
      ? `manual (${snapshot.provider})`
      : getRuntimeProviderDefinitionByPreset(snapshot.providerPreset).label;
  return [
    `Provider: ${label}`,
    `Model: ${snapshot.model}`,
    `API key (${snapshot.apiKeyEnv}): ${snapshot.apiKeyConfigured ? 'set' : 'missing'}`,
    snapshot.endpointEnv
      ? `Endpoint (${snapshot.endpointEnv}): ${snapshot.endpointValue || '(default)'}`
      : 'Endpoint: provider default',
  ];
}

export function buildOnboardingStatus() {
  const env = getRuntimeConfigEnv();
  const snapshot = resolveRuntimeConfigSnapshot(env);
  const telegramBotConfigured = hasMeaningfulSecret(env.TELEGRAM_BOT_TOKEN);
  const telegramAdminSecretConfigured = hasMeaningfulSecret(
    env.TELEGRAM_ADMIN_SECRET,
  );
  const whatsappEnabled = !['0', 'false', 'no'].includes(
    String(env.WHATSAPP_ENABLED || '1')
      .trim()
      .toLowerCase(),
  );
  const configComplete = snapshot.apiKeyConfigured && telegramBotConfigured;
  return {
    active: !!process.env.FFT_NANO_ONBOARDING_MODE || !configComplete,
    providerPreset: snapshot.providerPreset,
    model: snapshot.model,
    apiKeyConfigured: snapshot.apiKeyConfigured,
    telegramBotConfigured,
    telegramAdminSecretConfigured,
    whatsappEnabled,
    configComplete,
  };
}

export function ensureWebOnboardingAdminSecret(
  updates: Record<string, string | undefined>,
  source: Record<string, string | undefined>,
): string | null {
  if (hasMeaningfulSecret(source.TELEGRAM_ADMIN_SECRET)) return null;
  if (hasMeaningfulSecret(updates.TELEGRAM_ADMIN_SECRET)) return null;
  const secret = randomBytes(24).toString('hex');
  updates.TELEGRAM_ADMIN_SECRET = secret;
  return secret;
}

export function applyWebOnboardingConfig(payload: {
  providerPreset?: string;
  model?: string;
  apiKey?: string;
  telegramBotToken?: string;
  whatsappEnabled?: boolean;
}): { ok: boolean; requiresRestart: boolean; adminSecret?: string } {
  const providerPreset = (payload.providerPreset || '').trim().toLowerCase();
  if (!providerPreset) {
    throw new Error('providerPreset is required');
  }
  const matchedPreset = RUNTIME_PROVIDER_DEFINITIONS.find(
    (entry) => entry.id === providerPreset,
  );
  if (!matchedPreset) {
    throw new Error(`Unknown provider preset: ${providerPreset}`);
  }
  const currentEnv = getRuntimeConfigEnv();
  const provider = getRuntimeProviderDefinitionByPreset(matchedPreset.id);
  const updates = buildRuntimeProviderPresetUpdates({
    preset: matchedPreset.id,
    model: payload.model?.trim() || undefined,
    source: currentEnv,
    applyLocalDefaults: true,
  });
  const trimmedApiKey = payload.apiKey?.trim() || '';
  const apiKeyRequired = provider.apiKeyRequired !== false;
  if (trimmedApiKey) {
    updates[provider.apiKeyEnv] = trimmedApiKey;
  } else if (
    apiKeyRequired &&
    !hasMeaningfulSecret(currentEnv[provider.apiKeyEnv])
  ) {
    throw new Error(`API key is required for ${provider.label}`);
  }

  const telegramBotToken = payload.telegramBotToken?.trim() || '';
  if (!telegramBotToken) {
    throw new Error('telegramBotToken is required');
  }
  updates.TELEGRAM_BOT_TOKEN = telegramBotToken;
  updates.WHATSAPP_ENABLED = payload.whatsappEnabled ? '1' : '0';
  updates.FFT_NANO_ONBOARDING_MODE = undefined;
  const generatedSecret = ensureWebOnboardingAdminSecret(updates, currentEnv);
  if (generatedSecret) {
    updates.TELEGRAM_AUTO_REGISTER = '1';
  }
  persistRuntimeConfigUpdates(updates);
  return {
    ok: true,
    requiresRestart: true,
    adminSecret: generatedSecret || undefined,
  };
}

export function persistRuntimeConfigUpdates(
  updates: Record<string, string | undefined>,
): void {
  const envPath = getDefaultDotEnvPath(process.cwd());
  upsertDotEnv(envPath, updates);
  applyProcessEnvUpdates(updates);
  state.piModelsCache = null;
}

// --- Pi model loading ---

export function loadPiModels(
  forceRefresh = false,
):
  | { ok: true; entries: PiModelEntry[]; warnings?: string[] }
  | { ok: false; text: string } {
  if (
    !forceRefresh &&
    state.piModelsCache &&
    Date.now() - state.piModelsCache.loadedAt < 60_000 &&
    state.piModelsCache.entries.length > 0
  ) {
    return { ok: true, entries: state.piModelsCache.entries };
  }

  const piExecutable = resolvePiExecutable();
  if (!piExecutable) {
    return {
      ok: false,
      text: 'Model picker is unavailable because `pi` is not installed for the running service.',
    };
  }

  const piAgentDir = path.join(
    DATA_DIR,
    'pi',
    MAIN_GROUP_FOLDER,
    '.pi',
    'agent-fft',
  );
  const seedResult = ensureOpenCodeGoModels(piAgentDir);
  if (!seedResult.ok) {
    // Non-fatal: picker may not show some models
    void seedResult;
  }
  const localSeedResult = ensureLocalProviderModels(
    piAgentDir,
    getRuntimeConfigEnv(),
  );
  const warnings = localSeedResult.ok
    ? localSeedResult.errors.filter(
        (error) =>
          !error.startsWith('ollama:') &&
          !error.startsWith('lm-studio:') &&
          !error.endsWith(': missing baseUrl or apiKey'),
      )
    : localSeedResult.errors;
  if (!localSeedResult.ok) {
    void localSeedResult;
  }
  const runtimeEnv = getRuntimeConfigEnv();
  if (
    runtimeEnv.PI_API?.trim().toLowerCase() === 'opencode-go' &&
    runtimeEnv.PI_API_KEY &&
    !runtimeEnv.OPENCODE_API_KEY
  ) {
    runtimeEnv.OPENCODE_API_KEY = runtimeEnv.PI_API_KEY;
  }
  const result = spawnSync(piExecutable, ['--list-models'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...runtimeEnv,
      PI_CODING_AGENT_DIR: piAgentDir,
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  const entries =
    !result.error && result.status === 0
      ? parsePiListModelsResult({
          status: result.status,
          stdout: result.stdout,
          stderr: result.stderr,
        })
      : [];
  const piFailureText = result.error
    ? `Failed to load models from ${piExecutable}: ${result.error.message}`
    : result.status !== 0
      ? (result.stderr || result.stdout || '').trim() ||
        `pi --list-models exited with code ${result.status ?? 'unknown'}`
      : 'Model picker is unavailable because pi returned no models.';

  // Append locally available Ollama models
  const ollamaResult = spawnSync('ollama', ['list'], { encoding: 'utf8' });
  if (!ollamaResult.error && ollamaResult.status === 0) {
    const ollamaModels = (ollamaResult.stdout || '')
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim().split(/\s+/)[0])
      .filter((name): name is string => !!name && name.length > 0);
    for (const model of ollamaModels) {
      entries.push({ provider: 'ollama', model });
    }
  }

  if (entries.length === 0) {
    return {
      ok: false,
      text: piFailureText,
    };
  }

  state.piModelsCache = { entries, loadedAt: Date.now() };
  return warnings.length > 0
    ? { ok: true, entries, warnings }
    : { ok: true, entries };
}

export function runPiListModels(searchText: string): {
  ok: boolean;
  text: string;
} {
  const loaded = loadPiModels(true);
  if (!loaded.ok) {
    return { ok: false, text: loaded.text };
  }

  const trimmed = searchText.trim().toLowerCase();
  const filtered = trimmed
    ? loaded.entries.filter(
        (e) =>
          e.provider.toLowerCase().includes(trimmed) ||
          e.model.toLowerCase().includes(trimmed),
      )
    : loaded.entries;

  if (filtered.length === 0) {
    return {
      ok: true,
      text: trimmed
        ? `No models matched "${trimmed}".`
        : 'No models were returned by pi.',
    };
  }

  const providerOrder: string[] = [];
  const providerModels = new Map<string, string[]>();
  for (const entry of filtered) {
    let list = providerModels.get(entry.provider);
    if (!list) {
      list = [];
      providerModels.set(entry.provider, list);
      providerOrder.push(entry.provider);
    }
    list.push(entry.model);
  }

  const totalModels = filtered.length;
  const lines: string[] = [
    `*Available Models* (${totalModels} across ${providerOrder.length} providers)`,
  ];

  if (trimmed) {
    lines[0] = `*Models matching "${trimmed}"* (${totalModels})`;
  }

  lines.push('');
  for (const provider of providerOrder) {
    const models = providerModels.get(provider) ?? [];
    const providerDef = getRuntimeProviderDefinitionByPiApi(provider);
    const providerLabel = providerDef ? `${providerDef.label}` : provider;
    lines.push(`*${providerLabel}* (${models.length})`);
    for (const m of models) {
      lines.push(`  \`${m}\``);
    }
    lines.push('');
  }

  lines.push(
    'Use /model to open the picker, or /model provider/name to set directly.',
  );

  const text = lines.join('\n');
  const bounded =
    text.length > 12000
      ? `${text.slice(0, 12000)}\n\n...output truncated...`
      : text;
  return { ok: true, text: bounded };
}

export function providerExistsInPiModels(
  entries: PiModelEntry[],
  provider: string,
): boolean {
  return entries.some((entry) => entry.provider === provider);
}

export function modelExistsInPiModels(
  entries: PiModelEntry[],
  provider: string,
  model: string,
): boolean {
  return entries.some(
    (entry) => entry.provider === provider && entry.model === model,
  );
}

export function parseProviderFromModelLabel(label: string): string | null {
  const slash = label.indexOf('/');
  if (slash <= 0) return null;
  const provider = label.slice(0, slash).trim();
  return provider || null;
}

export function validateProviderModelRef(
  provider: string,
  model: string,
): { ok: true; warning?: string } | { ok: false; text: string } {
  const normalizedProvider = provider.trim();
  const normalizedModel = model.trim();
  if (!normalizedProvider || !normalizedModel) {
    return {
      ok: false,
      text: 'Usage: /model <provider/model> or /model reset',
    };
  }
  const loaded = loadPiModels();
  if (!loaded.ok) {
    return {
      ok: false,
      text: `Cannot validate model right now: ${loaded.text}\nRun /models and retry once picker data is available.`,
    };
  }
  if (!providerExistsInPiModels(loaded.entries, normalizedProvider)) {
    return {
      ok: false,
      text: `Unknown provider "${normalizedProvider}". Use /models or /model picker.`,
    };
  }
  if (
    !modelExistsInPiModels(loaded.entries, normalizedProvider, normalizedModel)
  ) {
    return {
      ok: false,
      text: `Model "${normalizedProvider}/${normalizedModel}" is not available. Run /refresh_models, then select it with /model.`,
    };
  }
  return { ok: true };
}

export function sanitizeRunPreferencesModelOverride(
  chatJid: string,
  runPreferences: Record<string, any>,
  deps: {
    getEffectiveModelLabel: (chatJid: string) => string;
    updateChatRunPreferences: (
      chatJid: string,
      updater: (prefs: Record<string, any>) => Record<string, any>,
    ) => void;
    isTelegramJid: (jid: string) => boolean;
  },
): { runPreferences: Record<string, any>; noticeText?: string } {
  const nextPrefs: Record<string, any> = { ...runPreferences };
  const rawProvider =
    typeof nextPrefs.provider === 'string' ? nextPrefs.provider.trim() : '';
  const rawModel =
    typeof nextPrefs.model === 'string' ? nextPrefs.model.trim() : '';
  if (!rawProvider && !rawModel) {
    return { runPreferences: nextPrefs };
  }

  const effectiveProvider =
    rawProvider ||
    parseProviderFromModelLabel(deps.getEffectiveModelLabel(chatJid));
  if (!effectiveProvider) {
    return { runPreferences: nextPrefs };
  }

  const loaded = loadPiModels();
  if (!loaded.ok) {
    return { runPreferences: nextPrefs };
  }

  const providerKnown = providerExistsInPiModels(
    loaded.entries,
    effectiveProvider,
  );
  const modelKnown = rawModel
    ? modelExistsInPiModels(loaded.entries, effectiveProvider, rawModel)
    : providerKnown;
  if (providerKnown && modelKnown) {
    return { runPreferences: nextPrefs };
  }

  const hadPersistedOverride =
    !!state.chatRunPreferences[chatJid]?.provider ||
    !!state.chatRunPreferences[chatJid]?.model;
  if (hadPersistedOverride) {
    deps.updateChatRunPreferences(chatJid, (prefs) => {
      delete prefs.provider;
      delete prefs.model;
      return prefs;
    });
  }

  delete nextPrefs.provider;
  delete nextPrefs.model;
  if (!hadPersistedOverride || !deps.isTelegramJid(chatJid)) {
    return { runPreferences: nextPrefs };
  }

  const attempted = rawModel
    ? `${effectiveProvider}/${rawModel}`
    : `${effectiveProvider}/(default-model)`;
  return {
    runPreferences: nextPrefs,
    noticeText: `Cleared invalid model override (${attempted}). Active model: ${deps.getEffectiveModelLabel(chatJid)}. Use /models or /model to set a valid override.`,
  };
}

// --- Settings panel action registry ---

export function pruneTelegramSettingsPanelActions(): void {
  const now = Date.now();
  for (const [token, panelState] of telegramSettingsPanelActions.entries()) {
    if (panelState.expiresAt <= now) telegramSettingsPanelActions.delete(token);
  }
}

export function registerTelegramSettingsPanelAction(
  chatJid: string,
  action: TelegramSettingsPanelAction,
): string {
  pruneTelegramSettingsPanelActions();
  let token = '';
  do {
    token = Math.random().toString(36).slice(2, 10);
  } while (telegramSettingsPanelActions.has(token));
  telegramSettingsPanelActions.set(token, {
    chatJid,
    action,
    expiresAt: Date.now() + TELEGRAM_SETTINGS_PANEL_TTL_MS,
  });
  return `${TELEGRAM_SETTINGS_PANEL_PREFIX}${token}`;
}

export function getTelegramSettingsPanelAction(
  chatJid: string,
  callbackData: string,
): TelegramSettingsPanelAction | null {
  if (!callbackData.startsWith(TELEGRAM_SETTINGS_PANEL_PREFIX)) return null;
  pruneTelegramSettingsPanelActions();
  const token = callbackData.slice(TELEGRAM_SETTINGS_PANEL_PREFIX.length);
  if (!token) return null;
  const panelState = telegramSettingsPanelActions.get(token);
  if (!panelState || panelState.chatJid !== chatJid) return null;
  return panelState.action;
}

// WS2.3: Pending task approval token management
const PENDING_TASK_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function prunePendingTaskTokens(): void {
  const now = Date.now();
  for (const [token, entry] of pendingTaskTokens.entries()) {
    if (entry.expiresAt <= now) pendingTaskTokens.delete(token);
  }
}

export function registerPendingTaskToken(
  taskId: string,
  groupFolder: string,
  action: 'approve' | 'reject',
): string {
  prunePendingTaskTokens();
  let token = '';
  do {
    token = Math.random().toString(36).slice(2, 10);
  } while (pendingTaskTokens.has(token));
  pendingTaskTokens.set(token, {
    taskId,
    groupFolder,
    action,
    expiresAt: Date.now() + PENDING_TASK_TTL_MS,
  });
  return token;
}

export interface PendingTaskTokenEntry {
  taskId: string;
  groupFolder: string;
  action: 'approve' | 'reject';
}

export function getPendingTaskToken(
  token: string,
): PendingTaskTokenEntry | null {
  prunePendingTaskTokens();
  const entry = pendingTaskTokens.get(token);
  if (!entry) return null;
  return {
    taskId: entry.taskId,
    groupFolder: entry.groupFolder,
    action: entry.action,
  };
}

// --- Setup input state ---

export function setTelegramSetupInputState(
  chatJid: string,
  kind: TelegramSetupInputKind,
): void {
  telegramSetupInputStates.set(chatJid, {
    kind,
    expiresAt: Date.now() + TELEGRAM_SETUP_INPUT_TTL_MS,
  });
}

export function setTelegramSetupInputProvider(
  chatJid: string,
  provider: string,
): void {
  const current = telegramSetupInputStates.get(chatJid);
  if (current) {
    current.provider = provider;
  }
}

export function clearTelegramSetupInputState(chatJid: string): void {
  telegramSetupInputStates.delete(chatJid);
}

export function getTelegramSetupInputState(
  chatJid: string,
): TelegramSetupInputState | null {
  const current = telegramSetupInputStates.get(chatJid);
  if (!current) return null;
  if (current.expiresAt <= Date.now()) {
    telegramSetupInputStates.delete(chatJid);
    return null;
  }
  return current;
}

// --- Panel builders ---

export function truncateButtonLabel(text: string, max = 28): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function formatTelegramSettingsPanelSummary(
  chatJid: string,
  deps: { getEffectiveModelLabel: (jid: string) => string },
): string[] {
  const prefs = state.chatRunPreferences[chatJid] || {};
  return [
    `Model: ${deps.getEffectiveModelLabel(chatJid)}`,
    `Think: ${prefs.thinkLevel || 'off'}`,
    `Reasoning: ${prefs.reasoningLevel || 'off'}`,
    `Delivery: ${prefs.telegramDeliveryMode || 'stream'}`,
    `Tool progress: ${getEffectiveVerboseMode(prefs.verboseMode)}`,
    `Next fresh run: ${prefs.nextRunNoContinue ? 'yes' : 'no'}`,
  ];
}

export function buildTelegramSetupHomePanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  return {
    text: [
      'Runtime setup wizard (.env + live runtime defaults):',
      ...getRuntimeConfigSummaryLines(),
      '',
      'Provider/model/key changes apply to new runs immediately. Endpoint override writes OPENAI_BASE_URL + PI_BASE_URL for openai-compatible endpoints.',
    ].join('\n'),
    keyboard: [
      [
        {
          text: 'Provider',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-setup-providers',
          }),
        },
        {
          text: 'Model',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'prompt-setup-model',
          }),
        },
      ],
      [
        {
          text: 'API Key',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-setup-api-key',
          }),
        },
        {
          text: 'Endpoint',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-setup-endpoint',
          }),
        },
      ],
      [
        {
          text: 'Restart Gateway',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'restart-gateway',
          }),
        },
        {
          text: 'Refresh',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-setup-home',
          }),
        },
      ],
    ],
  };
}

export function buildTelegramSetupProviderPanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const rows: TelegramInlineKeyboard = [];
  for (let i = 0; i < RUNTIME_PROVIDER_DEFINITIONS.length; i += 2) {
    rows.push(
      RUNTIME_PROVIDER_DEFINITIONS.slice(i, i + 2).map((provider) => ({
        text: provider.label,
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'set-setup-provider',
          preset: provider.id,
        }),
      })),
    );
  }
  rows.push([
    {
      text: 'Manual Provider',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'prompt-setup-provider',
      }),
    },
  ]);
  rows.push([
    {
      text: 'Home',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-setup-home',
      }),
    },
  ]);
  return {
    text: [
      'Choose a default provider preset:',
      ...getRuntimeConfigSummaryLines(),
      '',
      'Manual provider writes raw PI_API and uses PI_API_KEY.',
    ].join('\n'),
    keyboard: rows,
  };
}

export function buildTelegramSetupModelPanel(
  chatJid: string,
  preset: RuntimeProviderPreset,
  page = 0,
): { text: string; keyboard: TelegramInlineKeyboard } {
  const provider = getRuntimeProviderDefinitionByPreset(preset);
  if (provider.modelInputMode === 'typed') {
    const snapshot = resolveRuntimeConfigSnapshot(getRuntimeConfigEnv());
    return {
      text: [
        `${provider.label} uses typed model entry.`,
        `Current: ${snapshot.model}`,
        '',
        'Set the raw model id exposed by your local server.',
      ].join('\n'),
      keyboard: [
        [
          {
            text: 'Type Model',
            callbackData: registerTelegramSettingsPanelAction(chatJid, {
              kind: 'prompt-setup-model-typed',
            }),
          },
        ],
        [
          {
            text: 'Providers',
            callbackData: registerTelegramSettingsPanelAction(chatJid, {
              kind: 'show-setup-providers',
            }),
          },
        ],
        [
          {
            text: 'Home',
            callbackData: registerTelegramSettingsPanelAction(chatJid, {
              kind: 'show-setup-home',
            }),
          },
        ],
      ],
    };
  }
  const loaded = loadPiModels();
  if (!loaded.ok) {
    return {
      text: `Model picker error:\n${loaded.text}`,
      keyboard: [
        [
          {
            text: 'Type Model',
            callbackData: registerTelegramSettingsPanelAction(chatJid, {
              kind: 'prompt-setup-model-typed',
            }),
          },
        ],
        [
          {
            text: 'Home',
            callbackData: registerTelegramSettingsPanelAction(chatJid, {
              kind: 'show-setup-home',
            }),
          },
        ],
      ],
    };
  }

  const models = loaded.entries
    .filter((entry) => entry.provider === provider.piApi)
    .map((entry) => entry.model)
    .sort((a, b) => a.localeCompare(b));
  if (models.length === 0) {
    return {
      text: [
        `No picker models were returned for ${provider.label}.`,
        '',
        'Use typed model entry instead.',
      ].join('\n'),
      keyboard: [
        [
          {
            text: 'Type Model',
            callbackData: registerTelegramSettingsPanelAction(chatJid, {
              kind: 'prompt-setup-model-typed',
            }),
          },
        ],
        [
          {
            text: 'Home',
            callbackData: registerTelegramSettingsPanelAction(chatJid, {
              kind: 'show-setup-home',
            }),
          },
        ],
      ],
    };
  }

  const snapshot = resolveRuntimeConfigSnapshot(getRuntimeConfigEnv());
  const totalPages = Math.max(
    1,
    Math.ceil(models.length / TELEGRAM_MODEL_PANEL_PAGE_SIZE),
  );
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * TELEGRAM_MODEL_PANEL_PAGE_SIZE;
  const pageModels = models.slice(
    start,
    start + TELEGRAM_MODEL_PANEL_PAGE_SIZE,
  );
  const rows: TelegramInlineKeyboard = [];
  for (let i = 0; i < pageModels.length; i += 2) {
    rows.push(
      pageModels.slice(i, i + 2).map((model) => ({
        text:
          snapshot.model === model
            ? `* ${truncateButtonLabel(model)}`
            : truncateButtonLabel(model),
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'set-setup-model',
          preset,
          model,
        }),
      })),
    );
  }
  if (totalPages > 1) {
    const nav: TelegramInlineKeyboard[number] = [];
    if (safePage > 0) {
      nav.push({
        text: 'Prev',
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'show-setup-models',
          preset,
          page: safePage - 1,
        }),
      });
    }
    if (safePage < totalPages - 1) {
      nav.push({
        text: 'Next',
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'show-setup-models',
          preset,
          page: safePage + 1,
        }),
      });
    }
    if (nav.length > 0) rows.push(nav);
  }
  rows.push([
    {
      text: 'Type Model',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'prompt-setup-model-typed',
      }),
    },
    {
      text: 'Providers',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-setup-providers',
      }),
    },
  ]);
  rows.push([
    {
      text: 'Home',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-setup-home',
      }),
    },
  ]);
  return {
    text: [
      `Select a default ${provider.label} model:`,
      `Current: ${snapshot.model}`,
      `Page ${safePage + 1} of ${totalPages}`,
    ].join('\n'),
    keyboard: rows,
  };
}

export function buildTelegramSetupEndpointPanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const snapshot = resolveRuntimeConfigSnapshot(getRuntimeConfigEnv());
  return {
    text: [
      'Endpoint override:',
      `Current: ${snapshot.endpointValue || '(default)'}`,
      '',
      'This writes OPENAI_BASE_URL and PI_BASE_URL for openai-compatible/local endpoints.',
    ].join('\n'),
    keyboard: [
      [
        {
          text: 'Set Endpoint',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'prompt-setup-endpoint',
          }),
        },
        {
          text: 'Clear',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'clear-setup-endpoint',
          }),
        },
      ],
      [
        {
          text: 'Home',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-setup-home',
          }),
        },
      ],
    ],
  };
}

export function buildTelegramSetupApiKeyPanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const snapshot = resolveRuntimeConfigSnapshot(getRuntimeConfigEnv());
  return {
    text: [
      'API key setup:',
      `Target env: ${snapshot.apiKeyEnv}`,
      `Current status: ${snapshot.apiKeyConfigured ? 'set' : 'missing'}`,
      '',
      'The next plain-text message you send can be captured as the new key.',
    ].join('\n'),
    keyboard: [
      [
        {
          text: 'Set Key',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'prompt-setup-api-key',
          }),
        },
        {
          text: 'Clear',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'clear-setup-api-key',
          }),
        },
      ],
      [
        {
          text: 'Home',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-setup-home',
          }),
        },
      ],
    ],
  };
}

export function buildTelegramSettingsHomePanel(
  chatJid: string,
  deps: {
    getEffectiveModelLabel: (jid: string) => string;
    isMainChat?: (jid: string) => boolean;
  },
): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const keyboard: TelegramInlineKeyboard = [
    [
      {
        text: 'Models',
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'show-model-providers',
        }),
      },
      {
        text: 'Think',
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'show-think',
        }),
      },
    ],
    [
      {
        text: 'Queue',
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'show-queue',
        }),
      },
      {
        text: 'Delivery',
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'show-delivery',
        }),
      },
    ],
    [
      {
        text: 'Fresh Next Run',
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'trigger-new',
        }),
        style: 'primary' as const,
      },
      {
        text: 'Reasoning',
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'show-reasoning',
        }),
      },
      {
        text: 'Verbose',
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'show-verbose',
        }),
      },
    ],
  ];
  if (deps.isMainChat?.(chatJid)) {
    keyboard.push(
      [
        { text: 'Tasks', callbackData: 'panel:tasks' },
        { text: 'Pending Approvals', callbackData: 'panel:pending-tasks' },
      ],
      [
        { text: 'Groups', callbackData: 'panel:groups' },
        { text: 'Health', callbackData: 'panel:health' },
      ],
      [
        { text: 'Coder', callbackData: 'panel:coder' },
        {
          text: 'Runtime Setup',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-setup-home',
          }),
        },
      ],
    );
  }
  keyboard.push([
    {
      text: 'Reset Model',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'reset-model',
        returnTo: 'home',
      }),
      style: 'danger' as const,
    },
  ]);
  return {
    text: [
      'Runtime controls for this chat:',
      ...formatTelegramSettingsPanelSummary(chatJid, deps),
    ].join('\n'),
    keyboard,
  };
}

export function buildTelegramModelProviderPanel(
  chatJid: string,
  deps: { getEffectiveModelLabel: (jid: string) => string },
): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const loaded = loadPiModels();
  if (!loaded.ok) {
    return {
      text: `Model picker error:\n${loaded.text}`,
      keyboard: [
        [
          {
            text: 'Back',
            callbackData: registerTelegramSettingsPanelAction(chatJid, {
              kind: 'show-home',
            }),
          },
        ],
      ],
    };
  }

  const providerCounts = new Map<string, number>();
  for (const entry of loaded.entries) {
    providerCounts.set(
      entry.provider,
      (providerCounts.get(entry.provider) || 0) + 1,
    );
  }
  const providers = Array.from(providerCounts.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const rows: TelegramInlineKeyboard = [];
  for (let i = 0; i < providers.length; i += 2) {
    const slice = providers.slice(i, i + 2);
    rows.push(
      slice.map(([provider, count]) => {
        const providerDef = getRuntimeProviderDefinitionByPiApi(provider);
        const label = providerDef ? providerDef.label : provider;
        return {
          text: `${label} (${count})`,
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-models-for-provider',
            provider,
            page: 0,
          }),
        };
      }),
    );
  }
  rows.push([
    {
      text: 'Home',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-home',
      }),
    },
  ]);
  return {
    text: [
      'Select a provider:',
      ...formatTelegramSettingsPanelSummary(chatJid, deps),
    ].join('\n'),
    keyboard: rows,
  };
}

export function buildAddModelForProviderPanel(
  chatJid: string,
  provider: string,
): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const providerDef = getRuntimeProviderDefinitionByPiApi(provider);
  const providerLabel = providerDef ? providerDef.label : provider;
  return {
    text: [
      `Add a model to ${providerLabel}:`,
      '',
      'Tap "Type Model Name" below, then type the model id.',
      'Or use /model directly: /model provider/model-name',
      '',
      'The model will be set as your per-chat override.',
      'The model must already exist in your pi runtime.',
    ].join('\n'),
    keyboard: [
      [
        {
          text: 'Type Model Name',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'prompt-add-model-for-provider',
            provider,
          }),
        },
      ],
      [
        {
          text: 'Providers',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-model-providers',
          }),
        },
        {
          text: 'Home',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-home',
          }),
        },
      ],
    ],
  };
}

export function buildTelegramProviderModelPanel(
  chatJid: string,
  provider: string,
  page = 0,
  deps: { getEffectiveModelLabel: (jid: string) => string },
): { text: string; keyboard: TelegramInlineKeyboard } {
  const loaded = loadPiModels();
  if (!loaded.ok) {
    return {
      text: `Model picker error:\n${loaded.text}`,
      keyboard: [
        [
          {
            text: 'Back',
            callbackData: registerTelegramSettingsPanelAction(chatJid, {
              kind: 'show-home',
            }),
          },
        ],
      ],
    };
  }
  const models = loaded.entries
    .filter((entry) => entry.provider === provider)
    .map((entry) => entry.model)
    .sort((a, b) => a.localeCompare(b));

  const totalPages = Math.max(
    1,
    Math.ceil(models.length / TELEGRAM_MODEL_PANEL_PAGE_SIZE),
  );
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * TELEGRAM_MODEL_PANEL_PAGE_SIZE;
  const pageModels = models.slice(
    start,
    start + TELEGRAM_MODEL_PANEL_PAGE_SIZE,
  );
  const current = deps.getEffectiveModelLabel(chatJid);

  const rows: TelegramInlineKeyboard = [];
  for (let i = 0; i < pageModels.length; i += 2) {
    rows.push(
      pageModels.slice(i, i + 2).map((model) => {
        const full = `${provider}/${model}`;
        const selected = current === full;
        return {
          text: selected
            ? `* ${truncateButtonLabel(model)}`
            : truncateButtonLabel(model),
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'set-model',
            provider,
            model,
            returnTo: 'models',
          }),
        };
      }),
    );
  }

  if (totalPages > 1) {
    const navRow: TelegramInlineKeyboard[number] = [];
    if (safePage > 0) {
      navRow.push({
        text: 'Prev',
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'show-models-for-provider',
          provider,
          page: safePage - 1,
        }),
      });
    }
    if (safePage < totalPages - 1) {
      navRow.push({
        text: 'Next',
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'show-models-for-provider',
          provider,
          page: safePage + 1,
        }),
      });
    }
    if (navRow.length > 0) rows.push(navRow);
  }

  rows.push([
    {
      text: 'Reset Model',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'reset-model',
        returnTo: 'models',
      }),
    },
    {
      text: '+ Add Model',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-add-model-for-provider',
        provider,
      }),
    },
  ]);
  rows.push([
    {
      text: 'Providers',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-model-providers',
      }),
    },
    {
      text: 'Home',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-home',
      }),
    },
  ]);

  const providerDef = getRuntimeProviderDefinitionByPiApi(provider);
  const providerLabel = providerDef ? providerDef.label : provider;
  return {
    text: [
      `Select a model from ${providerLabel}:`,
      `Current: ${current}`,
      `Page ${safePage + 1} of ${totalPages}`,
    ].join('\n'),
    keyboard: rows,
  };
}

export function buildThinkPanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const current = state.chatRunPreferences[chatJid]?.thinkLevel || 'off';
  const levels: ThinkLevel[] = [
    'off',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
  ];
  const rows: TelegramInlineKeyboard = [];
  for (let i = 0; i < levels.length; i += 2) {
    rows.push(
      levels.slice(i, i + 2).map((value) => ({
        text: value === current ? `* ${value}` : value,
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'set-think',
          value,
        }),
      })),
    );
  }
  rows.push([
    {
      text: 'Home',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-home',
      }),
    },
  ]);
  return {
    text: `Select thinking level:\nCurrent: ${current}`,
    keyboard: rows,
  };
}

export function buildReasoningPanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const current = state.chatRunPreferences[chatJid]?.reasoningLevel || 'off';
  const levels: ReasoningLevel[] = ['off', 'on', 'stream'];
  return {
    text: `Select reasoning mode:\nCurrent: ${current}`,
    keyboard: [
      levels.map((value) => ({
        text: value === current ? `* ${value}` : value,
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'set-reasoning',
          value,
        }),
      })),
      [
        {
          text: 'Home',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-home',
          }),
        },
      ],
    ],
  };
}

export function buildDeliveryPanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const current =
    state.chatRunPreferences[chatJid]?.telegramDeliveryMode || 'stream';
  const modes: TelegramDeliveryMode[] = ['stream', 'append', 'off', 'draft'];
  return {
    text: [
      'Select Telegram text delivery mode:',
      `Current: ${current}`,
      '',
      'stream: durable streaming message (default)',
      'append: durable update blocks that remain in chat',
      'off: no preview — final answer only',
      'draft: native Telegram draft preview (ephemeral)',
    ].join('\n'),
    keyboard: [
      modes.map((value) => ({
        text: value === current ? `* ${value}` : value,
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'set-delivery',
          value,
        }),
        style:
          value === current
            ? ('success' as const)
            : value === 'off'
              ? ('danger' as const)
              : undefined,
      })),
      [
        {
          text: 'Home',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-home',
          }),
        },
      ],
    ],
  };
}

export function buildVerbosePanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const current = getEffectiveVerboseMode(
    state.chatRunPreferences[chatJid]?.verboseMode,
  );
  const levels: VerboseMode[] = ['off', 'new', 'all', 'verbose'];
  const rows: TelegramInlineKeyboard = [];
  for (let i = 0; i < levels.length; i += 2) {
    rows.push(
      levels.slice(i, i + 2).map((value) => ({
        text: value === current ? `* ${value}` : value,
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'set-verbose',
          value,
        }),
        style:
          value === current
            ? ('success' as const)
            : value === 'off'
              ? ('danger' as const)
              : undefined,
      })),
    );
  }
  rows.push([
    {
      text: 'Home',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-home',
      }),
    },
  ]);
  return {
    text: [
      'Select tool progress mode:',
      `Current: ${current}`,
      'off = final only',
      'new = minimal updates (emoji reactions)',
      'all = concise separate progress message',
      'verbose = detailed separate progress message',
    ].join('\n'),
    keyboard: rows,
  };
}

export function buildQueuePanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const prefs = state.chatRunPreferences[chatJid] || {};
  const current = prefs.queueMode || 'collect';
  const modes: QueueMode[] = [
    'collect',
    'followup',
    'interrupt',
    'steer',
    'steer-backlog',
  ];
  const rows: TelegramInlineKeyboard = [];
  for (let i = 0; i < modes.length; i += 2) {
    rows.push(
      modes.slice(i, i + 2).map((value) => ({
        text:
          value === current
            ? `* ${truncateButtonLabel(value, 24)}`
            : truncateButtonLabel(value, 24),
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'set-queue-mode',
          value,
        }),
      })),
    );
  }
  rows.push([
    {
      text: 'Home',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-home',
      }),
    },
  ]);
  return {
    text: [
      'Select queue mode:',
      `Current mode: ${current}`,
      `Debounce: ${prefs.queueDebounceMs || 0}ms`,
      `Cap: ${prefs.queueCap || 0}`,
      `Drop policy: ${prefs.queueDrop || 'old'}`,
      '',
      'Buttons change only the mode. Use typed /queue args for debounce, cap, and drop.',
    ].join('\n'),
    keyboard: rows,
  };
}

export function buildSubagentsPanel(
  chatJid: string,
  deps: { formatActiveSubagentsText: () => string },
): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const text = [
    'Subagent controls:',
    deps.formatActiveSubagentsText(),
    '',
    'Spawn still uses typed text: /subagents spawn <task>',
  ].join('\n');
  return {
    text,
    keyboard: [
      [
        {
          text: 'Refresh',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-subagents',
          }),
        },
        {
          text: 'Stop Current',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'stop-subagents',
            target: 'current',
          }),
        },
      ],
      [
        {
          text: 'Stop All',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'stop-subagents',
            target: 'all',
          }),
        },
        {
          text: 'Home',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-home',
          }),
        },
      ],
    ],
  };
}

export function buildAdminPanelKeyboard(): TelegramInlineKeyboard {
  return [
    [
      { text: 'Tasks', callbackData: 'panel:tasks' },
      { text: 'Pending Approvals', callbackData: 'panel:pending-tasks' },
    ],
    [
      { text: 'Groups', callbackData: 'panel:groups' },
      { text: 'Health', callbackData: 'panel:health' },
    ],
    [{ text: 'Coder', callbackData: 'panel:coder' }],
  ];
}

export interface ResolvePanelDeps {
  getEffectiveModelLabel: (jid: string) => string;
  formatActiveSubagentsText: () => string;
  buildTelegramGroupsPanel: (chatJid: string) => {
    text: string;
    keyboard: TelegramInlineKeyboard;
  };
  isMainChat?: (chatJid: string) => boolean;
}

export function resolveTelegramSettingsPanel(
  chatJid: string,
  action: TelegramSettingsPanelAction,
  deps: ResolvePanelDeps,
): { text: string; keyboard: TelegramInlineKeyboard } {
  switch (action.kind) {
    case 'show-home':
      return buildTelegramSettingsHomePanel(chatJid, deps);
    case 'show-model-providers':
      return buildTelegramModelProviderPanel(chatJid, deps);
    case 'show-models-for-provider':
      return buildTelegramProviderModelPanel(
        chatJid,
        action.provider,
        action.page,
        deps,
      );
    case 'show-think':
      return buildThinkPanel(chatJid);
    case 'show-reasoning':
      return buildReasoningPanel(chatJid);
    case 'show-delivery':
      return buildDeliveryPanel(chatJid);
    case 'show-verbose':
      return buildVerbosePanel(chatJid);
    case 'show-queue':
      return buildQueuePanel(chatJid);
    case 'show-groups':
      return deps.buildTelegramGroupsPanel(chatJid);
    case 'show-subagents':
      return buildSubagentsPanel(chatJid, deps);
    case 'show-setup-home':
      return buildTelegramSetupHomePanel(chatJid);
    case 'show-setup-providers':
      return buildTelegramSetupProviderPanel(chatJid);
    case 'show-setup-models':
      return buildTelegramSetupModelPanel(chatJid, action.preset, action.page);
    case 'show-setup-endpoint':
      return buildTelegramSetupEndpointPanel(chatJid);
    case 'show-setup-api-key':
      return buildTelegramSetupApiKeyPanel(chatJid);
    case 'show-add-model-for-provider':
      return buildAddModelForProviderPanel(chatJid, action.provider);
    case 'prompt-add-model-for-provider':
      return buildAddModelForProviderPanel(chatJid, action.provider);
    default:
      return buildTelegramSettingsHomePanel(chatJid, deps);
  }
}

export async function sendTelegramSettingsPanel(
  chatJid: string,
  action: TelegramSettingsPanelAction = { kind: 'show-home' },
  deps: ResolvePanelDeps,
): Promise<void> {
  if (!state.telegramBot) return;
  const panel = resolveTelegramSettingsPanel(chatJid, action, deps);
  await state.telegramBot.sendMessageWithKeyboard(
    chatJid,
    panel.text,
    panel.keyboard,
  );
}

export async function editTelegramSettingsPanel(
  chatJid: string,
  messageId: number,
  action: TelegramSettingsPanelAction,
  deps: ResolvePanelDeps,
): Promise<void> {
  if (!state.telegramBot) return;
  const panel = resolveTelegramSettingsPanel(chatJid, action, deps);
  await state.telegramBot.editMessageWithKeyboard(
    chatJid,
    messageId,
    panel.text,
    panel.keyboard,
  );
}

export async function promptTelegramSetupInput(
  chatJid: string,
  kind: TelegramSetupInputKind,
  prompt: string,
  sendMessage: (jid: string, text: string) => Promise<boolean>,
): Promise<void> {
  clearTelegramSetupInputState(chatJid);
  setTelegramSetupInputState(chatJid, kind);
  await sendMessage(
    chatJid,
    `${prompt}\n\nNext plain-text message will be captured. Send /setup cancel to abort.`,
  );
}

// --- Coder keyboard helpers ---

export async function sendTelegramCoderKeyboard(
  params: {
    chatJid: string;
    text: string;
    keyboard: TelegramInlineKeyboard;
    fallbackText?: string;
  },
  deps: {
    isTelegramJid: (jid: string) => boolean;
    sendMessage: (jid: string, text: string) => Promise<boolean>;
  },
): Promise<void> {
  if (
    deps.isTelegramJid(params.chatJid) &&
    state.telegramBot?.sendMessageWithKeyboard
  ) {
    await state.telegramBot.sendMessageWithKeyboard(
      params.chatJid,
      params.text,
      params.keyboard,
    );
    return;
  }
  await deps.sendMessage(params.chatJid, params.fallbackText || params.text);
}

export function buildCoderCommand(
  command: '/coder' | '/coder-plan',
  taskText: string,
): string {
  const normalizedTask = taskText.replace(/\s+/g, ' ').trim();
  return `${command} ${normalizedTask}`.trim();
}

export async function presentCoderSuggestion(
  params: {
    chatJid: string;
    taskText: string;
    requestId: string;
  },
  deps: {
    isTelegramJid: (jid: string) => boolean;
    sendMessage: (jid: string, text: string) => Promise<boolean>;
  },
): Promise<void> {
  await sendTelegramCoderKeyboard(
    {
      chatJid: params.chatJid,
      text: [
        'This sounds like coding work.',
        'Recommended next step: run a coder plan first, then explicitly escalate to execute if it looks right.',
      ].join('\n'),
      fallbackText: [
        'This sounds like coding work.',
        `Reply with: ${buildCoderCommand('/coder-plan', params.taskText)}`,
        `Or execute directly with: ${buildCoderCommand('/coder', params.taskText)}`,
        'Reply with: cancel',
      ].join('\n'),
      keyboard: [
        [
          {
            text: 'Plan',
            callbackData: registerTelegramSettingsPanelAction(params.chatJid, {
              kind: 'coder-approve-plan',
              taskText: params.taskText,
            }),
          },
          {
            text: 'Execute',
            callbackData: registerTelegramSettingsPanelAction(params.chatJid, {
              kind: 'coder-approve-execute',
              taskText: params.taskText,
            }),
          },
        ],
        [
          {
            text: 'Cancel',
            callbackData: registerTelegramSettingsPanelAction(params.chatJid, {
              kind: 'coder-cancel-resume',
              taskText: params.taskText,
            }),
          },
        ],
      ],
    },
    deps,
  );
}

export async function prepareCoderTarget(
  params: {
    chatJid: string;
    mode: 'plan' | 'execute';
    taskText: string;
    requestId: string;
    mainWorkspaceDir: string;
  },
  deps: {
    isTelegramJid: (jid: string) => boolean;
    sendMessage: (jid: string, text: string) => Promise<boolean>;
  },
): Promise<
  | {
      status: 'ready';
      workspaceRoot: string;
      taskText: string;
      projectLabel: string;
    }
  | { status: 'handled' }
> {
  const resolved = resolveCoderProjectTarget({
    mainWorkspaceDir: params.mainWorkspaceDir,
    taskText: params.taskText,
  });

  if (resolved.status === 'resolved') {
    if (params.mode === 'execute' && !resolved.isGitRepo) {
      await sendTelegramCoderKeyboard(
        {
          chatJid: params.chatJid,
          text: [
            `${resolved.projectLabel} is not a git-backed project, so execute mode cannot create an isolated worktree there.`,
            'Run a coder plan first or initialize git for that project.',
          ].join('\n'),
          fallbackText: [
            `${resolved.projectLabel} is not a git-backed project, so execute mode cannot create an isolated worktree there.`,
            `Reply with: ${buildCoderCommand('/coder-plan', `project:${resolved.projectLabel} ${resolved.taskText}`)}`,
            'Or initialize git for that project and retry execute mode.',
          ].join('\n'),
          keyboard: [
            [
              {
                text: 'Start Plan Instead',
                callbackData: registerTelegramSettingsPanelAction(
                  params.chatJid,
                  {
                    kind: 'coder-select-project',
                    mode: 'plan',
                    taskText: resolved.taskText,
                    projectPath: resolved.workspaceRoot,
                    projectLabel: resolved.projectLabel,
                    isGitRepo: resolved.isGitRepo,
                  },
                ),
              },
              {
                text: 'Cancel',
                callbackData: registerTelegramSettingsPanelAction(
                  params.chatJid,
                  {
                    kind: 'coder-cancel',
                  },
                ),
              },
            ],
          ],
        },
        deps,
      );
      return { status: 'handled' };
    }
    return {
      status: 'ready',
      workspaceRoot: resolved.workspaceRoot,
      taskText: resolved.taskText,
      projectLabel: resolved.projectLabel,
    };
  }

  if (resolved.status === 'ambiguous') {
    await sendTelegramCoderKeyboard(
      {
        chatJid: params.chatJid,
        text: 'I found multiple likely projects. Pick the right one before coder continues.',
        fallbackText: [
          'I found multiple likely projects. Re-run your request with one of these project selectors:',
          ...resolved.candidates.map(
            (candidate) =>
              `${buildCoderCommand(
                params.mode === 'plan' ? '/coder-plan' : '/coder',
                `project:${candidate.projectLabel} ${resolved.taskText}`,
              )}`,
          ),
          'Reply with: cancel',
        ].join('\n'),
        keyboard: [
          ...resolved.candidates.map((candidate) => [
            {
              text: truncateButtonLabel(candidate.projectLabel),
              callbackData: registerTelegramSettingsPanelAction(
                params.chatJid,
                {
                  kind: 'coder-select-project',
                  mode: params.mode,
                  taskText: resolved.taskText,
                  projectPath: candidate.workspaceRoot,
                  projectLabel: candidate.projectLabel,
                  isGitRepo: candidate.isGitRepo,
                },
              ),
            },
          ]),
          [
            {
              text: 'Cancel',
              callbackData: registerTelegramSettingsPanelAction(
                params.chatJid,
                {
                  kind: 'coder-cancel',
                },
              ),
            },
          ],
        ],
      },
      deps,
    );
    return { status: 'handled' };
  }

  if (resolved.projectHint && resolved.suggestedSlug) {
    await sendTelegramCoderKeyboard(
      {
        chatJid: params.chatJid,
        text: [
          `I could not find a project matching "${resolved.projectHint}".`,
          'If that project does not exist yet, you can create it now.',
        ].join('\n'),
        fallbackText: [
          `I could not find a project matching "${resolved.projectHint}".`,
          `Reply with: /coder-create-project ${resolved.suggestedSlug} ${resolved.taskText}`.trim(),
          'That will create the project and start a coder plan there.',
          'Or reply with: cancel',
        ].join('\n'),
        keyboard: [
          [
            {
              text: `Create ${truncateButtonLabel(resolved.suggestedSlug)}`,
              callbackData: registerTelegramSettingsPanelAction(
                params.chatJid,
                {
                  kind: 'coder-create-project',
                  mode: params.mode,
                  taskText: resolved.taskText,
                  slug: resolved.suggestedSlug,
                  projectLabel: resolved.projectHint,
                },
              ),
            },
            {
              text: 'Cancel',
              callbackData: registerTelegramSettingsPanelAction(
                params.chatJid,
                {
                  kind: 'coder-cancel',
                },
              ),
            },
          ],
        ],
      },
      deps,
    );
  } else {
    await deps.sendMessage(
      params.chatJid,
      'I could not map that request to a project. Re-run it with `project:<name>` so I can target the right workspace.',
    );
  }
  return { status: 'handled' };
}

export async function createCoderProject(params: {
  slug: string;
  mainWorkspaceDir: string;
}): Promise<{
  workspaceRoot: string;
  projectLabel: string;
  isGitRepo: boolean;
}> {
  const workspaceRoot = resolveCoderProjectWorkspace({
    mainWorkspaceDir: params.mainWorkspaceDir,
    slug: params.slug,
  });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  return {
    workspaceRoot,
    projectLabel: params.slug,
    isGitRepo: false,
  };
}
