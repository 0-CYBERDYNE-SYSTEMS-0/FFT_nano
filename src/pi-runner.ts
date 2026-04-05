import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  DATA_DIR,
  FFT_NANO_JITTER_FACTOR,
  FFT_NANO_MAX_RETRIES,
  FFT_NANO_PROVIDER_FALLBACK_ENABLED,
  FFT_NANO_PROVIDER_FALLBACK_ORDER,
  FFT_NANO_RETRY_BASE_DELAY_MS,
  FFT_NANO_RETRY_MAX_DELAY_MS,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
  MAIN_WORKSPACE_DIR,
  PARITY_CONFIG,
  TIMEZONE,
} from './config.js';
import {
  getEffectiveTimezone,
} from './time-context.js';
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
  piExecutableOverride?: string;
  showReasoning?: boolean;
  skipPromptPreflight?: boolean;
  suppressPreviewStreaming?: boolean;
  lifecyclePolicyOverride?: {
    hardTimeoutMs?: number;
    staleAfterMs?: number | null;
    toolActiveStaleMs?: number | null;
    waitStateStaleMs?: number | null;
    allowFreshSessionFallback?: boolean;
  };
  effectiveTimezone?: string;
  // Internal guardrail for provider fallback sequencing.
  attemptedProviders?: string[];
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

export type ContainerProgressEvent =
  | {
      kind: 'spawn';
      at: number;
      pid: number | null;
      resumed: boolean;
    }
  | {
      kind: 'stdout';
      at: number;
    }
  | {
      kind: 'assistant';
      at: number;
    }
  | {
      kind: 'thinking';
      at: number;
    }
  | {
      kind: 'wait';
      at: number;
      reason: 'extension_ui';
    }
  | {
      kind: 'tool';
      at: number;
      toolName: string;
      status: 'start' | 'ok' | 'error';
    }
  | {
      kind: 'retry_fresh';
      at: number;
      reason: 'stale_no_progress';
    }
  | {
      kind: 'stale';
      at: number;
      reason: 'stale_no_progress';
      retryingFresh: boolean;
    }
  | {
      kind: 'retry_delay';
      at: number;
      delayMs: number;
      attempt: number;
      reason: string;
    }
  | {
      kind: 'retry_exhausted';
      at: number;
      attempts: number;
      finalError: string;
    }
  | {
      kind: 'retry_provider_switch';
      at: number;
      fromProvider: string;
      toProvider: string;
    };

export interface ExtensionUIRequest {
  type?: 'extension_ui_request';
  id: string;
  method: string;
  title?: string;
  message?: string;
  timeout?: number;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  notifyType?: 'info' | 'warning' | 'error';
  statusKey?: string;
  statusText?: string;
  widgetKey?: string;
  widgetLines?: string[];
  widgetPlacement?: string;
  text?: string;
}

export interface ExtensionUIResponse {
  id?: string;
  confirmed?: boolean;
  cancelled?: boolean;
  value?: string;
}

export function shouldBuildRetrievedMemoryContext(input: {
  isMain: boolean;
}): boolean {
  return MEMORY_RETRIEVAL_GATE_ENABLED && input.isMain;
}

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

