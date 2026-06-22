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
  GROUPS_DIR,
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
  resolveKnowledgeWikiPaths,
  runKnowledgeWikiLint,
  appendKnowledgeWikiLog,
} from './knowledge-wiki.js';
import { KNOWLEDGE_NIGHTLY_TASK_ID } from './knowledge-wiki-task.js';
import { buildSystemPrompt } from './system-prompt.js';
import { computeTaskNextRun } from './task-schedule.js';
import {
  isValidGroupFolder,
  resolveGroupFolderPath,
  resolveGroupIpcPath,
} from './group-folder.js';
import { writeTextFileAtomic } from './atomic-write.js';
import {
  isAllowedMemoryRelativePath,
  resolveAllowedMemoryFilePath,
  resolveGroupWorkspaceDir,
  resolveMemoryDir,
  resolveCanonicalDir,
  isCanonicalScaffoldContent,
} from './memory-paths.js';
import {
  listMemoryHistory,
  rollbackMemoryFile,
  snapshotMemoryFile,
} from './memory-history.js';
import {
  listSkillHistory,
  rollbackSkillFile,
  snapshotSkillFile,
} from './skill-history.js';
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
> = Object.fromEntries(
  RUNTIME_PROVIDER_DEFINITIONS.map((provider) => [
    provider.id,
    provider.setupUrls ?? {},
  ]),
);

export function getControlCenterProviderSetup() {
  return RUNTIME_PROVIDER_DEFINITIONS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    piApi: provider.piApi,
    defaultModel: provider.defaultModel,
    apiKeyEnv: provider.apiKeyEnv,
    apiKeyRequired: provider.apiKeyRequired !== false,
    endpointEnv: provider.endpointEnv,
    ...(provider.setupUrls ?? {}),
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

// --- Memory CRUD for the web UI ---------------------------------------------

const MEMORY_DOC_FILES = [
  'NANO.md',
  'SOUL.md',
  'TODOS.md',
  'MEMORY.md',
  'HEARTBEAT.md',
  'BOOTSTRAP.md',
];

const MEMORY_KINDS_BY_FILENAME: Record<string, string> = {
  'NANO.md': 'doc',
  'SOUL.md': 'doc',
  'TODOS.md': 'doc',
  'MEMORY.md': 'doc',
  'HEARTBEAT.md': 'doc',
  'BOOTSTRAP.md': 'doc',
};

function statMemoryFile(
  absolutePath: string,
  relPath: string,
): {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  kind: string;
  exists: boolean;
  scaffoldOnly?: boolean;
} {
  const exists =
    fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
  const stat = exists ? fs.statSync(absolutePath) : null;
  const name = path.posix.basename(relPath);
  let kind = 'doc';
  if (relPath.startsWith('canonical/')) kind = 'canonical';
  else if (relPath.startsWith('memory/')) kind = 'memory';
  else kind = MEMORY_KINDS_BY_FILENAME[name] || 'doc';
  return {
    path: relPath,
    name,
    size: stat?.size ?? 0,
    modifiedAt: stat ? stat.mtime.toISOString() : '',
    kind,
    exists,
  };
}

function listMarkdownFilesRecursive(dir: string, baseDir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        out.push(path.relative(baseDir, full).replace(/\\/g, '/'));
      }
    }
  }
  out.sort();
  return out;
}

function collectMemoryFilesForGroup(groupFolder: string) {
  const workspaceDir = resolveGroupWorkspaceDir(groupFolder);
  const seen = new Map<string, ReturnType<typeof statMemoryFile>>();

  for (const name of MEMORY_DOC_FILES) {
    const abs = path.join(workspaceDir, name);
    const stat = statMemoryFile(abs, name);
    seen.set(name, stat);
  }

  for (const rel of listMarkdownFilesRecursive(
    resolveCanonicalDir(groupFolder),
    workspaceDir,
  )) {
    if (seen.has(rel)) continue;
    const abs = path.join(workspaceDir, rel);
    const stat = statMemoryFile(abs, rel);
    if (stat.exists) {
      let content = '';
      try {
        content = fs.readFileSync(abs, 'utf-8');
      } catch {
        // ignore
      }
      const fileName = path.posix.basename(rel);
      stat.kind = 'canonical';
      stat.scaffoldOnly = isCanonicalScaffoldContent(fileName, content);
    }
    seen.set(rel, stat);
  }

  for (const rel of listMarkdownFilesRecursive(
    resolveMemoryDir(groupFolder),
    workspaceDir,
  )) {
    if (seen.has(rel)) continue;
    const abs = path.join(workspaceDir, rel);
    const stat = statMemoryFile(abs, rel);
    if (stat.exists) stat.kind = 'memory';
    seen.set(rel, stat);
  }

  return Array.from(seen.values()).sort((a, b) => a.path.localeCompare(b.path));
}

