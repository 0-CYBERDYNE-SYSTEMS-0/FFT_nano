import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  DATA_DIR,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
  MAIN_WORKSPACE_DIR,
  PARITY_CONFIG,
  TIMEZONE,
} from './config.js';
import {
  assertValidGroupFolder,
  resolveGroupFolderPath,
  resolveGroupIpcPath,
} from './group-folder.js';
import { logger } from './logger.js';
import { getMemoryBackend } from './memory-backend.js';
import { MEMORY_RETRIEVAL_GATE_ENABLED } from './config.js';
import {
  buildSkillCatalogEntries,
  syncProjectPiSkillsToGroupPiHome,
  type SkillSyncResult,
} from './pi-skills.js';
import { normalizeTelegramDraftText } from './telegram.js';
import { ensureMemoryScaffold } from './memory-paths.js';
import { ensureMainWorkspaceBootstrap } from './workspace-bootstrap.js';
import { auditToolExecution } from './bash-guard.js';
import { parsePiJsonOutput, type PiToolExecution } from './pi-json-parser.js';
import {
  determinePromptPreflightDecision,
  hashPromptContent,
  readPromptRuntimeState,
  resolvePromptPreflightOutcome,
  writePromptManifest,
  writePromptRuntimeState,
  type PromptCacheEntry,
  type PromptPreflightDecision,
  type PromptRuntimeState,
} from './prompt-lifecycle.js';
import {
  createToolTrackerState,
  extractAssistantTextDeltaFromPiEvent,
  extractThinkingDeltaFromPiEvent,
  extractToolDeltaFromPiEvent,
} from './pi-stream-parser.js';
import { getPiApiKeyOverride } from './provider-auth.js';
import { buildSystemPrompt, type WorkspacePaths } from './system-prompt.js';
import { resolvePiExecutable } from './pi-executable.js';
import { wrapWithSandbox } from './sandbox.js';
import type { RegisteredGroup } from './types.js';
import { hostEventBus } from './app-state.js';
import { createHostEventId } from './runtime/host-events.js';

export interface ContainerInput {
  prompt: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  isSubagent?: boolean;
  assistantName?: string;
  secrets?: Record<string, string>;
  codingHint?:
    | 'none'
    | 'auto'
    | 'force_delegate_execute'
    | 'force_delegate_plan';
  requestId?: string;
  memoryContext?: string;
  extraSystemPrompt?: string;
  provider?: string;
  model?: string;
  thinkLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  reasoningLevel?: 'off' | 'on' | 'stream';
  verboseMode?: 'off' | 'new' | 'all' | 'verbose';
  noContinue?: boolean;
  toolMode?: 'default' | 'read_only' | 'full';
  workspaceDirOverride?: string;
  showReasoning?: boolean;
  skipPromptPreflight?: boolean;
  suppressPreviewStreaming?: boolean;
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  error?: string;
  streamed?: boolean;
  toolExecutions?: PiToolExecution[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    provider?: string;
    model?: string;
  };
  promptSummary?: {
    cacheHit: boolean;
    preflightDecision: PromptPreflightDecision;
    manifestPath: string;
    finalPromptChars: number;
    basePromptHash: string;
  };
}

export interface ContainerRuntimeEvent {
  kind: 'tool';
  index: number;
  toolName: string;
  status: 'start' | 'ok' | 'error';
  args?: string;
  output?: string;
  error?: string;
}

/** Extension UI request emitted by pi extensions (e.g. permission gate confirm dialog). */
export interface ExtensionUIRequest {
  id: string;
  method: 'confirm' | 'select' | 'input' | 'editor' | 'notify' | 'setStatus' | 'setWidget' | 'setTitle' | 'set_editor_text';
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  notifyMessage?: string;
  notifyType?: 'info' | 'warning' | 'error';
  statusKey?: string;
  statusText?: string;
  widgetKey?: string;
  widgetLines?: string[];
  widgetPlacement?: string;
  timeout?: number;
}

/** User response to an extension UI request. */
export type ExtensionUIResponse =
  | { confirmed: boolean }
  | { value: string }
  | { cancelled: true };

type CodingHint =
  | 'none'
  | 'auto'
  | 'force_delegate_execute'
  | 'force_delegate_plan';

function normalizeCodingHint(value: ContainerInput['codingHint']): CodingHint {
  if (value === ('force_delegate' as string)) return 'force_delegate_execute';
  if (
    value === 'auto' ||
    value === 'force_delegate_execute' ||
    value === 'force_delegate_plan' ||
    value === 'none'
  ) {
    return value;
  }
  return 'none';
}

function isForceDelegateHint(hint: CodingHint): boolean {
  return hint === 'force_delegate_execute' || hint === 'force_delegate_plan';
}

function isTelegramChatJid(chatJid: string): boolean {
  return chatJid.startsWith('telegram:');
}

