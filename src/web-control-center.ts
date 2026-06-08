import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

import {
  ASSISTANT_NAME,
  FFT_NANO_WEB_AUTH_TOKEN,
  FFT_NANO_WEB_ENABLED,
  FFT_NANO_WEB_HOST,
  FFT_NANO_WEB_PORT,
  FFT_NANO_WEB_STATIC_DIR,
  FFT_NANO_TUI_AUTH_TOKEN,
  FFT_NANO_TUI_HOST,
  FFT_NANO_TUI_PORT,
  FEATURE_FARM,
  FFT_PROFILE,
  MAIN_GROUP_FOLDER,
  MAIN_WORKSPACE_DIR,
  PARITY_CONFIG,
  PROFILE_DETECTION,
  FFT_NANO_WEB_ACCESS_MODE,
} from './config.js';
import {
  getAllTasks,
  getDueTasks,
  getTaskById,
  getTaskRunLogs,
  getNextDueTaskTime,
  deleteTask,
  updateTask,
} from './db.js';
import { logger } from './logger.js';
import { getContainerRuntime } from './container-runtime.js';
import { startDetachedUpdateCommand } from './update-command.js';
import {
  resolveRuntimeConfigSnapshot,
  RUNTIME_PROVIDER_DEFINITIONS,
  buildRuntimeProviderPresetUpdates,
  getRuntimeProviderDefinitionByPreset,
  hasMeaningfulSecret,
  type RuntimeProviderPreset,
} from './runtime-config.js';
import {
  captureKnowledgeRawNote,
  ensureKnowledgeWikiScaffold,
  readKnowledgeWikiStatus,
  runKnowledgeWikiLint,
} from './knowledge-wiki.js';
import { KNOWLEDGE_NIGHTLY_TASK_ID } from './knowledge-wiki-task.js';
import { buildSystemPrompt } from './system-prompt.js';
import { computeTaskNextRun } from './task-schedule.js';
import { resolveGroupFolderPath, resolveGroupIpcPath } from './group-folder.js';
import {
  startWebControlCenterServer,
  type WebControlCenterAdapters,
  type WebControlCenterServer,
} from './web/control-center-server.js';
import {
  state,
  activeChatRunsById,
  activeCoderRuns,
  SERVICE_STARTED_AT,
  APP_VERSION,
  type PiModelEntry,
} from './app-state.js';
import type { GitInfo } from './state-persistence.js';
import type { TuiSessionSummary } from './tui/protocol.js';
import type { SessionPrefs as TuiSessionPrefs } from './tui/gateway-server.js';

export interface WebControlCenterDeps {
  getRuntimeConfigEnv: () => Record<string, string | undefined>;
  persistRuntimeConfigUpdates: (
    updates: Record<string, string | undefined>,
  ) => void;
  ensureWebOnboardingAdminSecret: (
    updates: Record<string, string | undefined>,
    source: Record<string, string | undefined>,
  ) => string | null;
  buildOnboardingStatus: () => {
    active: boolean;
    providerPreset: string;
    model: string;
    apiKeyConfigured: boolean;
    telegramBotConfigured: boolean;
    telegramAdminSecretConfigured: boolean;
    whatsappEnabled: boolean;
    configComplete: boolean;
  };
  applyWebOnboardingConfig: (payload: {
    providerPreset?: string;
    model?: string;
    apiKey?: string;
    telegramBotToken?: string;
    whatsappEnabled?: boolean;
  }) => { ok: boolean; requiresRestart: boolean; adminSecret?: string };
  loadPiModels: () =>
    | { ok: true; entries: PiModelEntry[] }
    | { ok: false; text: string };
  resolveChatJidForSessionKey: (sessionKey: string) => string | null;
  getTuiSessionPrefs: (chatJid: string) => TuiSessionPrefs;
  buildTuiSessionList: () => TuiSessionSummary[];
  getSessionKeyForChat: (chatJid: string) => string;
  gitInfo: GitInfo;
}

export const PROVIDER_SETUP_URLS: Record<
  string,
  {
    signupUrl?: string;
    docsUrl?: string;
    localSetupUrl?: string;
    note?: string;
  }