export function listControlCenterMemoryGroups() {
  const main: {
    folder: string;
    workspaceDir: string;
    isMain: boolean;
    isGlobal: boolean;
  } = {
    folder: MAIN_GROUP_FOLDER,
    workspaceDir: MAIN_WORKSPACE_DIR,
    isMain: true,
    isGlobal: false,
  };
  const groups: Array<typeof main> = [main];

  try {
    if (fs.existsSync(GROUPS_DIR)) {
      for (const entry of fs.readdirSync(GROUPS_DIR)) {
        if (!isValidGroupFolder(entry)) continue;
        if (entry === MAIN_GROUP_FOLDER) continue;
        groups.push({
          folder: entry,
          workspaceDir: resolveGroupFolderPath(entry),
          isMain: false,
          isGlobal: false,
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to enumerate memory groups');
  }

  return { groups };
}

export function listControlCenterMemoryFiles(payload: { group?: string }) {
  const group = (payload.group || '').trim() || MAIN_GROUP_FOLDER;
  if (group !== MAIN_GROUP_FOLDER && !isValidGroupFolder(group)) {
    throw new Error(`Unknown group: ${group}`);
  }
  const files = collectMemoryFilesForGroup(group);
  return {
    group,
    workspaceDir: resolveGroupWorkspaceDir(group),
    files,
  };
}

export function readControlCenterMemoryFile(payload: {
  group?: string;
  path?: string;
}) {
  const group = (payload.group || '').trim() || MAIN_GROUP_FOLDER;
  if (group !== MAIN_GROUP_FOLDER && !isValidGroupFolder(group)) {
    throw new Error(`Unknown group: ${group}`);
  }
  const relPath = (payload.path || '').trim();
  if (!relPath) throw new Error('path is required');
  if (!isAllowedMemoryRelativePath(relPath)) {
    throw new Error(`Path "${relPath}" is not an allowed memory file`);
  }
  const absPath = resolveAllowedMemoryFilePath(group, relPath);
  const exists = fs.existsSync(absPath) && fs.statSync(absPath).isFile();
  const content = exists ? fs.readFileSync(absPath, 'utf-8') : '';
  const stat = exists ? fs.statSync(absPath) : null;
  return {
    group,
    path: relPath.replace(/\\/g, '/'),
    exists,
    content,
    size: stat?.size ?? 0,
    modifiedAt: stat ? stat.mtime.toISOString() : '',
  };
}

export function writeControlCenterMemoryFile(payload: {
  group?: string;
  path?: string;
  content?: string;
}) {
  const group = (payload.group || '').trim() || MAIN_GROUP_FOLDER;
  if (group !== MAIN_GROUP_FOLDER && !isValidGroupFolder(group)) {
    throw new Error(`Unknown group: ${group}`);
  }
  const relPath = (payload.path || '').trim();
  if (!relPath) throw new Error('path is required');
  if (!isAllowedMemoryRelativePath(relPath)) {
    throw new Error(`Path "${relPath}" is not an allowed memory file`);
  }
  const content = typeof payload.content === 'string' ? payload.content : '';
  const absPath = resolveAllowedMemoryFilePath(group, relPath);
  // Snapshot the prior content (no-op for first write) so the change is reversible.
  if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
    snapshotMemoryFile(absPath, {
      authorityId: 'control-center',
      senderRole: 'operator',
    });
  }
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  writeTextFileAtomic(absPath, content);
  const stat = fs.statSync(absPath);
  return {
    group,
    path: relPath.replace(/\\/g, '/'),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

export function listControlCenterMemoryHistoryEntries(payload: {
  group?: string;
  path?: string;
}) {
  const group = (payload.group || '').trim() || MAIN_GROUP_FOLDER;
  if (group !== MAIN_GROUP_FOLDER && !isValidGroupFolder(group)) {
    throw new Error(`Unknown group: ${group}`);
  }
  const relPath = (payload.path || '').trim();
  if (!relPath) throw new Error('path is required');
  if (!isAllowedMemoryRelativePath(relPath)) {
    throw new Error(`Path "${relPath}" is not an allowed memory file`);
  }
  const absPath = resolveAllowedMemoryFilePath(group, relPath);
  const entries = listMemoryHistory(absPath);
  const versions = entries.map((entry) => {
    const stat = fs.statSync(entry.path);
    return {
      version: entry.version,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    };
  });
  return { group, path: relPath.replace(/\\/g, '/'), versions };
}

export function rollbackControlCenterMemoryFile(payload: {
  group?: string;
  path?: string;
  version?: string;
}) {
  const group = (payload.group || '').trim() || MAIN_GROUP_FOLDER;
  if (group !== MAIN_GROUP_FOLDER && !isValidGroupFolder(group)) {
    throw new Error(`Unknown group: ${group}`);
  }
  const relPath = (payload.path || '').trim();
  if (!relPath) throw new Error('path is required');
  if (!isAllowedMemoryRelativePath(relPath)) {
    throw new Error(`Path "${relPath}" is not an allowed memory file`);
  }
  const absPath = resolveAllowedMemoryFilePath(group, relPath);
  const version = rollbackMemoryFile(absPath, { version: payload.version });
  if (!version) {
    throw new Error('No history available to roll back');
  }
  const stat = fs.existsSync(absPath) ? fs.statSync(absPath) : null;
  return {
    group,
    path: relPath.replace(/\\/g, '/'),
    version,
    size: stat?.size ?? 0,
    modifiedAt: stat ? stat.mtime.toISOString() : '',
  };
}

// --- Knowledge CRUD for the web UI ------------------------------------------

function listKnowledgeDirFiles(
  dir: string,
  rootDir: string,
  kind:
    | 'knowledge-raw'
    | 'knowledge-wiki'
    | 'knowledge-schema'
    | 'knowledge-report'
    | 'knowledge-readme',
): Array<{
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  kind: string;
  exists: boolean;
}> {
  if (!fs.existsSync(dir)) return [];
  const out: Array<{
    path: string;
    name: string;
    size: number;
    modifiedAt: string;
    kind: string;
    exists: boolean;
  }> = [];
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const abs = path.join(dir, entry);
    if (!fs.statSync(abs).isFile()) continue;
    if (!entry.toLowerCase().endsWith('.md')) continue;
    const stat = fs.statSync(abs);
    const rel = path.relative(rootDir, abs).replace(/\\/g, '/');
    out.push({
      path: rel,
      name: entry,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      kind,
      exists: true,
    });
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

const KNOWLEDGE_ALLOWED_PREFIXES = [
  'wiki/',
  'raw/',
  'schema/',
  'reports/',
  'README.md',
];

function isAllowedKnowledgeRelativePath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized) return false;
  if (normalized.includes('..')) return false;
  return KNOWLEDGE_ALLOWED_PREFIXES.some((prefix) =>
    prefix.endsWith('/')
      ? normalized.startsWith(prefix)
      : normalized === prefix,
  );
}

function resolveKnowledgeFile(workspaceDir: string, relPath: string) {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!isAllowedKnowledgeRelativePath(normalized)) {
    throw new Error(`Path "${relPath}" is not an allowed knowledge file`);
  }
  const paths = resolveKnowledgeWikiPaths(workspaceDir);
  const rootReal = fs.realpathSync
    ? (() => {
        try {
          return fs.realpathSync(workspaceDir);
        } catch {
          return path.resolve(workspaceDir);
        }
      })()
    : path.resolve(workspaceDir);
  const abs = path.resolve(rootReal, normalized);
  const rel = path.relative(rootReal, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Resolved path escapes knowledge root');
  }
  return { absPath: abs, rootReal };
}

export function listControlCenterKnowledgeFiles() {
  const scaffold = ensureKnowledgeWikiScaffold({
    workspaceDir: MAIN_WORKSPACE_DIR,
  });
  const rootDir = scaffold.paths.rootDir;
  return {
    workspaceDir: MAIN_WORKSPACE_DIR,
    rootDir,
    files: [
      ...listKnowledgeDirFiles(scaffold.paths.rawDir, rootDir, 'knowledge-raw'),
      ...listKnowledgeDirFiles(
        scaffold.paths.wikiDir,
        rootDir,
        'knowledge-wiki',
      ),
      ...listKnowledgeDirFiles(
        scaffold.paths.schemaDir,
        rootDir,
        'knowledge-schema',
      ),
      ...listKnowledgeDirFiles(
        scaffold.paths.reportsDir,
        rootDir,
        'knowledge-report',
      ),
      ...listKnowledgeDirFiles(rootDir, rootDir, 'knowledge-readme'),
    ],
  };
}

export function readControlCenterKnowledgeFile(payload: { path?: string }) {
  const relPath = (payload.path || '').trim();
  if (!relPath) throw new Error('path is required');
  const { absPath, rootReal } = resolveKnowledgeFile(
    MAIN_WORKSPACE_DIR,
    relPath,
  );
  const exists = fs.existsSync(absPath) && fs.statSync(absPath).isFile();
  const content = exists ? fs.readFileSync(absPath, 'utf-8') : '';
  const stat = exists ? fs.statSync(absPath) : null;
  return {
    workspaceDir: MAIN_WORKSPACE_DIR,
    path: path.relative(rootReal, absPath).replace(/\\/g, '/'),
    exists,
    content,
    size: stat?.size ?? 0,
    modifiedAt: stat ? stat.mtime.toISOString() : '',
  };
}

export function writeControlCenterKnowledgeFile(payload: {
  path?: string;
  content?: string;
  mode?: 'replace' | 'append';
}) {
  const relPath = (payload.path || '').trim();
  if (!relPath) throw new Error('path is required');
  const { absPath, rootReal } = resolveKnowledgeFile(
    MAIN_WORKSPACE_DIR,
    relPath,
  );
  const content = typeof payload.content === 'string' ? payload.content : '';
  const mode = payload.mode === 'append' ? 'append' : 'replace';
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  if (mode === 'append') {
    if (fs.existsSync(absPath)) {
      snapshotMemoryFile(absPath, {
        authorityId: 'control-center',
        senderRole: 'operator',
      });
    }
    fs.appendFileSync(absPath, content, 'utf-8');
  } else {
    if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
      snapshotMemoryFile(absPath, {
        authorityId: 'control-center',
        senderRole: 'operator',
      });
    }
    writeTextFileAtomic(absPath, content);
  }
  const stat = fs.statSync(absPath);
  const effectiveRel = path.relative(rootReal, absPath).replace(/\\/g, '/');
  appendKnowledgeWikiLog({
    workspaceDir: MAIN_WORKSPACE_DIR,
    entry: `[ui-edit] mode=${mode} path=${effectiveRel} size=${stat.size}`,
  });
  return {
    path: effectiveRel,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    mode,
  };
}

// --- Skills read/write for the web UI ----------------------------------------

const MAX_SKILL_FILE_BYTES = 256 * 1024;

function resolveSkillFile(rootPath: string, skillPath: string) {
  const normalized = skillPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized) throw new Error('path is required');
  if (normalized.includes('..')) {
    throw new Error('Path escapes skill root');
  }
  // Must be a SKILL.md file at the end of a non-empty directory path
  if (!/^.+?\/SKILL\.md$/i.test(normalized)) {
    throw new Error('Only SKILL.md files under a skill directory are editable');
  }
  const abs = path.resolve(rootPath, normalized);
  const rootReal = fs.existsSync(rootPath)
    ? fs.realpathSync(rootPath)
    : path.resolve(rootPath);
  // Resolve the absolute path too so the boundary check holds across
  // symlinked prefixes (e.g. macOS /var/folders → /private/var/folders).
  const absReal = fs.existsSync(abs) ? fs.realpathSync(abs) : abs;
  const rel = path.relative(rootReal, absReal);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path escapes skill root');
  }
  return { absPath: absReal, rootReal, relPath: normalized };
}

