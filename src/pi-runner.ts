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
import { syncProjectPiSkillsToGroupPiHome } from './pi-skills.js';
import { ensureMemoryScaffold } from './memory-paths.js';
import { ensureMainWorkspaceBootstrap } from './workspace-bootstrap.js';
import { auditToolExecution } from './bash-guard.js';
import { parsePiJsonOutput, type PiToolExecution } from './pi-json-parser.js';
import {
  createToolTrackerState,
  extractAssistantTextDeltaFromPiEvent,
  extractToolDeltaFromPiEvent,
} from './pi-stream-parser.js';
import { getPiApiKeyOverride } from './provider-auth.js';
import { buildSystemPrompt, type WorkspacePaths } from './system-prompt.js';
import { resolvePiExecutable } from './pi-executable.js';
import { wrapWithSandbox } from './sandbox.js';
import type { RegisteredGroup } from './types.js';
import { piRuntimeEvents } from './app-state.js';

export interface ContainerInput {
  prompt: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  secrets?: Record<string, string>;
  codingHint?: 'none' | 'auto' | 'force_delegate_execute' | 'force_delegate_plan';
  requestId?: string;
  memoryContext?: string;
  extraSystemPrompt?: string;
  provider?: string;
  model?: string;
  thinkLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  reasoningLevel?: 'off' | 'on' | 'stream';
  verboseMode?: 'off' | 'new' | 'all' | 'verbose';
  noContinue?: boolean;
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  error?: string;
  streamed?: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    provider?: string;
    model?: string;
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

type CodingHint = 'none' | 'auto' | 'force_delegate_execute' | 'force_delegate_plan';

function normalizeCodingHint(value: ContainerInput['codingHint']): CodingHint {
  if (value === 'force_delegate' as string) return 'force_delegate_execute';
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

const TELEGRAM_DRAFT_PREFIX = '...';
const TELEGRAM_DRAFT_MAX_LEN = 4096;

export function normalizeTelegramDraftText(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized) return '.';
  if (normalized.length <= TELEGRAM_DRAFT_MAX_LEN) return normalized;
  const suffixLen = Math.max(1, TELEGRAM_DRAFT_MAX_LEN - TELEGRAM_DRAFT_PREFIX.length);
  return `${TELEGRAM_DRAFT_PREFIX}${normalized.slice(-suffixLen)}`;
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

function writeIpcFile(dir: string, prefix: string, payload: Record<string, unknown>): boolean {
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

export function collectRuntimeSecrets(projectRoot: string): Record<string, string> {
  const envFile = path.join(projectRoot, '.env');
  const allowedVars = [
    'PI_BASE_URL', 'PI_API_KEY', 'PI_MODEL', 'PI_API',
    'FFT_NANO_RUNTIME_PROVIDER_PRESET',
    'OPENAI_API_KEY', 'OPENAI_BASE_URL',
    'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY',
    'GROQ_API_KEY', 'ZAI_API_KEY', 'MINIMAX_API_KEY',
    'KIMI_API_KEY', 'MODAL_API_KEY', 'NVIDIA_API_KEY',
    'FFT_NANO_DRY_RUN',
    'HA_URL', 'HA_TOKEN',
    'FFT_NANO_PROMPT_FILE_MAX_CHARS', 'FFT_NANO_PROMPT_TOTAL_MAX_CHARS',
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
  merged.FFT_NANO_PROMPT_FILE_MAX_CHARS = String(PARITY_CONFIG.workspace.bootstrapMaxChars);
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

function resolveWorkspacePaths(group: RegisteredGroup, isMain: boolean): WorkspacePaths & {
  piHomeDir: string;
  piAgentDir: string;
} {
  const groupDir = isMain
    ? MAIN_WORKSPACE_DIR
    : resolveGroupFolderPath(group.folder);
  const globalDir = path.join(GROUPS_DIR, 'global');
  const ipcDir = resolveGroupIpcPath(group.folder);
  const piHomeDir = path.join(DATA_DIR, 'pi', group.folder, '.pi');
  const piAgentDir = path.join(piHomeDir, 'agent-fft');

  return { groupDir, globalDir, ipcDir, piHomeDir, piAgentDir };
}

function ensureGroupDirs(wp: ReturnType<typeof resolveWorkspacePaths>, groupFolder: string, isMain: boolean): void {
  fs.mkdirSync(wp.groupDir, { recursive: true });
  fs.mkdirSync(wp.piHomeDir, { recursive: true });
  fs.mkdirSync(path.join(wp.ipcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(wp.ipcDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(wp.ipcDir, 'actions'), { recursive: true });
  fs.mkdirSync(path.join(wp.ipcDir, 'action_results'), { recursive: true });
  if (isMain) ensureMainWorkspaceSeed();
  else ensureMemoryScaffold(groupFolder);
}

function syncSkills(
  group: RegisteredGroup,
  piHomeDir: string,
  isMain: boolean,
): void {
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
  const { systemPrompt, prompt, useContinue, input, codingHint, secrets } = params;
  const args: string[] = ['--mode', 'json'];
  if (useContinue) args.push('-c');

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

  if (isForceDelegateHint(codingHint)) {
    const mode = codingHint === 'force_delegate_plan' ? 'plan' : 'execute';
    if (mode === 'plan') {
      args.push('--tools', 'read,grep,find,ls');
    } else {
      args.push('--tools', 'read,bash,edit,write,grep,find,ls');
    }
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
    logger.error({ groupName: group.name, groupFolder: group.folder, error }, 'Rejected run for invalid group folder');
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
        { group: group.name, chunksTotal: memory.chunksTotal, selectedK: memory.selectedK },
        'Built retrieval-gated memory context',
      );
    } catch (err) {
      logger.warn({ group: group.name, err }, 'Failed to build memory context');
    }
  }

  const isMain = input.isMain;
  const wp = resolveWorkspacePaths(group, isMain);
  ensureGroupDirs(wp, group.folder, isMain);
  syncSkills(group, wp.piHomeDir, isMain);

  const secrets = collectRuntimeSecrets(projectRoot);
  const systemPromptBuild = buildSystemPrompt(
    {
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
    },
    wp,
  );
  const systemPrompt = systemPromptBuild.text;
  logger.debug(
    {
      group: group.name,
      mode: systemPromptBuild.report.mode,
      chars: systemPromptBuild.report.totalChars,
      contextEntries: systemPromptBuild.report.contextEntries.length,
    },
    'System prompt built',
  );

  const prompt = input.isScheduledTask
    ? `[SCHEDULED TASK]\n${input.prompt}`
    : input.prompt;

  if (['1', 'true', 'yes'].includes((secrets.FFT_NANO_DRY_RUN || process.env.FFT_NANO_DRY_RUN || '').toLowerCase())) {
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
    setTimeout(() => { if (!ref.killed) ref.kill('SIGKILL'); }, 5_000);
  };

  const STDERR_MAX_SIZE = 1_048_576; // 1 MB

  const piExecutable = resolvePiExecutable();
  if (!piExecutable) {
    return {
      status: 'error',
      result: null,
      error: 'pi binary not found on PATH and no repo-local fallback exists. Set PI_PATH or install pi globally.',
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
      for (const key of ['PATH', 'HOME', 'TZ', 'TERM', 'LANG', 'SHELL', 'USER', 'TMPDIR'] as const) {
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
      };

      const sandboxed = wrapWithSandbox(piExecutable, piArgs, {
        cwd: wp.groupDir,
        allowedPaths: [wp.groupDir, wp.piHomeDir, wp.ipcDir],
        env: env as Record<string, string>,
      });

      const child = spawn(sandboxed.command, sandboxed.args, {
        cwd: wp.groupDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      activeChild = child;

      let stdout = '';
      let stderr = '';
      let lineBuffer = '';
      let assistantSoFar = '';
      let streamedDraft = false;
      let stdoutTruncated = false;
      const toolTracker = createToolTrackerState();

      const isHeartbeatRun = input.requestId?.startsWith('heartbeat-');
      const canStreamTelegramDraft =
        isTelegramChatJid(input.chatJid) && !input.isScheduledTask && !isHeartbeatRun;
      const draftId = deriveTelegramDraftId(
        `${input.chatJid}:${input.requestId || `run-${Date.now()}`}`,
      );
      const draftMinIntervalMs = Math.max(
        400,
        Number.parseInt(process.env.FFT_NANO_TELEGRAM_DRAFT_MIN_MS || '1000', 10) || 1000,
      );
      let lastDraftSentAt = 0;
      let lastDraftText = '';
      const maybeSendDraft = (force = false) => {
        if (!canStreamTelegramDraft || !assistantSoFar) return;
        const now = Date.now();
        if (!force && now - lastDraftSentAt < draftMinIntervalMs) return;
        const nextDraftText = normalizeTelegramDraftText(assistantSoFar);
        if (nextDraftText === lastDraftText) return;
        const requestId = (input.requestId || '').trim();
        if (!requestId) return;
        piRuntimeEvents.emit({
          kind: 'telegram_preview_update',
          payload: {
            chatJid: input.chatJid,
            requestId,
            text: nextDraftText,
          },
        });
        streamedDraft = true;
        lastDraftSentAt = now;
        lastDraftText = nextDraftText;
      };

      const processStdoutLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const event = JSON.parse(trimmed) as unknown;
          const toolDelta = extractToolDeltaFromPiEvent(event, toolTracker);
          if (toolDelta) {
            if (toolDelta.status === 'start' && toolDelta.args) {
              const audit = auditToolExecution(toolDelta.toolName, toolDelta.args);
              if (audit.flagged) {
                logger.warn(
                  { group: group.name, tool: toolDelta.toolName, reason: audit.reason },
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
        let res = input.noContinue ? await runPi(false) : await runPi(true);
        if (!input.noContinue && res.code !== 0) {
          const looksLikeNoSession = /no\s+previous\s+session|no\s+session/i.test(res.stderr);
          if (looksLikeNoSession) res = await runPi(false);
        }

        clearTimeout(timeoutHandle);
        if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
        if (settled) return;

        const duration = Date.now() - startTime;

        if (res.code !== 0) {
          logger.error(
            { group: group.name, code: res.code, duration, stderr: res.stderr.slice(-500) },
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
          : appendToolVerboseSection(parsed.result, input.verboseMode, parsed.toolExecutions);

        let finalResult: string | null = result;
        let finalStreamed = res.streamedDraft;

        if (isForceDelegateHint(codingHint) && !input.isScheduledTask) {
          const outDir = path.join(wp.groupDir, 'coder_runs');
          fs.mkdirSync(outDir, { recursive: true });
          const rid = input.requestId || `coder_${Date.now()}`;
          const maxInline = isTelegramChatJid(input.chatJid) ? 8000 : 3000;
          let sent = false;

          if (result.length <= maxInline) {
            piRuntimeEvents.emit({
              kind: 'agent_message',
              payload: {
                chatJid: input.chatJid,
                text: result,
                ...(input.requestId ? { requestId: input.requestId } : {}),
              },
            });
            sent = true;
          } else {
            const filePath = path.join(outDir, `${rid}.md`);
            try { fs.writeFileSync(filePath, result); } catch { /* ignore */ }
            const preview = result.slice(0, Math.min(1200, result.length));
            piRuntimeEvents.emit({
              kind: 'agent_message',
              payload: {
                chatJid: input.chatJid,
                text: `${rid}: output saved to ${filePath}\n\nPreview:\n${preview}\n\n(Ask me to paste the rest if needed.)`,
                ...(input.requestId ? { requestId: input.requestId } : {}),
              },
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

        finish({
          status: 'success',
          result: finalResult,
          streamed: finalStreamed,
          usage: parsed.usage,
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
    logger.warn({ groupFolder, err }, 'Skipping tasks snapshot for invalid group folder');
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
    logger.warn({ groupFolder, err }, 'Skipping groups snapshot for invalid group folder');
    return;
  }
  fs.mkdirSync(groupIpcDir, { recursive: true });
  const visibleGroups = isMain ? groups : [];
  const groupsFile = path.join(groupIpcDir, 'available_groups.json');
  fs.writeFileSync(
    groupsFile,
    JSON.stringify({ groups: visibleGroups, lastSync: new Date().toISOString() }, null, 2),
  );
}