> = {
  openai: {
    signupUrl: 'https://platform.openai.com/api-keys',
    docsUrl: 'https://platform.openai.com/docs',
  },
  anthropic: {
    signupUrl: 'https://console.anthropic.com/settings/keys',
    docsUrl: 'https://docs.anthropic.com/',
  },
  gemini: {
    signupUrl: 'https://aistudio.google.com/app/apikey',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
  },
  openrouter: {
    signupUrl: 'https://openrouter.ai/keys',
    docsUrl: 'https://openrouter.ai/docs',
  },
  'opencode-go': {
    docsUrl: 'https://github.com/sst/opencode',
    note: 'Uses OPENCODE_API_KEY, with PI_API_KEY as a compatibility fallback.',
  },
  zai: {
    signupUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    docsUrl: 'https://docs.bigmodel.cn/',
  },
  minimax: {
    signupUrl:
      'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    docsUrl: 'https://platform.minimaxi.com/document',
  },
  'kimi-coding': {
    signupUrl: 'https://platform.moonshot.ai/console/api-keys',
    docsUrl: 'https://platform.moonshot.ai/docs',
  },
  ollama: {
    localSetupUrl: 'https://ollama.com/download',
    note: 'Local provider. Install Ollama and pull a model; no hosted API key is required.',
  },
  'lm-studio': {
    localSetupUrl: 'https://lmstudio.ai/',
    note: 'Local OpenAI-compatible provider. Start the local server in LM Studio first.',
  },
};

export function getControlCenterProviderSetup() {
  return RUNTIME_PROVIDER_DEFINITIONS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    piApi: provider.piApi,
    defaultModel: provider.defaultModel,
    apiKeyEnv: provider.apiKeyEnv,
    apiKeyRequired: provider.apiKeyRequired !== false,
    endpointEnv: provider.endpointEnv,
    ...PROVIDER_SETUP_URLS[provider.id],
  }));
}

export function getControlCenterRuntimeSettings(
  deps: Pick<WebControlCenterDeps, 'getRuntimeConfigEnv'>,
) {
  const env = deps.getRuntimeConfigEnv();
  const snapshot = resolveRuntimeConfigSnapshot(env);
  const whatsappEnabled = !['0', 'false', 'no'].includes(
    String(env.WHATSAPP_ENABLED || '1')
      .trim()
      .toLowerCase(),
  );
  return {
    providerPreset: snapshot.providerPreset,
    provider: snapshot.provider,
    model: snapshot.model,
    apiKeyEnv: snapshot.apiKeyEnv,
    apiKeyConfigured: snapshot.apiKeyConfigured,
    endpointEnv: snapshot.endpointEnv,
    endpointValue: snapshot.endpointValue,
    telegramBotConfigured: hasMeaningfulSecret(env.TELEGRAM_BOT_TOKEN),
    whatsappEnabled,
    heartbeatEnabled: PARITY_CONFIG.heartbeat.enabled,
    heartbeatEvery: PARITY_CONFIG.heartbeat.every,
  };
}