export function deriveTelegramDraftId(seed: string): number {
  const input = seed.trim() || `draft-${Date.now()}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const raw = hash >>> 0;
  return (raw % 2_000_000_000) + 1;
}

function writeIpcFile(
  dir: string,
  prefix: string,
  payload: Record<string, unknown>,
): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const tmp = path.join(dir, `.tmp_${ts}_${rand}.json`);
    const out = path.join(dir, `${prefix}_${ts}_${rand}.json`);
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, out);
    return true;
  } catch {
    return false;
  }
}

function stripDotEnvQuotes(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1);
  }
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return v;
}

export function collectRuntimeSecrets(
  projectRoot: string,
): Record<string, string> {
  const envFile = path.join(projectRoot, '.env');
  const allowedVars = [
    'PI_BASE_URL',
    'PI_API_KEY',
    'PI_MODEL',
    'PI_API',
    'FFT_NANO_RUNTIME_PROVIDER_PRESET',
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'ANTHROPIC_API_KEY',
    'GEMINI_API_KEY',
    'OPENROUTER_API_KEY',
    'GROQ_API_KEY',
    'ZAI_API_KEY',
    'MINIMAX_API_KEY',
    'KIMI_API_KEY',
    'MODAL_API_KEY',
    'NVIDIA_API_KEY',
    'FFT_NANO_DRY_RUN',
    'HA_URL',
    'HA_TOKEN',
    'FFT_NANO_PROMPT_FILE_MAX_CHARS',
    'FFT_NANO_PROMPT_TOTAL_MAX_CHARS',
  ] as const;

  const fromDotEnv: Record<string, string> = {};
  if (fs.existsSync(envFile)) {
    const envContent = fs.readFileSync(envFile, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!(allowedVars as readonly string[]).includes(key)) continue;
      fromDotEnv[key] = stripDotEnvQuotes(trimmed.slice(eq + 1));
    }
  }

  const fromProcess: Record<string, string> = {};
  for (const key of allowedVars) {
    const v = process.env[key];
    if (typeof v === 'string' && v.length > 0) fromProcess[key] = v;
  }

  const merged: Record<string, string> = { ...fromDotEnv, ...fromProcess };
  if (merged.PI_BASE_URL && !merged.OPENAI_BASE_URL) {
    merged.OPENAI_BASE_URL = merged.PI_BASE_URL;
  }

  merged.TZ = TIMEZONE;
  merged.FFT_NANO_PROMPT_FILE_MAX_CHARS = String(
    PARITY_CONFIG.workspace.bootstrapMaxChars,
  );
  merged.FFT_NANO_PROMPT_TOTAL_MAX_CHARS = String(
    PARITY_CONFIG.workspace.bootstrapTotalMaxChars,
  );

  return merged;
}

function ensureMainWorkspaceSeed(): void {
  ensureMainWorkspaceBootstrap({ workspaceDir: MAIN_WORKSPACE_DIR });
  fs.mkdirSync(path.join(MAIN_WORKSPACE_DIR, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(MAIN_WORKSPACE_DIR, 'skills'), { recursive: true });
  ensureMemoryScaffold(MAIN_GROUP_FOLDER);
}

function resolveWorkspacePaths(
  group: RegisteredGroup,
  isMain: boolean,
  workspaceDirOverride?: string,
): WorkspacePaths & {
  piHomeDir: string;
  piAgentDir: string;
} {
  const groupDir =
    workspaceDirOverride ||
    (isMain ? MAIN_WORKSPACE_DIR : resolveGroupFolderPath(group.folder));
  const globalDir = path.join(GROUPS_DIR, 'global');
  const ipcDir = resolveGroupIpcPath(group.folder);
  const piHomeDir = path.join(DATA_DIR, 'pi', group.folder, '.pi');
  const piAgentDir = path.join(piHomeDir, 'agent-fft');

  return { groupDir, globalDir, ipcDir, piHomeDir, piAgentDir };
}

function ensureGroupDirs(
  wp: ReturnType<typeof resolveWorkspacePaths>,
  groupFolder: string,
  isMain: boolean,
): void {
  fs.mkdirSync(wp.groupDir, { recursive: true });
  fs.mkdirSync(wp.piHomeDir, { recursive: true });
  fs.mkdirSync(path.join(wp.ipcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(wp.ipcDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(wp.ipcDir, 'actions'), { recursive: true });
  fs.mkdirSync(path.join(wp.ipcDir, 'action_results'), { recursive: true });
  if (isMain) ensureMainWorkspaceSeed();
  else ensureMemoryScaffold(groupFolder);
}

function resolvePromptRuntimeStatePath(piHomeDir: string): string {
  return path.join(piHomeDir, 'fft_nano', 'prompt-state.json');
}

function resolveLatestPromptManifestPath(groupDir: string): string {
  return path.join(groupDir, 'logs', 'system-prompt.latest.json');
}

function resolvePerRequestPromptManifestPath(
  groupDir: string,
  requestId: string | undefined,
): string {
  const safeId = (requestId || `run-${Date.now()}`).replace(
    /[^a-zA-Z0-9._-]+/g,
    '-',
  );
  return path.join(groupDir, 'logs', 'system-prompts', `${safeId}.json`);
}

function isOverflowStyleError(stderr: string): boolean {
  return /payload too large|context length exceeded|maximum context length|token limit/i.test(
    stderr,
  );
}

function syncSkills(
  group: RegisteredGroup,
  piHomeDir: string,
  isMain: boolean,
): SkillSyncResult {
  const projectRoot = process.cwd();
  const runtimeSkillSourceDirs = isMain
    ? [path.join(MAIN_WORKSPACE_DIR, 'skills')]
    : [];
  const skillSync = syncProjectPiSkillsToGroupPiHome(projectRoot, piHomeDir, {
    additionalSkillSourceDirs: runtimeSkillSourceDirs,
  });
  if (skillSync.sourceDirExists) {
    logger.debug(
      {
        group: group.name,
        sourceDirs: skillSync.sourceDirs,
        managedSkills: skillSync.managed,
        copiedSkills: skillSync.copied,
        removedSkills: skillSync.removed,
      },
      'Synced Pi skills into group Pi home',
    );
  }
  if (skillSync.skippedInvalid.length > 0) {
    logger.warn(
      { group: group.name, skippedInvalidSkills: skillSync.skippedInvalid },
      'Skipped invalid Pi skills during sync',
    );
  }
  return skillSync;
}

function resolveExtensionPath(): string | null {
  // Extension file lives in the project source tree
  const candidates = [
    path.resolve(process.cwd(), 'src', 'extensions', 'fft-permission-gate.ts'),
    path.resolve(process.cwd(), 'dist', 'extensions', 'fft-permission-gate.js'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function buildPiArgs(params: {
  systemPrompt: string;
  prompt: string;
  useContinue: boolean;
  input: ContainerInput;
  codingHint: CodingHint;
  piAgentDir: string;
  secrets: Record<string, string>;
}): string[] {
  const { systemPrompt, prompt, useContinue, input, codingHint, secrets } =
    params;
  const args: string[] = ['--mode', 'json'];
  if (useContinue) args.push('-c');

  // Load the permission gate extension if available
  const extensionPath = resolveExtensionPath();
  if (extensionPath) {
    args.push('--extension', extensionPath);
  } else {
    logger.warn(
      'Permission gate extension not found at src/extensions/ or dist/extensions/. Destructive commands will NOT be blocked at runtime.',
    );
  }

  const model = input.model || secrets.PI_MODEL || process.env.PI_MODEL;
  const provider = input.provider || secrets.PI_API || process.env.PI_API;
  const apiKey = getPiApiKeyOverride(
    { provider: input.provider },
    { ...process.env, ...secrets },
  );

  if (provider) args.push('--provider', provider);
  if (model) args.push('--model', model);
  if (input.thinkLevel) args.push('--thinking', input.thinkLevel);
  if (apiKey) args.push('--api-key', apiKey);

  args.push('--append-system-prompt', systemPrompt);

  if (input.toolMode === 'read_only') {
    args.push('--tools', 'read,grep,find,ls');
  } else if (input.toolMode === 'full') {
    args.push('--tools', 'read,bash,edit,write,grep,find,ls');
  } else if (isForceDelegateHint(codingHint)) {
    const mode = codingHint === 'force_delegate_plan' ? 'plan' : 'execute';
    args.push(
      '--tools',
      mode === 'plan'
        ? 'read,grep,find,ls'
        : 'read,bash,edit,write,grep,find,ls',
    );
  } else {
    args.push('--tools', 'read,bash,edit,write,grep,find,ls');
  }

  args.push(prompt);
  return args;
}

function appendToolVerboseSection(
  baseResult: string,
  mode: ContainerInput['verboseMode'],
  toolExecutions: PiToolExecution[] | undefined,
): string {
  if (mode === 'off' || mode === 'new') return baseResult;
  if (!toolExecutions || toolExecutions.length === 0) return baseResult;

  const includeAll = mode === 'verbose';
  const maxRows = includeAll ? 60 : 30;
  const truncated = toolExecutions.length > maxRows;
  const rows = toolExecutions.slice(0, maxRows).map((entry) => {
    const parts = [`#${entry.index}`, entry.toolName, entry.status];
    if (entry.args) parts.push(`args=${entry.args}`);
    if (entry.error) parts.push(`error=${entry.error}`);
    if (includeAll && entry.output) parts.push(`output=${entry.output}`);
    return `- ${parts.join(' ')}`;
  });
  const header = includeAll
    ? '[verbose:verbose] Tool calls'
    : '[verbose:all] Tool activity';
  if (truncated) {
    rows.push(
      `- ... ${toolExecutions.length - maxRows} additional item(s) omitted`,
    );
  }
  const section = [header, ...rows].join('\n');
  return baseResult ? `${baseResult}\n\n${section}` : section;
}