function findSkillRootById(
  rootId: string,
  roots: Array<{ id: string; path: string; label: string }>,
) {
  const target = roots.find((root) => root.id === rootId);
  if (!target) throw new Error(`Unknown skill root: ${rootId}`);
  return target;
}

export function readControlCenterSkillFile(
  payload: { root?: string; path?: string },
  roots: Array<{ id: string; path: string; label: string }>,
) {
  const rootId = (payload.root || '').trim();
  if (!rootId) throw new Error('root is required');
  const skillPath = (payload.path || '').trim();
  if (!skillPath) throw new Error('path is required');
  const root = findSkillRootById(rootId, roots);
  const { absPath, rootReal, relPath } = resolveSkillFile(root.path, skillPath);
  const exists = fs.existsSync(absPath) && fs.statSync(absPath).isFile();
  const stat = exists ? fs.statSync(absPath) : null;
  if (exists && stat && stat.size > MAX_SKILL_FILE_BYTES) {
    throw new Error(`Skill file exceeds ${MAX_SKILL_FILE_BYTES} bytes`);
  }
  const content = exists ? fs.readFileSync(absPath, 'utf-8') : '';
  return {
    root: { id: root.id, label: root.label, path: rootReal },
    path: relPath,
    exists,
    content,
    size: stat?.size ?? 0,
    modifiedAt: stat ? stat.mtime.toISOString() : '',
  };
}