export function applyControlCenterRuntimeSettings(
  payload: {
    providerPreset?: string;
    model?: string;
    apiKey?: string;
    endpoint?: string;
    clearEndpoint?: boolean;
    telegramBotToken?: string;
    whatsappEnabled?: boolean;
    heartbeatEnabled?: boolean;
    heartbeatEvery?: string;
  },
  deps: Pick<
    WebControlCenterDeps,
    | 'getRuntimeConfigEnv'
    | 'persistRuntimeConfigUpdates'
    | 'ensureWebOnboardingAdminSecret'
  >,
): { ok: boolean; requiresRestart: boolean; adminSecret?: string } {
  const currentEnv = deps.getRuntimeConfigEnv();
  const updates: Record<string, string | undefined> = {};
  let generatedSecret: string | null = null;
  const providerPreset = (payload.providerPreset || '').trim().toLowerCase();
  let activeProvider = resolveRuntimeConfigSnapshot(currentEnv).providerPreset;

  if (providerPreset) {
    const matched = RUNTIME_PROVIDER_DEFINITIONS.find(
      (entry) => entry.id === providerPreset,
    );
    if (!matched) throw new Error(`Unknown provider preset: ${providerPreset}`);
    Object.assign(
      updates,
      buildRuntimeProviderPresetUpdates({
        preset: matched.id,
        model: payload.model?.trim() || undefined,
        source: currentEnv,
        applyLocalDefaults: true,
      }),
    );
    activeProvider = matched.id;
  } else if (payload.model?.trim()) {
    updates.PI_MODEL = payload.model.trim();
  }

  const providerDef =
    activeProvider === 'manual'
      ? null
      : getRuntimeProviderDefinitionByPreset(activeProvider);
  if (payload.apiKey?.trim()) {
    updates[providerDef?.apiKeyEnv || 'PI_API_KEY'] = payload.apiKey.trim();
  }
  const shouldClearEndpoint =
    payload.clearEndpoint ||
    (payload.endpoint === '' && !providerDef?.defaultEndpointValue);
  if (shouldClearEndpoint) {
    updates.OPENAI_BASE_URL = undefined;
    updates.PI_BASE_URL = undefined;
  } else if (payload.endpoint?.trim()) {
    updates.OPENAI_BASE_URL = payload.endpoint.trim();
    updates.PI_BASE_URL = payload.endpoint.trim();
  }
  if (payload.telegramBotToken?.trim()) {
    updates.TELEGRAM_BOT_TOKEN = payload.telegramBotToken.trim();
    generatedSecret = deps.ensureWebOnboardingAdminSecret(updates, currentEnv);
    if (generatedSecret) {
      updates.TELEGRAM_AUTO_REGISTER = '1';
    }
  }
  if (typeof payload.whatsappEnabled === 'boolean') {
    updates.WHATSAPP_ENABLED = payload.whatsappEnabled ? '1' : '0';
  }
  if (typeof payload.heartbeatEnabled === 'boolean') {
    updates.FFT_NANO_HEARTBEAT_ENABLED = payload.heartbeatEnabled ? '1' : '0';
  }
  if (payload.heartbeatEvery?.trim()) {
    updates.FFT_NANO_HEARTBEAT_EVERY = payload.heartbeatEvery.trim();
  }
  deps.persistRuntimeConfigUpdates(updates);
  return {
    ok: true,
    requiresRestart: true,
    adminSecret: generatedSecret || undefined,
  };
}

export function buildControlCenterSystemPromptPreview(
  payload: {
    sessionKey?: string;
    mode?: 'normal' | 'scheduled' | 'heartbeat' | 'evaluator';
  },
  deps: Pick<
    WebControlCenterDeps,
    | 'resolveChatJidForSessionKey'
    | 'getTuiSessionPrefs'
    | 'getSessionKeyForChat'
  >,
) {
  const sessionKey = (payload.sessionKey || 'main').trim() || 'main';
  const chatJid =
    deps.resolveChatJidForSessionKey(sessionKey) || findMainChatJidFromState();
  if (!chatJid) throw new Error(`Unknown session: ${sessionKey}`);
  const group = state.registeredGroups[chatJid];
  const groupFolder = group?.folder || MAIN_GROUP_FOLDER;
  const prefs = deps.getTuiSessionPrefs(chatJid);
  const mode = payload.mode || 'normal';
  const result = buildSystemPrompt(
    {
      groupFolder,
      chatJid,
      isMain: groupFolder === MAIN_GROUP_FOLDER,
      isScheduledTask: mode === 'scheduled',
      isHeartbeatTask: mode === 'heartbeat',
      isEvaluatorRun: mode === 'evaluator',
      assistantName: ASSISTANT_NAME,
      provider: prefs.provider,
      model: prefs.model,
      thinkLevel: prefs.thinkLevel,
      reasoningLevel: prefs.reasoningLevel,
      codingHint: 'none',
      requestId: `control-center-preview-${Date.now()}`,
    },
    {
      groupDir: resolveGroupFolderPath(groupFolder),
      globalDir: resolveGroupFolderPath('global'),
      ipcDir: resolveGroupIpcPath(groupFolder),
    },
    { delegationExtensionAvailable: true },
  );
  return {
    sessionKey: deps.getSessionKeyForChat(chatJid),
    chatJid,
    groupFolder,
    mode,
    text: result.text,
    report: result.report,
    persisted: false,
    note: 'Preview only; no role:system message is stored or sent.',
  };
}

function findMainChatJidFromState(): string | null {
  for (const [jid, group] of Object.entries(state.registeredGroups)) {
    if (group.folder === MAIN_GROUP_FOLDER) return jid;
  }
  return null;
}