export async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  abortSignal?: AbortSignal,
  onRuntimeEvent?: (event: ContainerRuntimeEvent) => void,
  onExtensionUIRequest?: (
    request: ExtensionUIRequest,
  ) => Promise<ExtensionUIResponse>,
): Promise<ContainerOutput> {
  const startTime = Date.now();
  const projectRoot = process.cwd();
  const codingHint = normalizeCodingHint(input.codingHint);

  let groupDir: string;
  try {
    assertValidGroupFolder(group.folder);
    groupDir = resolveGroupFolderPath(group.folder);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error(
      { groupName: group.name, groupFolder: group.folder, error },
      'Rejected run for invalid group folder',
    );
    return { status: 'error', result: null, error };
  }

  let payload = input;
  if (MEMORY_RETRIEVAL_GATE_ENABLED) {
    try {
      const memory = getMemoryBackend().buildContext({
        groupFolder: group.folder,
        prompt: input.prompt,
      });
      if (memory.context) {
        payload = { ...input, memoryContext: memory.context };
      }
      logger.debug(
        {
          group: group.name,
          chunksTotal: memory.chunksTotal,
          selectedK: memory.selectedK,
        },
        'Built retrieval-gated memory context',
      );
    } catch (err) {
      logger.warn({ group: group.name, err }, 'Failed to build memory context');
    }
  }

  const isMain = input.isMain;
  const wp = resolveWorkspacePaths(group, isMain, input.workspaceDirOverride);
  ensureGroupDirs(wp, group.folder, isMain);
  const skillSync = syncSkills(group, wp.piHomeDir, isMain);
  const secrets = {
    ...collectRuntimeSecrets(projectRoot),
    ...(input.secrets || {}),
  };
  const promptStatePath = resolvePromptRuntimeStatePath(wp.piHomeDir);
  let promptState = readPromptRuntimeState(promptStatePath);

  const skillCatalog = buildSkillCatalogEntries(skillSync.sourceDirs, {
    maxChars: PARITY_CONFIG.prompt.skillCatalogMaxChars,
  });

  const baseInput = {
    groupFolder: input.groupFolder,
    chatJid: input.chatJid,
    isMain,
    isScheduledTask: input.isScheduledTask,
    assistantName: input.assistantName,
    provider: input.provider,
    model: input.model,
    thinkLevel: input.thinkLevel,
    reasoningLevel: input.reasoningLevel,
    noContinue: input.noContinue,
    memoryContext: payload.memoryContext,
    codingHint,
    requestId: input.requestId,
    extraSystemPrompt: input.extraSystemPrompt,
    skillCatalog,
  } as const;

  const cachedBase = PARITY_CONFIG.prompt.cacheEnabled
    ? promptState.cacheEntries[
        `${isMain ? 'main' : 'group'}:${input.isScheduledTask ? 'minimal' : 'full'}:${codingHint}`
      ]
    : undefined;
  let systemPromptBuild = buildSystemPrompt(baseInput, wp, {
    delegationExtensionAvailable: true,
    skillCatalogMaxChars: PARITY_CONFIG.prompt.skillCatalogMaxChars,
    cachedBaseLayer: cachedBase
      ? {
          key: cachedBase.key,
          hash: cachedBase.hash,
          content: cachedBase.content,
        }
      : null,
  });

  const isHeartbeatRun = (input.requestId || '').startsWith('heartbeat-');
  const promptRunMode: 'interactive' | 'scheduled' | 'heartbeat' =
    input.isScheduledTask
      ? 'scheduled'
      : isHeartbeatRun
        ? 'heartbeat'
        : 'interactive';
  const promptPreflightInput = {
    preflightRebaseEnabled:
      input.skipPromptPreflight !== true &&
      PARITY_CONFIG.prompt.preflightRebaseEnabled,
    flushEnabled:
      input.skipPromptPreflight !== true &&
      PARITY_CONFIG.memory.flushBeforeCompaction.enabled,
    softTokenThreshold: PARITY_CONFIG.prompt.softTokenThreshold,
    hardTokenThreshold: PARITY_CONFIG.prompt.hardTokenThreshold,
    currentPromptChars: systemPromptBuild.report.totalChars,
    runMode: promptRunMode,
  };

  const preflightOutcome = await resolvePromptPreflightOutcome({
    input: promptPreflightInput,
    state: promptState,
    executeFlush: promptPreflightInput.flushEnabled
      ? async () => {
          const flushCfg = PARITY_CONFIG.memory.flushBeforeCompaction;
          const flushPrompt = [
            '[MEMORY FLUSH BEFORE PROMPT REBASE]',
            flushCfg.systemPrompt,
            flushCfg.prompt,
          ].join('\n');
          const flushRequestId = `${input.requestId || `run-${Date.now()}`}-prompt-flush`;
          logger.info(
            { group: group.name, requestId: input.requestId, flushRequestId },
            'Running prompt preflight memory flush',
          );
          const flushOutput = await runContainerAgent(
            group,
            {
              ...input,
              prompt: flushPrompt,
              requestId: flushRequestId,
              codingHint: 'none',
              noContinue: false,
              verboseMode: 'off',
              showReasoning: false,
              skipPromptPreflight: true,
              suppressPreviewStreaming: true,
            },
            abortSignal,
          );
          if (flushOutput.status !== 'success') {
            logger.warn(
              {
                group: group.name,
                requestId: input.requestId,
                flushRequestId,
                error: flushOutput.error,
              },
              'Prompt preflight memory flush failed',
            );
            return null;
          }
          return readPromptRuntimeState(promptStatePath);
        }
      : undefined,
  });
  promptState = preflightOutcome.state;
  let preflightDecision = preflightOutcome.decision;
  if (preflightOutcome.flushed) {
    writePromptRuntimeState(promptStatePath, promptState);
  }

  let effectiveInputNoContinue = input.noContinue === true;
  if (preflightDecision === 'rebase_session') {
    effectiveInputNoContinue = true;
    systemPromptBuild = buildSystemPrompt(
      {
        ...baseInput,
        noContinue: true,
      },
      wp,
      {
        delegationExtensionAvailable: true,
        skillCatalogMaxChars: PARITY_CONFIG.prompt.skillCatalogMaxChars,
        cachedBaseLayer: cachedBase
          ? {
              key: cachedBase.key,
              hash: cachedBase.hash,
              content: cachedBase.content,
            }
          : null,
      },
    );
  }

  const systemPrompt = systemPromptBuild.text;
  const latestManifestPath = resolveLatestPromptManifestPath(groupDir);
  if (PARITY_CONFIG.prompt.persistLatestManifest) {
    writePromptManifest(latestManifestPath, systemPromptBuild.report);
  }
  if (
    !PARITY_CONFIG.prompt.manifestPerRequestInDebugOnly ||
    process.env.LOG_LEVEL === 'debug'
  ) {
    writePromptManifest(
      resolvePerRequestPromptManifestPath(groupDir, input.requestId),
      systemPromptBuild.report,
    );
  }
  if (preflightDecision === 'abort') {
    logger.error(
      {
        group: group.name,
        promptStatePath,
        currentPromptChars: systemPromptBuild.report.totalChars,
      },
      'Prompt preflight aborted run',
    );
    return {
      status: 'error',
      result: null,
      error:
        'Prompt runtime state is corrupted or preflight thresholds are invalid. Remove or repair the prompt state file before retrying.',
      promptSummary: {
        cacheHit: systemPromptBuild.report.cacheHit,
        preflightDecision,
        manifestPath: latestManifestPath,
        finalPromptChars: systemPromptBuild.report.totalChars,
        basePromptHash: systemPromptBuild.report.basePromptHash,
      },
    };
  }

  const cacheSlotKey = `${isMain ? 'main' : 'group'}:${systemPromptBuild.report.mode}:${codingHint}`;
  const nextPromptState: PromptRuntimeState = {
    ...promptState,
    lastPreflightDecision: preflightDecision,
    lastManifestPath: latestManifestPath,
    cacheEntries: {
      ...promptState.cacheEntries,
    },
  };
  if (PARITY_CONFIG.prompt.cacheEnabled) {
    const baseLayer = systemPromptBuild.report.layers.find(
      (layer) => layer.id === 'base',
    );
    if (baseLayer) {
      const cacheEntry: PromptCacheEntry = {
        key: systemPromptBuild.report.baseCacheKey,
        hash: hashPromptContent(baseLayer.content),
        content: baseLayer.content,
        manifest: systemPromptBuild.report,
        builtAt: new Date().toISOString(),
      };
      nextPromptState.cacheEntries[cacheSlotKey] = cacheEntry;
    }
  }
  if (preflightDecision === 'flush_then_continue') {
    nextPromptState.flushedEpoch = promptState.sessionEpoch;
  }
  if (preflightDecision === 'rebase_session') {
    nextPromptState.sessionEpoch = (promptState.sessionEpoch || 0) + 1;
    nextPromptState.flushedEpoch = undefined;
    nextPromptState.lastRebaseAt = new Date().toISOString();
    nextPromptState.lastOverflowAt = undefined;
  }
  writePromptRuntimeState(promptStatePath, nextPromptState);

  logger.debug(
    {
      group: group.name,
      mode: systemPromptBuild.report.mode,
      chars: systemPromptBuild.report.totalChars,
      contextEntries: systemPromptBuild.report.contextEntries.length,
      cacheHit: systemPromptBuild.report.cacheHit,
      preflightDecision,
      skillCatalogCount: systemPromptBuild.report.skillsCatalog.count,
    },
    'System prompt built',
  );

  const prompt = input.isScheduledTask
    ? `[SCHEDULED TASK]\n${input.prompt}`
    : input.prompt;

  if (
    ['1', 'true', 'yes'].includes(
      (
        secrets.FFT_NANO_DRY_RUN ||
        process.env.FFT_NANO_DRY_RUN ||
        ''
      ).toLowerCase(),
    )
  ) {
    return {
      status: 'success',
      result: `DRY_RUN: received ${prompt.length} chars for ${input.chatJid}`,
    };
  }

  const logsDir = path.join(groupDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  // Hoisted reference so timeout/abort handlers can kill the active child process.
  let activeChild: import('child_process').ChildProcess | null = null;

  const killActiveChild = () => {
    if (!activeChild || activeChild.killed) return;
    activeChild.kill('SIGTERM');
    const ref = activeChild;
    setTimeout(() => {
      if (!ref.killed) ref.kill('SIGKILL');
    }, 5_000);
  };

  const STDERR_MAX_SIZE = 1_048_576; // 1 MB

  const piExecutable = resolvePiExecutable();
  if (!piExecutable) {
    return {
      status: 'error',
      result: null,
      error:
        'pi binary not found on PATH and no repo-local fallback exists. Set PI_PATH or install pi globally.',
    };
  }

  const runPi = (useContinue: boolean) =>
    new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
      streamedDraft: boolean;
    }>((resolve) => {
      const piArgs = buildPiArgs({
        systemPrompt,
        prompt,
        useContinue,
        input: payload,
        codingHint,
        piAgentDir: wp.piAgentDir,
        secrets,
      });

      const hostPassthrough: Record<string, string> = {};
      for (const key of [
        'PATH',
        'HOME',
        'TZ',
        'TERM',
        'LANG',
        'SHELL',
        'USER',
        'TMPDIR',
      ] as const) {
        const v = process.env[key];
        if (v) hostPassthrough[key] = v;
      }
      const env: NodeJS.ProcessEnv = {
        ...hostPassthrough,
        ...secrets,
        PI_CODING_AGENT_DIR: wp.piAgentDir,
        FFT_NANO_CHAT_JID: input.chatJid,
        FFT_NANO_REQUEST_ID: input.requestId || '',
        FFT_NANO_CODING_HINT: codingHint,
        FFT_NANO_IS_MAIN: isMain ? '1' : '0',
        ...(input.isSubagent ? { FFT_NANO_SUBAGENT: '1' } : {}),
      };

      const sandboxed = wrapWithSandbox(piExecutable, piArgs, {
        cwd: wp.groupDir,
        allowedPaths: [wp.groupDir, wp.piHomeDir, wp.ipcDir],
        env: env as Record<string, string>,
      });

      const child = spawn(sandboxed.command, sandboxed.args, {
        cwd: wp.groupDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      activeChild = child;

      let stdout = '';
      let stderr = '';
      let lineBuffer = '';
      let assistantSoFar = '';
      let thinkingSoFar = '';
      let streamedDraft = false;
      let stdoutTruncated = false;
      const toolTracker = createToolTrackerState();

      const canStreamTelegramDraft =
        isTelegramChatJid(input.chatJid) &&
        !input.isScheduledTask &&
        !isHeartbeatRun &&
        input.suppressPreviewStreaming !== true;
      const draftId = deriveTelegramDraftId(
        `${input.chatJid}:${input.requestId || `run-${Date.now()}`}`,
      );
      const draftMinIntervalMs = Math.max(
        400,
        Number.parseInt(
          process.env.FFT_NANO_TELEGRAM_DRAFT_MIN_MS || '1000',
          10,
        ) || 1000,
      );
      let lastDraftSentAt = 0;
      let lastDraftText = '';
      const maybeSendDraft = (force = false) => {
        if (!canStreamTelegramDraft || !assistantSoFar) return;
        const now = Date.now();
        if (!force && now - lastDraftSentAt < draftMinIntervalMs) return;
        let previewText = assistantSoFar;
        if (input.showReasoning && thinkingSoFar) {
          const thinkingBlock =
            thinkingSoFar.length > 600
              ? `...${thinkingSoFar.slice(-597)}`
              : thinkingSoFar;
          previewText = `Reasoning:\n\`\`\`\n${thinkingBlock}\n\`\`\`\n\n${assistantSoFar}`;
        }
        const nextDraftText = normalizeTelegramDraftText(previewText);
        if (nextDraftText === lastDraftText) return;
        const requestId = (input.requestId || '').trim();
        if (!requestId) return;
        hostEventBus.publish({
          kind: 'telegram_preview_requested',
          id: createHostEventId('preview'),
          createdAt: new Date(now).toISOString(),
          source: 'pi-runner',
          chatJid: input.chatJid,
          requestId,
          text: nextDraftText,
        });
        streamedDraft = true;
        lastDraftSentAt = now;
        lastDraftText = nextDraftText;
      };

      const sendExtensionUIResponse = (
        requestId: string,
        response: ExtensionUIResponse,
      ) => {
        if (child.stdin && !child.stdin.destroyed) {
          const payload = JSON.stringify({ type: 'extension_ui_response', id: requestId, ...response });
          child.stdin.write(payload + '\n');
          logger.debug(
            { requestId, group: group.name },
            'Sent extension UI response to pi',
          );
        }
      };

      const handleExtensionUIRequest = async (
        request: ExtensionUIRequest,
      ) => {
        logger.info(
          { requestId: request.id, method: request.method, title: request.title, group: group.name },
          'Extension UI request from pi',
        );

        // Fire-and-forget methods (notify, setStatus, etc.) -- no response needed
        const fireAndForgetMethods = ['notify', 'setStatus', 'setWidget', 'setTitle', 'set_editor_text'];
        if (fireAndForgetMethods.includes(request.method)) {
          // Publish to host event bus for optional UI rendering
          hostEventBus.publish({
            kind: 'extension_ui_notification',
            id: createHostEventId('ext-ui'),
            createdAt: new Date().toISOString(),
            source: 'pi-runner',
            chatJid: input.chatJid,
            requestId: input.requestId,
            request: request as unknown as Record<string, unknown>,
          });
          return;
        }

        // Dialog methods (confirm, select, input, editor) -- need user response
        if (!onExtensionUIRequest) {
          // No handler registered -- auto-deny for safety
          logger.warn(
            { requestId: request.id, method: request.method, group: group.name },
            'No extension UI handler registered, auto-denying',
          );
          if (request.method === 'confirm') {
            sendExtensionUIResponse(request.id, { confirmed: false });
          } else {
            sendExtensionUIResponse(request.id, { cancelled: true });
          }
          return;
        }

        try {
          const response = await onExtensionUIRequest(request);
          sendExtensionUIResponse(request.id, response);
        } catch (err) {
          logger.error(
            { requestId: request.id, method: request.method, err, group: group.name },
            'Extension UI handler failed, auto-denying',
          );
          if (request.method === 'confirm') {
            sendExtensionUIResponse(request.id, { confirmed: false });
          } else {
            sendExtensionUIResponse(request.id, { cancelled: true });
          }
        }
      };

      const processStdoutLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const event = JSON.parse(trimmed) as unknown;
          if (event && typeof event === 'object') {
            const evtType = (event as Record<string, unknown>).type;
            if (typeof evtType === 'string' && /tool/i.test(evtType)) {
              logger.debug(
                { evtType, group: group.name },
                'Pi stdout tool event',
              );
            }
          }

          // Handle extension UI requests (permission gate confirmations, etc.)
          const parsed = event as Record<string, unknown>;
          if (
            parsed.type === 'extension_ui_request' &&
            typeof parsed.id === 'string' &&
            typeof parsed.method === 'string'
          ) {
            handleExtensionUIRequest(parsed as unknown as ExtensionUIRequest);
            return;
          }

          const toolDelta = extractToolDeltaFromPiEvent(event, toolTracker);
          if (toolDelta) {
            logger.debug(
              {
                toolName: toolDelta.toolName,
                status: toolDelta.status,
                group: group.name,
              },
              'Parsed tool delta from Pi stdout',
            );
            if (toolDelta.status === 'start' && toolDelta.args) {
              const audit = auditToolExecution(
                toolDelta.toolName,
                toolDelta.args,
              );
              if (audit.flagged) {
                logger.warn(
                  {
                    group: group.name,
                    tool: toolDelta.toolName,
                    reason: audit.reason,
                  },
                  'Destructive command detected',
                );
              }
            }
            onRuntimeEvent?.({
              kind: 'tool',
              index: toolDelta.index,
              toolName: toolDelta.toolName,
              status: toolDelta.status,
              ...(toolDelta.args ? { args: toolDelta.args } : {}),
              ...(toolDelta.output ? { output: toolDelta.output } : {}),
              ...(toolDelta.error ? { error: toolDelta.error } : {}),
            });
          }
          if (input.showReasoning) {
            const thinkingDelta = extractThinkingDeltaFromPiEvent(event);
            if (thinkingDelta) {
              thinkingSoFar += thinkingDelta;
              maybeSendDraft(false);
            }
          }
          const delta = extractAssistantTextDeltaFromPiEvent(event);
          if (delta) {
            if (delta.kind === 'append') assistantSoFar += delta.text;
            else assistantSoFar = delta.text;
            maybeSendDraft(false);
          }
        } catch {
          // ignore non-json lines
        }
      };

      const ticker = canStreamTelegramDraft
        ? setInterval(() => maybeSendDraft(false), 1000)
        : null;

      child.stdout.on('data', (d: Buffer) => {
        const chunk = d.toString();
        if (!stdoutTruncated) {
          const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
          if (chunk.length > remaining) {
            stdout += chunk.slice(0, remaining);
            stdoutTruncated = true;
          } else {
            stdout += chunk;
          }
        }
        lineBuffer += chunk;
        while (true) {
          const newlineIdx = lineBuffer.indexOf('\n');
          if (newlineIdx === -1) break;
          const line = lineBuffer.slice(0, newlineIdx);
          lineBuffer = lineBuffer.slice(newlineIdx + 1);
          processStdoutLine(line);
        }
      });

      child.stderr.on('data', (d: Buffer) => {
        if (stderr.length < STDERR_MAX_SIZE) {
          const chunk = d.toString();
          stderr += chunk.slice(0, STDERR_MAX_SIZE - stderr.length);
        }
      });

      child.on('close', (code) => {
        if (ticker) clearInterval(ticker);
        if (lineBuffer.trim()) processStdoutLine(lineBuffer);
        maybeSendDraft(true);
        resolve({ code, stdout, stderr, streamedDraft });
      });

      child.on('error', (err) => {
        if (ticker) clearInterval(ticker);
        resolve({ code: 1, stdout, stderr: String(err), streamedDraft });
      });
    });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (output: ContainerOutput) => {
      if (settled) return;
      settled = true;
      resolve(output);
    };

    if (abortSignal?.aborted) {
      finish({ status: 'error', result: null, error: 'Aborted by user' });
      return;
    }

    const groupTimeout =
      typeof group.containerConfig?.timeout === 'number' &&
      Number.isFinite(group.containerConfig.timeout) &&
      group.containerConfig.timeout > 0
        ? Math.floor(group.containerConfig.timeout)
        : 0;
    const configuredTimeout = Math.max(groupTimeout, CONTAINER_TIMEOUT);
    const timeoutMs = Math.max(configuredTimeout, IDLE_TIMEOUT + 30_000);

    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      killActiveChild();
      finish({
        status: 'error',
        result: null,
        error: `Pi runner timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    const onAbort = () => {
      clearTimeout(timeoutHandle);
      killActiveChild();
      finish({ status: 'error', result: null, error: 'Aborted by user' });
    };
    if (abortSignal) {
      abortSignal.addEventListener('abort', onAbort, { once: true });
    }

    const doRun = async () => {
      try {
        let res = effectiveInputNoContinue
          ? await runPi(false)
          : await runPi(true);
        if (!effectiveInputNoContinue && res.code !== 0) {
          const looksLikeNoSession =
            /no\s+previous\s+session|no\s+session/i.test(res.stderr);
          if (looksLikeNoSession) res = await runPi(false);
        }

        clearTimeout(timeoutHandle);
        if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
        if (settled) return;

        const duration = Date.now() - startTime;

        if (res.code !== 0) {
          const failedState: PromptRuntimeState = {
            ...readPromptRuntimeState(promptStatePath),
            lastPreflightDecision: preflightDecision,
            ...(isOverflowStyleError(res.stderr)
              ? { lastOverflowAt: new Date().toISOString() }
              : {}),
          };
          writePromptRuntimeState(promptStatePath, failedState);
          logger.error(
            {
              group: group.name,
              code: res.code,
              duration,
              stderr: res.stderr.slice(-500),
            },
            'Pi exited with error',
          );
          finish({
            status: 'error',
            result: null,
            error: res.stderr.trim() || `pi exited with code ${res.code}`,
          });
          return;
        }

        const parsed = parsePiJsonOutput({
          stdout: res.stdout,
          provider: input.provider,
          model: input.model,
        });
        const result = isTelegramChatJid(input.chatJid)
          ? parsed.result
          : appendToolVerboseSection(
              parsed.result,
              input.verboseMode,
              parsed.toolExecutions,
            );

        let finalResult: string | null = result;
        let finalStreamed = res.streamedDraft;

        if (isForceDelegateHint(codingHint) && !input.isScheduledTask) {
          const outDir = path.join(wp.groupDir, 'coder_runs');
          fs.mkdirSync(outDir, { recursive: true });
          const rid = input.requestId || `coder_${Date.now()}`;
          const maxInline = isTelegramChatJid(input.chatJid) ? 8000 : 3000;
          let sent = false;

          if (result.length <= maxInline) {
            hostEventBus.publish({
              kind: 'chat_delivery_requested',
              id: createHostEventId('deliver'),
              createdAt: new Date().toISOString(),
              source: 'pi-runner',
              chatJid: input.chatJid,
              text: result,
              ...(input.requestId ? { requestId: input.requestId } : {}),
            });
            sent = true;
          } else {
            const filePath = path.join(outDir, `${rid}.md`);
            try {
              fs.writeFileSync(filePath, result);
            } catch {
              /* ignore */
            }
            const preview = result.slice(0, Math.min(1200, result.length));
            hostEventBus.publish({
              kind: 'chat_delivery_requested',
              id: createHostEventId('deliver'),
              createdAt: new Date().toISOString(),
              source: 'pi-runner',
              chatJid: input.chatJid,
              text: `${rid}: output saved to ${filePath}\n\nPreview:\n${preview}\n\n(Ask me to paste the rest if needed.)`,
              ...(input.requestId ? { requestId: input.requestId } : {}),
            });
            sent = true;
          }

          if (sent) {
            finalResult = null;
            finalStreamed = true;
          }
        }

        logger.info(
          { group: group.name, duration, hasResult: !!finalResult },
          'Pi run completed',
        );

        const successState = readPromptRuntimeState(promptStatePath);
        successState.lastTotalTokens = parsed.usage?.totalTokens;
        successState.lastOverflowAt = undefined;
        if (effectiveInputNoContinue) {
          successState.sessionEpoch = Math.max(
            successState.sessionEpoch || 0,
            1,
          );
        }
        writePromptRuntimeState(promptStatePath, successState);

        finish({
          status: 'success',
          result: finalResult,
          streamed: finalStreamed,
          toolExecutions: parsed.toolExecutions,
          usage: parsed.usage,
          promptSummary: {
            cacheHit: systemPromptBuild.report.cacheHit,
            preflightDecision,
            manifestPath: latestManifestPath,
            finalPromptChars: systemPromptBuild.report.totalChars,
            basePromptHash: systemPromptBuild.report.basePromptHash,
          },
        });
      } catch (err) {
        clearTimeout(timeoutHandle);
        if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
        const error = err instanceof Error ? err.message : String(err);
        logger.error({ group: group.name, error }, 'Pi runner error');
        finish({ status: 'error', result: null, error });
      }
    };

    doRun();
  });
}

export function writeTasksSnapshot(
  groupFolder: string,
  isMain: boolean,
  tasks: Array<{
    id: string;
    groupFolder: string;
    prompt: string;
    schedule_type: string;
    schedule_value: string;
    status: string;
    next_run: string | null;
    context_mode?: string;
    session_target?: string | null;
    wake_mode?: string | null;
    delivery_mode?: string | null;
    timeout_seconds?: number | null;
  }>,
): void {
  let groupIpcDir: string;
  try {
    groupIpcDir = resolveGroupIpcPath(groupFolder);
  } catch (err) {
    logger.warn(
      { groupFolder, err },
      'Skipping tasks snapshot for invalid group folder',
    );
    return;
  }
  fs.mkdirSync(groupIpcDir, { recursive: true });
  const filteredTasks = isMain
    ? tasks
    : tasks.filter((t) => t.groupFolder === groupFolder);
  const tasksFile = path.join(groupIpcDir, 'current_tasks.json');
  fs.writeFileSync(tasksFile, JSON.stringify(filteredTasks, null, 2));
}

export interface AvailableGroup {
  jid: string;
  name: string;
  lastActivity: string;
  isRegistered: boolean;
}

export function writeGroupsSnapshot(
  groupFolder: string,
  isMain: boolean,
  groups: AvailableGroup[],
  registeredJids: Set<string>,
): void {
  let groupIpcDir: string;
  try {
    groupIpcDir = resolveGroupIpcPath(groupFolder);
  } catch (err) {
    logger.warn(
      { groupFolder, err },
      'Skipping groups snapshot for invalid group folder',
    );
    return;
  }
  fs.mkdirSync(groupIpcDir, { recursive: true });
  const visibleGroups = isMain ? groups : [];
  const groupsFile = path.join(groupIpcDir, 'available_groups.json');
  fs.writeFileSync(
    groupsFile,
    JSON.stringify(
      { groups: visibleGroups, lastSync: new Date().toISOString() },
      null,
      2,
    ),
  );
}