export function writeControlCenterSkillFile(
  payload: { root?: string; path?: string; content?: string },
  roots: Array<{ id: string; path: string; label: string }>,
) {
  const rootId = (payload.root || '').trim();
  if (!rootId) throw new Error('root is required');
  const skillPath = (payload.path || '').trim();
  if (!skillPath) throw new Error('path is required');
  const content = typeof payload.content === 'string' ? payload.content : '';
  if (Buffer.byteLength(content, 'utf-8') > MAX_SKILL_FILE_BYTES) {
    throw new Error(`Skill content exceeds ${MAX_SKILL_FILE_BYTES} bytes`);
  }
  const root = findSkillRootById(rootId, roots);
  const { absPath, rootReal, relPath } = resolveSkillFile(root.path, skillPath);
  if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
    snapshotSkillFile(absPath);
  }
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  writeTextFileAtomic(absPath, content);
  const stat = fs.statSync(absPath);
  return {
    root: { id: root.id, label: root.label, path: rootReal },
    path: relPath,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

export function listControlCenterSkillHistoryEntries(
  payload: { root?: string; path?: string },
  roots: Array<{ id: string; path: string; label: string }>,
) {
  const rootId = (payload.root || '').trim();
  if (!rootId) throw new Error('root is required');
  const skillPath = (payload.path || '').trim();
  if (!skillPath) throw new Error('path is required');
  const root = findSkillRootById(rootId, roots);
  const { absPath, rootReal, relPath } = resolveSkillFile(root.path, skillPath);
  const entries = listSkillHistory(absPath);
  return {
    root: { id: root.id, label: root.label, path: rootReal },
    path: relPath,
    versions: entries.map((entry) => {
      const stat = fs.statSync(entry.path);
      return {
        version: entry.version,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    }),
  };
}

export function rollbackControlCenterSkillFile(
  payload: { root?: string; path?: string; version?: string },
  roots: Array<{ id: string; path: string; label: string }>,
) {
  const rootId = (payload.root || '').trim();
  if (!rootId) throw new Error('root is required');
  const skillPath = (payload.path || '').trim();
  if (!skillPath) throw new Error('path is required');
  const root = findSkillRootById(rootId, roots);
  const { absPath, rootReal, relPath } = resolveSkillFile(root.path, skillPath);
  const version = rollbackSkillFile(absPath, { version: payload.version });
  if (!version) throw new Error('No skill history to roll back');
  const stat = fs.statSync(absPath);
  return {
    root: { id: root.id, label: root.label, path: rootReal },
    path: relPath,
    version,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
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
  const skillFileRoots: Array<{ id: string; path: string; label: string }> = [
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
  ];
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
    listMemoryGroups: () => listControlCenterMemoryGroups(),
    listMemoryFiles: (payload) => listControlCenterMemoryFiles(payload),
    readMemoryFile: (payload) => readControlCenterMemoryFile(payload),
    writeMemoryFile: (payload) => writeControlCenterMemoryFile(payload),
    listMemoryHistory: (payload) =>
      listControlCenterMemoryHistoryEntries(payload),
    rollbackMemoryFile: (payload) => rollbackControlCenterMemoryFile(payload),
    getKnowledgeStatus: () => getControlCenterKnowledgeStatus(),
    listKnowledgeFiles: () => listControlCenterKnowledgeFiles(),
    readKnowledgeFile: (payload) => readControlCenterKnowledgeFile(payload),
    writeKnowledgeFile: (payload) => writeControlCenterKnowledgeFile(payload),
    knowledgeCapture: (payload) =>
      captureKnowledgeRawNote({
        workspaceDir: MAIN_WORKSPACE_DIR,
        text: payload.text || '',
        source: payload.source || 'control-center',
      }),
    knowledgeLint: () =>
      runKnowledgeWikiLint({ workspaceDir: MAIN_WORKSPACE_DIR }),
    readSkillFile: (payload) =>
      readControlCenterSkillFile(payload, skillFileRoots),
    writeSkillFile: (payload) =>
      writeControlCenterSkillFile(payload, skillFileRoots),
    listSkillHistory: (payload) =>
      listControlCenterSkillHistoryEntries(payload, skillFileRoots),
    rollbackSkillFile: (payload) =>
      rollbackControlCenterSkillFile(payload, skillFileRoots),
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