export function listControlCenterTasks() {
  const tasks = getAllTasks();
  return {
    tasks,
    due: getDueTasks().map((task) => task.id),
    runs: Object.fromEntries(
      tasks.map((task) => [task.id, getTaskRunLogs(task.id, 5)]),
    ),
  };
}

export function performControlCenterTaskAction(payload: {
  id?: string;
  action?: 'pause' | 'resume' | 'cancel' | 'trigger';
}) {
  const id = payload.id?.trim() || '';
  const action = payload.action;
  if (!id) throw new Error('Task id is required');
  const task = getTaskById(id);
  if (!task) throw new Error(`Task not found: ${id}`);
  if (action === 'pause') {
    updateTask(id, { status: 'paused' });
  } else if (action === 'resume') {
    updateTask(id, {
      status: 'active',
      next_run:
        task.next_run ||
        computeTaskNextRun(task.schedule_type, task.schedule_value) ||
        new Date().toISOString(),
    });
  } else if (action === 'cancel') {
    deleteTask(id);
    return { id, action, deleted: true };
  } else if (action === 'trigger') {
    updateTask(id, { status: 'active', next_run: new Date().toISOString() });
  } else {
    throw new Error('Action must be pause, resume, cancel, or trigger');
  }
  return { id, action, task: getTaskById(id) };
}

export function getControlCenterPipelines() {
  return {
    activeRuns: Array.from(activeChatRunsById.values()).map((run) => ({
      requestId: run.requestId,
      chatJid: run.chatJid,
      startedAt: run.startedAt,
    })),
    activeCoderRuns: Array.from(activeCoderRuns.values()).map((run) => ({
      requestId: run.requestId,
      chatJid: run.chatJid,
      startedAt: run.startedAt,
      mode: run.mode,
      groupName: run.groupName,
      parentRequestId: run.parentRequestId,
      state: run.state,
      worktreePath: run.worktreePath,
    })),
    tasks: {
      total: getAllTasks().length,
      due: getDueTasks().length,
      nextRun: getNextDueTaskTime(),
    },
    gateway: {
      tuiClients: state.tuiGatewayServer ? 'listening' : 'offline',
      web: state.webControlCenterServer ? 'listening' : 'offline',
    },
  };
}

export function getControlCenterMemoryOverview() {
  const roots = [
    resolveGroupFolderPath(MAIN_GROUP_FOLDER),
    resolveGroupFolderPath('global'),
    MAIN_WORKSPACE_DIR,
  ];
  const docs = [
    'NANO.md',
    'SOUL.md',
    'TODOS.md',
    'MEMORY.md',
    'HEARTBEAT.md',
    'BOOTSTRAP.md',
  ];
  return {
    roots,
    docs: roots.flatMap((root) =>
      docs.map((name) => {
        const filePath = path.join(root, name);
        return {
          root,
          name,
          path: filePath,
          exists: fs.existsSync(filePath),
          size: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
        };
      }),
    ),
  };
}

export function getControlCenterKnowledgeStatus() {
  const scaffold = ensureKnowledgeWikiScaffold({
    workspaceDir: MAIN_WORKSPACE_DIR,
  });
  const status = readKnowledgeWikiStatus({ workspaceDir: MAIN_WORKSPACE_DIR });
  const nightly = getTaskById(KNOWLEDGE_NIGHTLY_TASK_ID);
  const readIfExists = (filePath: string) =>
    fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
  return {
    status,
    createdPaths: scaffold.createdPaths,
    nightlyTask: nightly || null,
    wiki: {
      index: readIfExists(status.paths.indexPath),
      progress: readIfExists(status.paths.progressPath),
      log: readIfExists(status.paths.logPath),
    },
    reports: fs.existsSync(status.paths.reportsDir)
      ? fs
          .readdirSync(status.paths.reportsDir)
          .filter((entry) => entry.endsWith('.md'))
          .sort()
          .slice(-10)
      : [],
  };
}