function parseRuntimeMs(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function isHeartbeatRequest(requestId: string | undefined): boolean {
  return (requestId || '').startsWith('heartbeat-');
}

function isInteractivePiRun(params: {
  input: ContainerInput;
  codingHint: CodingHint;
}): boolean {
  return (
    !params.input.isScheduledTask &&
    !params.input.isSubagent &&
    !isHeartbeatRequest(params.input.requestId) &&
    !isForceDelegateHint(params.codingHint) &&
    params.input.toolMode !== 'read_only'
  );
}

function resolvePiRunLifecyclePolicy(params: {
  input: ContainerInput;
  codingHint: CodingHint;
  groupTimeoutMs: number;
}): {
  hardTimeoutMs: number;
  staleAfterMs: number | null;
  toolActiveStaleMs: number | null;
  waitStateStaleMs: number | null;
  allowFreshSessionFallback: boolean;
} {
  const applyOverride = (policy: {
    hardTimeoutMs: number;
    staleAfterMs: number | null;
    toolActiveStaleMs: number | null;
    waitStateStaleMs: number | null;
    allowFreshSessionFallback: boolean;
  }) => ({
    hardTimeoutMs:
      params.input.lifecyclePolicyOverride?.hardTimeoutMs ?? policy.hardTimeoutMs,
    staleAfterMs:
      params.input.lifecyclePolicyOverride?.staleAfterMs ?? policy.staleAfterMs,
    toolActiveStaleMs:
      params.input.lifecyclePolicyOverride?.toolActiveStaleMs ??
      policy.toolActiveStaleMs,
    waitStateStaleMs:
      params.input.lifecyclePolicyOverride?.waitStateStaleMs ??
      policy.waitStateStaleMs,
    allowFreshSessionFallback:
      params.input.lifecyclePolicyOverride?.allowFreshSessionFallback ??
      policy.allowFreshSessionFallback,
  });

  if (isHeartbeatRequest(params.input.requestId)) {
    return applyOverride({
      hardTimeoutMs: parseRuntimeMs(
        process.env.FFT_NANO_HEARTBEAT_TIMEOUT_MS,
        5 * 60 * 1000,
        1_000,
        CONTAINER_TIMEOUT,
      ),
      staleAfterMs: null,
      toolActiveStaleMs: null,
      waitStateStaleMs: null,
      allowFreshSessionFallback: false,
    });
  }

  const interactive = isInteractivePiRun(params);
  if (!interactive) {
    const configuredTimeout = Math.max(params.groupTimeoutMs, CONTAINER_TIMEOUT);
    return applyOverride({
      hardTimeoutMs: Math.max(configuredTimeout, IDLE_TIMEOUT + 30_000),
      staleAfterMs: null,
      toolActiveStaleMs: null,
      waitStateStaleMs: null,
      allowFreshSessionFallback: false,
    });
  }

  const defaultInteractiveTimeoutMs = parseRuntimeMs(
    process.env.FFT_NANO_INTERACTIVE_TIMEOUT_MS,
    10 * 60 * 1000,
    1_000,
    CONTAINER_TIMEOUT,
  );
  const hardTimeoutMs =
    params.groupTimeoutMs > 0
      ? Math.min(params.groupTimeoutMs, defaultInteractiveTimeoutMs)
      : defaultInteractiveTimeoutMs;
  const staleAfterMs = parseRuntimeMs(
    process.env.FFT_NANO_INTERACTIVE_STALE_MS,
    90_000,
    100,
    Math.max(100, hardTimeoutMs - 100),
  );
  const toolActiveStaleMs = parseRuntimeMs(
    process.env.FFT_NANO_INTERACTIVE_TOOL_STALE_MS,
    Math.min(Math.max(100, hardTimeoutMs - 100), Math.max(staleAfterMs, 5 * 60 * 1000)),
    100,
    Math.max(100, hardTimeoutMs - 100),
  );
  const waitStateStaleMs = parseRuntimeMs(
    process.env.FFT_NANO_INTERACTIVE_WAIT_STALE_MS,
    Math.min(Math.max(100, hardTimeoutMs - 100), Math.max(staleAfterMs, 3 * 60 * 1000)),
    100,
    Math.max(100, hardTimeoutMs - 100),
  );

  return applyOverride({
    hardTimeoutMs,
    staleAfterMs,
    toolActiveStaleMs,
    waitStateStaleMs,
    allowFreshSessionFallback: true,
  });
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
  const candidates = [
    path.resolve(process.cwd(), 'src', 'extensions', 'fft-permission-gate.ts'),
    path.resolve(process.cwd(), 'dist', 'extensions', 'fft-permission-gate.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

type PiTransportMode = 'json' | 'rpc';

function buildPiArgs(params: {
  systemPrompt: string;
  prompt: string;
  useContinue: boolean;
  input: ContainerInput;
  codingHint: CodingHint;
  piAgentDir: string;
  secrets: Record<string, string>;
  transportMode: PiTransportMode;
}): string[] {
  const {
    systemPrompt,
    prompt,
    useContinue,
    input,
    codingHint,
    secrets,
    transportMode,
  } = params;
  const args: string[] = ['--mode', transportMode];
  if (useContinue) args.push('-c');

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

  if (transportMode === 'json') {
    args.push(prompt);
  }
  return args;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getProviderFallbackCandidates(params: {
  primaryProvider: string;
  configuredOrder: string[];
  attemptedProviders?: string[];
}): string[] {
  const attempted = new Set(
    [...(params.attemptedProviders ?? []), params.primaryProvider]
      .map((provider) => provider.trim())
      .filter(Boolean),
  );
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const provider of params.configuredOrder) {
    const normalized = provider.trim();
    if (!normalized || attempted.has(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    candidates.push(normalized);
  }
  return candidates;
}

type RunErrorClass = 'rate_limit' | 'timeout' | 'unknown' | 'non_retryable';

function classifyRunError(stderr: string, code: number | null): RunErrorClass {
  // Stale timer already retries via code 75 — treat as retryable 'unknown'
  if (code === 75 || code === 76) return 'unknown';
  if (/FFT_NANO_STALE_RETRY/i.test(stderr)) return 'unknown';

  // Fresh interactive runs that trip the stale timer should fail immediately.
  if (/Pi run stalled before producing progress/i.test(stderr)) {
    return 'non_retryable';
  }

  // Explicit rate limit
  if (/429|rate\s*limit|too\s*many\s*requests/i.test(stderr)) return 'rate_limit';

  // Timeout / failover codes
  if (/408|502|503|504|ETIMEDOUT|ECONNRESET|ECONNABORTED/i.test(stderr)) return 'timeout';

  // Hard failures — never retry
  if (
    /context\s*(length|size)\s*exceeded|overflow|token\s*limit/i.test(stderr)
  ) return 'non_retryable';
  if (/401|403|invalid.*api.*key|auth|unauthorized/i.test(stderr))
    return 'non_retryable';
  if (/SIGKILL|killed/i.test(stderr)) return 'non_retryable';

  // Empty or unclassifiable — retry once
  if (!stderr.trim()) return 'unknown';

  return 'unknown';
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
  onProgressEvent?: (event: ContainerProgressEvent) => void,
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
  if (shouldBuildRetrievedMemoryContext(input)) {
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

  const effectiveTimezone = getEffectiveTimezone(input.effectiveTimezone);

  const cachedBase = PARITY_CONFIG.prompt.cacheEnabled
    ? promptState.cacheEntries[
        `${isMain ? 'main' : 'group'}:${input.isScheduledTask ? 'minimal' : 'full'}:${codingHint}`
      ]
    : undefined;
  let systemPromptBuild = buildSystemPrompt(baseInput, wp, {
    delegationExtensionAvailable: true,
    skillCatalogMaxChars: PARITY_CONFIG.prompt.skillCatalogMaxChars,
    timezone: effectiveTimezone,
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
        timezone: effectiveTimezone,
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

  const piExecutable = input.piExecutableOverride || resolvePiExecutable();
  if (!piExecutable) {
    return {
      status: 'error',
      result: null,
      error:
        'pi binary not found on PATH and no repo-local fallback exists. Set PI_PATH or install pi globally.',
    };
  }

  const groupTimeout =
    typeof group.containerConfig?.timeout === 'number' &&
    Number.isFinite(group.containerConfig.timeout) &&
    group.containerConfig.timeout > 0
      ? Math.floor(group.containerConfig.timeout)
      : 0;
  const lifecyclePolicy = resolvePiRunLifecyclePolicy({
    input,
    codingHint,
    groupTimeoutMs: groupTimeout,
  });

  const runPi = (useContinue: boolean) =>
    new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
      streamedDraft: boolean;
      retryFresh?: boolean;
    }>((resolve) => {
      let localSettled = false;
      // Set true when stale timer fires and we kill the child intentionally.
      // Prevents the child's close event (SIGTERM) from overwriting the stale result.
      let staleKillInProgress = false;
      const transportMode: PiTransportMode = onExtensionUIRequest
        ? 'rpc'
        : 'json';
      const piArgs = buildPiArgs({
        systemPrompt,
        prompt,
        useContinue,
        input: payload,
        codingHint,
        piAgentDir: wp.piAgentDir,
        secrets,
        transportMode,
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
      const closeRpcInput = () => {
        if (
          transportMode !== 'rpc' ||
          !child.stdin ||
          child.stdin.destroyed ||
          child.stdin.writableEnded
        ) {
          return;
        }
        child.stdin.end();
      };
      if (transportMode === 'json') {
        child.stdin.end();
      } else if (child.stdin && !child.stdin.destroyed) {
        child.stdin.write(
          JSON.stringify({
            id: input.requestId || `prompt-${Date.now()}`,
            type: 'prompt',
            message: prompt,
          }) + '\n',
        );
      }
      activeChild = child;
      onProgressEvent?.({
        kind: 'spawn',
        at: Date.now(),
        pid: child.pid ?? null,
        resumed: useContinue,
      });

      let stdout = '';
      let stderr = '';
      let lineBuffer = '';
      let assistantSoFar = '';
      let thinkingSoFar = '';
      let streamedDraft = false;
      let stdoutTruncated = false;
      let sawMeaningfulProgress = false;
      let sawToolActivity = false;
      const initialStaleDelayMs = lifecyclePolicy.staleAfterMs
        ? useContinue
          ? lifecyclePolicy.staleAfterMs
          : lifecyclePolicy.staleAfterMs +
            parseRuntimeMs(
              process.env.FFT_NANO_INTERACTIVE_STARTUP_GRACE_MS,
              750,
              0,
              5_000,
            )
        : null;
      const toolTracker = createToolTrackerState();
      let staleTimer: NodeJS.Timeout | null = null;
      let ticker: NodeJS.Timeout | null = null;

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
      const publishDraftPreview = (text: string, force = false) => {
        if (!canStreamTelegramDraft) return;
        const normalized = normalizeTelegramDraftText(text);
        if (!normalized) return;
        const now = Date.now();
        if (!force && now - lastDraftSentAt < draftMinIntervalMs) return;
        if (normalized === lastDraftText) return;
        const requestId = (input.requestId || '').trim();
        if (!requestId) return;
        hostEventBus.publish({
          kind: 'telegram_preview_requested',
          id: createHostEventId('preview'),
          createdAt: new Date(now).toISOString(),
          source: 'pi-runner',
          chatJid: input.chatJid,
          requestId,
          text: normalized,
        });
        streamedDraft = true;
        lastDraftSentAt = now;
        lastDraftText = normalized;
      };
      const settleLocal = (value: {
        code: number | null;
        stdout: string;
        stderr: string;
        streamedDraft: boolean;
        retryFresh?: boolean;
      }) => {
        if (localSettled) return;
        localSettled = true;
        if (ticker) clearInterval(ticker);
        if (staleTimer) clearTimeout(staleTimer);
        resolve(value);
      };

      const armStaleTimer = (
        delayMs: number | null = lifecyclePolicy.staleAfterMs,
      ) => {
        if (!delayMs) return;
        if (staleTimer) clearTimeout(staleTimer);
        staleTimer = setTimeout(() => {
          const now = Date.now();
          const retryFresh =
            useContinue &&
            lifecyclePolicy.allowFreshSessionFallback &&
            !sawMeaningfulProgress;
          logger.warn(
            {
              group: group.name,
              requestId: input.requestId,
              pid: child.pid,
              resumed: useContinue,
              staleAfterMs: lifecyclePolicy.staleAfterMs,
              retryFresh,
            },
            'Pi run stalled before producing progress',
          );
          onProgressEvent?.({
            kind: 'stale',
            at: now,
            reason: 'stale_no_progress',
            retryingFresh: retryFresh,
          });
          staleKillInProgress = true;
          killActiveChild();
          settleLocal({
            code: retryFresh ? 75 : sawMeaningfulProgress ? 76 : 1,
            stdout,
            stderr: retryFresh
              ? 'FFT_NANO_STALE_RETRY'
              : sawMeaningfulProgress
                ? 'FFT_NANO_STALE_RETRY_AFTER_PROGRESS'
                : 'Pi run stalled before producing progress',
            streamedDraft,
            retryFresh,
          });
        }, delayMs);
      };

      const noteProgress = (
        event:
          | { kind: 'assistant'; at: number }
          | { kind: 'thinking'; at: number }
          | {
              kind: 'tool';
              at: number;
              toolName: string;
              status: 'start' | 'ok' | 'error';
            },
      ) => {
        sawMeaningfulProgress = true;
        onProgressEvent?.(event);
        if (event.kind === 'tool') {
          if (event.status === 'start') {
            sawToolActivity = true;
            armStaleTimer(lifecyclePolicy.toolActiveStaleMs);
            return;
          }
          // Tool completed; revert to normal interactive stale budget.
          sawToolActivity = false;
          armStaleTimer(lifecyclePolicy.staleAfterMs);
          return;
        }
        armStaleTimer(
          sawToolActivity
            ? lifecyclePolicy.toolActiveStaleMs
            : lifecyclePolicy.staleAfterMs,
        );
      };

      const noteActivity = (event?: { kind: 'stdout'; at: number }) => {
        if (event) onProgressEvent?.(event);
        armStaleTimer(
          sawToolActivity
            ? lifecyclePolicy.toolActiveStaleMs
            : lifecyclePolicy.staleAfterMs,
        );
      };

      const noteWaitState = (delayMs?: number, meaningful = true) => {
        if (meaningful) sawMeaningfulProgress = true;
        armStaleTimer(
          delayMs ??
            lifecyclePolicy.waitStateStaleMs ??
            lifecyclePolicy.staleAfterMs,
        );
      };

      const maybeSendDraft = (force = false) => {
        if (!assistantSoFar) return;
        let previewText = assistantSoFar;
        if (input.showReasoning && thinkingSoFar) {
          const thinkingBlock =
            thinkingSoFar.length > 600
              ? `...${thinkingSoFar.slice(-597)}`
              : thinkingSoFar;
          previewText = `Reasoning:\n\`\`\`\n${thinkingBlock}\n\`\`\`\n\n${assistantSoFar}`;
        }
        publishDraftPreview(previewText, force);
      };

      const sendExtensionUIResponse = (
        requestId: string,
        response: ExtensionUIResponse,
      ) => {
        if (!child.stdin || child.stdin.destroyed || child.stdin.writableEnded) {
          logger.warn(
            { requestId, group: group.name },
            'Cannot send extension UI response because pi stdin is unavailable',
          );
          return;
        }
        child.stdin.write(
          JSON.stringify({
            type: 'extension_ui_response',
            id: requestId,
            ...response,
          }) + '\n',
        );
      };

      const handleExtensionUIRequest = async (
        request: ExtensionUIRequest,
      ): Promise<void> => {
        logger.info(
          {
            requestId: request.id,
            method: request.method,
            title: request.title,
            group: group.name,
          },
          'Extension UI request from pi',
        );
        onProgressEvent?.({
          kind: 'wait',
          at: Date.now(),
          reason: 'extension_ui',
        });
        noteWaitState(
          Math.max(
            lifecyclePolicy.waitStateStaleMs ??
              lifecyclePolicy.staleAfterMs ??
              0,
            (request.timeout ?? 60_000) + 1_000,
          ),
        );

        const fireAndForgetMethods = new Set([
          'notify',
          'setStatus',
          'setWidget',
          'setTitle',
          'set_editor_text',
        ]);
        if (fireAndForgetMethods.has(request.method)) {
          return;
        }

        if (!onExtensionUIRequest) {
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
          const parsed = event as Record<string, unknown>;
          if (
            parsed.type === 'extension_ui_request' &&
            typeof parsed.id === 'string' &&
            typeof parsed.method === 'string'
          ) {
            void handleExtensionUIRequest(parsed as unknown as ExtensionUIRequest);
            return;
          }
          if (
            transportMode === 'rpc' &&
            parsed.type === 'response' &&
            parsed.command === 'prompt'
          ) {
            noteWaitState(undefined, false);
          }
          if (
            transportMode === 'rpc' &&
            ((parsed.type === 'response' &&
              parsed.command === 'prompt' &&
              parsed.success === false) ||
              parsed.type === 'agent_end')
          ) {
            closeRpcInput();
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
            noteProgress({
              kind: 'tool',
              at: Date.now(),
              toolName: toolDelta.toolName,
              status: toolDelta.status,
            });
          }
          if (input.showReasoning) {
            const thinkingDelta = extractThinkingDeltaFromPiEvent(event);
            if (thinkingDelta) {
              thinkingSoFar += thinkingDelta;
              noteProgress({ kind: 'thinking', at: Date.now() });
              maybeSendDraft(false);
            }
          }
          const delta = extractAssistantTextDeltaFromPiEvent(event);
          if (delta) {
            if (delta.kind === 'append') assistantSoFar += delta.text;
            else assistantSoFar = delta.text;
            noteProgress({ kind: 'assistant', at: Date.now() });
            maybeSendDraft(false);
          }
        } catch {
          // ignore non-json lines
        }
      };

      ticker = canStreamTelegramDraft
        ? setInterval(() => maybeSendDraft(false), 1000)
        : null;
      armStaleTimer(initialStaleDelayMs);

      child.stdout.on('data', (d: Buffer) => {
        const chunk = d.toString();
        noteActivity({ kind: 'stdout', at: Date.now() });
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
        if (localSettled) return;
        // When stale timer kills the child via SIGTERM, the close event fires
        // synchronously BEFORE the stale callback finishes calling settleLocal.
        // staleKillInProgress flag tells us the stale timer already fired.
        if (!staleKillInProgress) {
          if (lineBuffer.trim()) processStdoutLine(lineBuffer);
          maybeSendDraft(true);
          settleLocal({ code, stdout, stderr, streamedDraft });
        }
      });

      child.on('error', (err) => {
        settleLocal({ code: 1, stdout, stderr: String(err), streamedDraft });
      });
    });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (output: ContainerOutput) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(output);
    };

    if (abortSignal?.aborted) {
      finish({ status: 'error', result: null, error: 'Aborted by user' });
      return;
    }

    const timeoutMs = lifecyclePolicy.hardTimeoutMs;
    const timeoutHandle = setTimeout(() => {
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
        let attempt = 0;
        let delay = FFT_NANO_RETRY_BASE_DELAY_MS;
        let lastRes: Awaited<ReturnType<typeof runPi>> | null = null;
        let exhausted = false;
        let finalError = '';
        let didFreshRetry = false;

        while (attempt < FFT_NANO_MAX_RETRIES) {
          const useContinue = attempt === 0 && !effectiveInputNoContinue;
          lastRes = await runPi(useContinue);

          if (lastRes.code === 0) break; // success

          const errClass = classifyRunError(lastRes.stderr, lastRes.code);

          // Hard fail — do not retry
          if (errClass === 'non_retryable') {
            finalError = lastRes.stderr.trim() || `pi exited with code ${lastRes.code}`;
            break;
          }

          // Stale on continue session → one fresh retry, then exit without backoff
          if (lastRes.retryFresh && useContinue) {
            didFreshRetry = true;
            const retryAt = Date.now();
            logger.warn(
              { group: group.name, requestId: input.requestId, retryAt },
              'Retrying pi run with fresh session after stale continue attempt',
            );
            onProgressEvent?.({
              kind: 'retry_fresh',
              at: retryAt,
              reason: 'stale_no_progress',
            });
            lastRes = await runPi(false);
            if (lastRes.code === 0) break;
            finalError = lastRes.stderr.trim() || `pi exited with code ${lastRes.code}`;
            break;
          }

          // If we already did a fresh retry, no more retries — exit
          if (didFreshRetry) {
            exhausted = true;
            finalError = lastRes!.stderr.trim() || `pi exited with code ${lastRes!.code}`;
            break;
          }

          attempt++;
          if (attempt >= FFT_NANO_MAX_RETRIES) {
            exhausted = true;
            finalError = lastRes!.stderr.trim() || `pi exited with code ${lastRes!.code}`;
            break;
          }

          // Exponential backoff with full jitter
          delay = Math.min(delay * 2, FFT_NANO_RETRY_MAX_DELAY_MS);
          const jitter = Math.random() * delay * FFT_NANO_JITTER_FACTOR;
          const delayMs = delay + jitter;

          onProgressEvent?.({
            kind: 'retry_delay',
            at: Date.now(),
            delayMs,
            attempt,
            reason: errClass,
          });

          await sleep(delayMs);
        }

        // If all retries exhausted, try provider fallback chain
        if (
          exhausted &&
          FFT_NANO_PROVIDER_FALLBACK_ENABLED &&
          FFT_NANO_PROVIDER_FALLBACK_ORDER.length > 0
        ) {
          const primaryProvider =
            input.provider ||
            secrets.PI_API ||
            process.env.PI_API ||
            '';
          const fallbackProviders = getProviderFallbackCandidates({
            primaryProvider,
            configuredOrder: FFT_NANO_PROVIDER_FALLBACK_ORDER,
            attemptedProviders: input.attemptedProviders,
          });

          for (const fallbackProvider of fallbackProviders) {
            onProgressEvent?.({
              kind: 'retry_provider_switch',
              at: Date.now(),
              fromProvider: primaryProvider,
              toProvider: fallbackProvider,
            });

            // Recursive call with fallback provider — runs full retry loop
            const fallbackResult = await runContainerAgent(
              group,
              {
                ...input,
                provider: fallbackProvider,
                noContinue: true, // fresh session on fallback
                attemptedProviders: [
                  ...(input.attemptedProviders ?? []),
                  primaryProvider,
                ].filter(Boolean),
              },
              abortSignal,
              onRuntimeEvent,
              onExtensionUIRequest,
              onProgressEvent,
            );

            if (fallbackResult.status === 'success') {
              clearTimeout(timeoutHandle);
              if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
              if (settled) return;
              finish(fallbackResult);
              return;
            }
            // Try next fallback
            finalError = fallbackResult.error || 'fallback provider failed';
          }
        }

        clearTimeout(timeoutHandle);
        if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
        if (settled) return;

        const duration = Date.now() - startTime;

        if (lastRes && lastRes.code !== 0) {
          const failedState: PromptRuntimeState = {
            ...readPromptRuntimeState(promptStatePath),
            lastPreflightDecision: preflightDecision,
            ...(isOverflowStyleError(lastRes.stderr)
              ? { lastOverflowAt: new Date().toISOString() }
              : {}),
          };
          writePromptRuntimeState(promptStatePath, failedState);

          if (exhausted) {
            onProgressEvent?.({
              kind: 'retry_exhausted',
              at: Date.now(),
              attempts: FFT_NANO_MAX_RETRIES,
              finalError,
            });
          }

          logger.error(
            { group: group.name, code: lastRes.code, duration, stderr: lastRes.stderr.slice(-500) },
            'Pi exited with error',
          );
          finish({
            status: 'error',
            result: null,
            error: finalError || lastRes.stderr.trim() || `pi exited with code ${lastRes.code}`,
          });
          return;
        }

        // Success path (lastRes.code === 0)
        const parsed = parsePiJsonOutput({
          stdout: lastRes!.stdout,
          provider: input.provider,
          model: input.model,
        });
        const result = isTelegramChatJid(input.chatJid)
          ? parsed.result
          : appendToolVerboseSection(parsed.result, input.verboseMode, parsed.toolExecutions);

        let finalResult: string | null = result;
        let finalStreamed = lastRes!.streamedDraft;

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