export function createWebControlCenterAdapters(
  deps: WebControlCenterDeps,
): WebControlCenterAdapters {
  return {
    getRuntimeStatus: () => ({
      runtime: getContainerRuntime(),
      sessions: deps.buildTuiSessionList().length,
      activeRuns: activeChatRunsById.size,
    }),
    getProfileStatus: () => ({
      profile: FFT_PROFILE,
      featureFarm: FEATURE_FARM,
      profileDetection: PROFILE_DETECTION,
    }),
    getBuildInfo: () => ({
      startedAt: SERVICE_STARTED_AT,
      version: APP_VERSION,
      ...deps.gitInfo,
    }),
    getGatewayStatus: () => ({
      host: FFT_NANO_TUI_HOST,
      port: FFT_NANO_TUI_PORT,
      authRequired: FFT_NANO_TUI_AUTH_TOKEN.length > 0,
    }),
    getOnboardingStatus: () => deps.buildOnboardingStatus(),
    applyOnboardingConfig: async (payload) =>
      deps.applyWebOnboardingConfig(payload),
    hostUpdate: () =>
      startDetachedUpdateCommand({
        cwd: process.cwd(),
      }),
    getProviderSetup: () => getControlCenterProviderSetup(),
    getRuntimeSettings: () => getControlCenterRuntimeSettings(deps),
    applyRuntimeSettings: async (payload) =>
      applyControlCenterRuntimeSettings(payload, deps),
    listRuntimeModels: async () => {
      const result = deps.loadPiModels();
      return result.ok
        ? { ok: true, models: result.entries }
        : { ok: false, models: [], error: result.text };
    },
    getSystemPromptPreview: (payload) =>
      buildControlCenterSystemPromptPreview(payload, deps),
    listTasks: () => listControlCenterTasks(),
    taskAction: (payload) => performControlCenterTaskAction(payload),
    getPipelines: () => getControlCenterPipelines(),
    getMemoryOverview: () => getControlCenterMemoryOverview(),
    getKnowledgeStatus: () => getControlCenterKnowledgeStatus(),
    knowledgeCapture: (payload) =>
      captureKnowledgeRawNote({
        workspaceDir: MAIN_WORKSPACE_DIR,
        text: payload.text || '',
        source: payload.source || 'control-center',
      }),
    knowledgeLint: () =>
      runKnowledgeWikiLint({ workspaceDir: MAIN_WORKSPACE_DIR }),
    validateSkills: () => {
      const result = spawnSync('npm', ['run', 'validate:skills'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
      });
      return {
        ok: !result.error && result.status === 0,
        status: result.status,
        stdout: result.stdout || '',
        stderr: result.stderr || result.error?.message || '',
      };
    },
  };
}

export async function startWebControlCenterService(
  deps: WebControlCenterDeps,
): Promise<void> {
  if (state.webControlCenterServer) return;
  if (!FFT_NANO_WEB_ENABLED) {
    logger.info('FFT Control Center disabled via FFT_NANO_WEB_ENABLED');
    return;
  }
  if (!fs.existsSync(FFT_NANO_WEB_STATIC_DIR)) {
    logger.warn(
      { staticDir: FFT_NANO_WEB_STATIC_DIR },
      'FFT Control Center build is missing; run npm run web:build',
    );
    return;
  }

  try {
    state.webControlCenterServer = await startWebControlCenterServer(
      createWebControlCenterAdapters(deps),
      {
        host: FFT_NANO_WEB_HOST,
        port: FFT_NANO_WEB_PORT,
        accessMode: FFT_NANO_WEB_ACCESS_MODE,
        authToken: FFT_NANO_WEB_AUTH_TOKEN,
        staticDir: FFT_NANO_WEB_STATIC_DIR,
        logsDir: path.resolve(process.cwd(), 'logs'),
        fileRoots: [
          {
            id: 'workspace',
            label: 'Main Workspace',
            path: MAIN_WORKSPACE_DIR,
          },
          {
            id: 'skills-project',
            label: 'Project Skills',
            path: path.resolve(process.cwd(), 'skills'),
          },
          {
            id: 'skills-user',
            label: 'User Skills',
            path: path.join(MAIN_WORKSPACE_DIR, 'skills'),
          },
        ],
      },
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error(
      { err: error },
      'FFT Control Center failed to start; continuing without web surface',
    );
  }
}

export async function stopWebControlCenterService(): Promise<void> {
  if (!state.webControlCenterServer) return;
  const server = state.webControlCenterServer;
  state.webControlCenterServer = null;
  try {
    await server.close();
    logger.info('FFT Control Center server stopped');
  } catch (err) {
    logger.warn({ err }, 'Failed to stop FFT Control Center server cleanly');
  }
}
