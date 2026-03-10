/**
 * FFT_nano Agent Runner (Pi runtime)
 *
 * Runs inside a container. Reads JSON input on stdin and runs pi (pi-coding-agent).
 * Outputs a JSON result between sentinel markers on stdout.
 */

import { spawn } from 'child_process';
import fs from 'fs';

import { runDelegatedCodingWorker } from './coder-worker.js';
import { parsePiJsonOutput, type PiToolExecution } from './pi-json-parser.js';
import {
  createToolTrackerState,
  extractAssistantTextDeltaFromPiEvent,
  extractToolDeltaFromPiEvent,
} from './pi-stream-parser.js';
import {
  PI_AGENT_FFT_DIR,
  PI_ON_PI_EXTENSION_PATH,
  WORKSPACE_GROUP_DIR,
  WORKSPACE_IPC_MESSAGES_DIR,
} from './runtime-paths.js';
import {
  deriveTelegramDraftId,
  normalizeTelegramDraftText,
  writeIpcTelegramDraftUpdate,
} from './telegram-draft.js';
import {
  buildSystemPrompt as buildSystemPromptArchitecture,
  type SystemPromptReport,
} from './system-prompt.js';

interface ContainerInput {
  prompt: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  secrets?: Record<string, string>;
  provider?: string;
  model?: string;
  thinkLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  reasoningLevel?: 'off' | 'on' | 'stream';
  verboseMode?: 'off' | 'new' | 'all' | 'verbose';
  noContinue?: boolean;
  memoryContext?: string;
  extraSystemPrompt?: string;
  codingHint?:
    | 'none'
    | 'force_delegate_execute'
    | 'force_delegate_plan'
    | 'auto'
    | 'force_delegate';
  requestId?: string;
}

type CodingHint =
  | 'none'
  | 'auto'
  | 'force_delegate_execute'
  | 'force_delegate_plan';

interface NormalizedContainerInput extends Omit<ContainerInput, 'codingHint'> {
  codingHint: CodingHint;
  thinkLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  reasoningLevel?: 'off' | 'on' | 'stream';
  verboseMode?: 'off' | 'new' | 'all' | 'verbose';
  noContinue?: boolean;
}

interface ContainerOutput {
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

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

const OUTPUT_START_MARKER = '---FFT_NANO_OUTPUT_START---';
const OUTPUT_END_MARKER = '---FFT_NANO_OUTPUT_END---';
const RUNTIME_EVENT_PREFIX = '[fft_nano_event]';

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

function writeRuntimeEvent(event: {
  kind: 'tool';
  index: number;
  toolName: string;
  status: 'start' | 'ok' | 'error';
  args?: string;
  output?: string;
  error?: string;
}): void {
  console.error(`${RUNTIME_EVENT_PREFIX}${JSON.stringify(event)}`);
}

function normalizeCodingHint(value: ContainerInput['codingHint']): CodingHint {
  if (value === 'force_delegate') return 'force_delegate_execute';
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

function normalizeThinkLevel(
  value: ContainerInput['thinkLevel'],
): 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | undefined {
  if (
    value === 'off' ||
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
  ) {
    return value;
  }
  return undefined;
}

function normalizeReasoningLevel(
  value: ContainerInput['reasoningLevel'],
): 'off' | 'on' | 'stream' | undefined {
  if (value === 'off' || value === 'on' || value === 'stream') {
    return value;
  }
  return undefined;
}

function normalizeVerboseMode(
  value: ContainerInput['verboseMode'],
): 'off' | 'new' | 'all' | 'verbose' | undefined {
  if (value === 'off' || value === 'new' || value === 'all' || value === 'verbose') {
    return value;
  }
  return undefined;
}

function normalizeInput(input: ContainerInput): NormalizedContainerInput {
  return {
    ...input,
    codingHint: normalizeCodingHint(input.codingHint),
    thinkLevel: normalizeThinkLevel(input.thinkLevel),
    reasoningLevel: normalizeReasoningLevel(input.reasoningLevel),
    verboseMode: normalizeVerboseMode(input.verboseMode),
    noContinue: input.noContinue === true,
  };
}

function isForceDelegateHint(hint: CodingHint): boolean {
  return hint === 'force_delegate_execute' || hint === 'force_delegate_plan';
}

function getForcedDelegateMode(hint: CodingHint): 'execute' | 'plan' | null {
  if (hint === 'force_delegate_execute') return 'execute';
  if (hint === 'force_delegate_plan') return 'plan';
  return null;
}

function isTelegramChatJid(chatJid: string): boolean {
  return chatJid.startsWith('telegram:');
}

function writeIpcMessage(chatJid: string, text: string): boolean {
  try {
    const dir = WORKSPACE_IPC_MESSAGES_DIR;
    fs.mkdirSync(dir, { recursive: true });
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const tmp = `${dir}/.tmp_${ts}_${rand}.json`;
    const out = `${dir}/msg_${ts}_${rand}.json`;
    fs.writeFileSync(tmp, JSON.stringify({ type: 'message', chatJid, text }));
    fs.renameSync(tmp, out);
    return true;
  } catch {
    return false;
  }
}

function buildSystemPrompt(
  input: NormalizedContainerInput,
): { text: string; report: SystemPromptReport } {
  return buildSystemPromptArchitecture(input, {
    delegationExtensionAvailable: fs.existsSync(PI_ON_PI_EXTENSION_PATH),
  });
}

function getPiArgs(
  systemPrompt: string,
  prompt: string,
  useContinue: boolean,
  loadDelegationExtension: boolean,
  input: NormalizedContainerInput,
): string[] {
  const args: string[] = ['--mode', 'json'];
  if (useContinue) args.push('-c');

  const model = input.model || process.env.PI_MODEL;
  const provider = input.provider || process.env.PI_API;
  const apiKey = process.env.PI_API_KEY;

  if (provider) args.push('--provider', provider);
  if (model) args.push('--model', model);
  if (input.thinkLevel) args.push('--thinking', input.thinkLevel);
  if (apiKey) args.push('--api-key', apiKey);

  // Always load extension when it exists: registers Ollama provider + delegation tool.
  if (fs.existsSync(PI_ON_PI_EXTENSION_PATH)) {
    args.push('--extension', PI_ON_PI_EXTENSION_PATH);
  }

  // Keep pi's default coding system prompt (tool behavior + conventions) and
  // append FFT-specific runtime context on top.
  args.push('--append-system-prompt', systemPrompt);
  args.push('--tools', 'read,bash,edit,write,grep,find,ls');
  args.push(prompt);

  return args;
}

function appendToolVerboseSection(
  baseResult: string,
  mode: 'off' | 'new' | 'all' | 'verbose' | undefined,
  toolExecutions: PiToolExecution[] | undefined,
): string {
  if (mode === 'off' || mode === 'new') return baseResult;
  if (!toolExecutions || toolExecutions.length === 0) return baseResult;

  const includeAll = mode === 'verbose';
  const selected = toolExecutions;
  if (selected.length === 0) return baseResult;

  const maxRows = includeAll ? 60 : 30;
  const truncated = selected.length > maxRows;
  const rows = selected.slice(0, maxRows).map((entry) => {
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
      `- ... ${selected.length - maxRows} additional item(s) omitted`,
    );
  }
  const section = [header, ...rows].join('\n');
  return baseResult ? `${baseResult}\n\n${section}` : section;
}

async function runPiAgent(
  systemPrompt: string,
  prompt: string,
  input: NormalizedContainerInput,
): Promise<{
  result: string;
  streamed: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    provider?: string;
    model?: string;
  };
}> {
  const loadDelegationExtension =
    input.isMain &&
    !input.isScheduledTask &&
    (isForceDelegateHint(input.codingHint) || input.codingHint === 'auto') &&
    fs.existsSync(PI_ON_PI_EXTENSION_PATH);
  const canStreamTelegramDraft =
    isTelegramChatJid(input.chatJid) && !input.isScheduledTask;
  const draftId = deriveTelegramDraftId(
    `${input.chatJid}:${input.requestId || `run-${Date.now()}`}`,
  );
  const draftMinIntervalMs = Math.max(
    400,
    Number.parseInt(process.env.FFT_NANO_TELEGRAM_DRAFT_MIN_MS || '1000', 10) ||
      1000,
  );

  const tryRun = (useContinue: boolean) =>
    new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
      streamedDraft: boolean;
    }>((resolve) => {
      const args = getPiArgs(
        systemPrompt,
        prompt,
        useContinue,
        loadDelegationExtension,
        input,
      );
      const env = {
        ...process.env,
        PI_CODING_AGENT_DIR: PI_AGENT_FFT_DIR,
        FFT_NANO_CHAT_JID: input.chatJid,
        FFT_NANO_REQUEST_ID: input.requestId || '',
        FFT_NANO_CODING_HINT: input.codingHint,
        FFT_NANO_IS_MAIN: input.isMain ? '1' : '0',
      };

      const child = spawn('pi', args, {
        cwd: WORKSPACE_GROUP_DIR,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let lineBuffer = '';
      let assistantSoFar = '';
      let streamedDraft = false;
      const toolTracker = createToolTrackerState();
      let lastDraftSentAt = 0;
      let lastDraftText = '';

      const maybeSendDraft = (force = false) => {
        if (!canStreamTelegramDraft) return;
        if (!assistantSoFar) return;
        const now = Date.now();
        if (!force && now - lastDraftSentAt < draftMinIntervalMs) return;
        const nextDraftText = normalizeTelegramDraftText(assistantSoFar);
        if (nextDraftText === lastDraftText) return;
        const ok = writeIpcTelegramDraftUpdate({
          chatJid: input.chatJid,
          requestId: input.requestId,
          draftId,
          text: nextDraftText,
        });
        if (!ok) return;
        streamedDraft = true;
        lastDraftSentAt = now;
        lastDraftText = nextDraftText;
      };

      const applyDelta = (delta: { kind: 'append' | 'replace'; text: string }) => {
        if (delta.kind === 'append') assistantSoFar += delta.text;
        else assistantSoFar = delta.text;
      };

      const processStdoutLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const event = JSON.parse(trimmed) as unknown;
          const toolDelta = extractToolDeltaFromPiEvent(event, toolTracker);
          if (toolDelta) {
            writeRuntimeEvent({
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
          if (!delta) return;
          applyDelta(delta);
          maybeSendDraft(false);
        } catch {
          // ignore non-json lines
        }
      };

      const ticker = canStreamTelegramDraft
        ? setInterval(() => {
            maybeSendDraft(false);
          }, 1000)
        : null;

      child.stdout.on('data', (d) => {
        const chunk = d.toString();
        stdout += chunk;
        lineBuffer += chunk;
        while (true) {
          const newlineIdx = lineBuffer.indexOf('\n');
          if (newlineIdx === -1) break;
          const line = lineBuffer.slice(0, newlineIdx);
          lineBuffer = lineBuffer.slice(newlineIdx + 1);
          processStdoutLine(line);
        }
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      child.on('close', (code) => {
        if (ticker) clearInterval(ticker);
        if (lineBuffer.trim()) {
          processStdoutLine(lineBuffer);
        }
        maybeSendDraft(true);
        resolve({ code, stdout, stderr, streamedDraft });
      });
      child.on('error', (err) => {
        if (ticker) clearInterval(ticker);
        resolve({ code: 1, stdout, stderr: String(err), streamedDraft });
      });
    });

  // Prefer continuing prior context unless caller requested a fresh run.
  let res = input.noContinue ? await tryRun(false) : await tryRun(true);
  if (!input.noContinue && res.code !== 0) {
    const looksLikeNoSession = /no\s+previous\s+session|no\s+session/i.test(res.stderr);
    if (looksLikeNoSession) res = await tryRun(false);
  }

  if (res.code !== 0) {
    throw new Error(res.stderr.trim() || `pi exited with code ${res.code}`);
  }

  if (res.streamedDraft) {
    log(`Sent Telegram draft updates for ${input.chatJid} (draft_id=${draftId})`);
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
  return { result, streamed: false, usage: parsed.usage };
}

async function main(): Promise<void> {
  let rawInput: ContainerInput;

  try {
    rawInput = JSON.parse(await readStdin()) as ContainerInput;
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`,
    });
    process.exit(1);
    return;
  }

  const input = normalizeInput(rawInput);
  for (const [key, value] of Object.entries(rawInput.secrets || {})) {
    process.env[key] = value;
  }

  const systemPromptBuild = buildSystemPrompt(input);
  const systemPrompt = systemPromptBuild.text;
  log(
    `System prompt built: mode=${systemPromptBuild.report.mode} chars=${systemPromptBuild.report.totalChars} context_entries=${systemPromptBuild.report.contextEntries.length} context_chars=${systemPromptBuild.report.contextBudget.injectedTotalChars}`,
  );
  const prompt = input.isScheduledTask
    ? `[SCHEDULED TASK]\n${input.prompt}`
    : input.prompt;

  try {
    log(`Running pi (json mode) for group=${input.groupFolder}`);
    if (
      ['1', 'true', 'yes'].includes(
        (process.env.FFT_NANO_DRY_RUN || '').toLowerCase(),
      )
    ) {
      writeOutput({
        status: 'success',
        result: `DRY_RUN: received ${prompt.length} chars for ${input.chatJid}`,
      });
      return;
    }

    let result: string;
    let streamed: boolean;
    let usage:
      | {
          inputTokens?: number;
          outputTokens?: number;
          totalTokens?: number;
          provider?: string;
          model?: string;
        }
      | undefined;

    const forcedDelegateMode = getForcedDelegateMode(input.codingHint);
    const canRunDelegatedCoderDirectly =
      !!forcedDelegateMode && input.isMain && !input.isScheduledTask;

    if (canRunDelegatedCoderDirectly) {
      const directRun = await runDelegatedCodingWorker({
        params: {
          task: prompt,
          mode: forcedDelegateMode,
        },
        chatJid: input.chatJid,
        requestId: input.requestId,
      });
      log(
        `Direct coder run stats: tools=${directRun.stats.toolExecutionCount} mutating=${directRun.stats.mutatingToolExecutionCount} changed_files=${directRun.stats.changedFiles.length}`,
      );
      result = `${directRun.result}\n\n[coder-metrics] tools=${directRun.stats.toolExecutionCount} mutating=${directRun.stats.mutatingToolExecutionCount} failed=${directRun.stats.failedToolExecutionCount} changed_files=${directRun.stats.changedFiles.length}`;
      streamed = directRun.streamed;
      usage = undefined;
    } else {
      const piRun = await runPiAgent(systemPrompt, prompt, input);
      result = piRun.result;
      streamed = piRun.streamed;
      usage = piRun.usage;
    }

    let finalResult: string | null = result;
    let finalStreamed = streamed;

    // Keep explicit delegation behavior resilient for long outputs by sending
    // through IPC with file fallback, then suppressing the host final send.
    if (isForceDelegateHint(input.codingHint) && !input.isScheduledTask) {
      const outDir = `${WORKSPACE_GROUP_DIR}/coder_runs`;
      fs.mkdirSync(outDir, { recursive: true });
      const rid = input.requestId || `coder_${Date.now()}`;

      const maxInline = isTelegramChatJid(input.chatJid) ? 8000 : 3000;
      let sent = false;
      if (result.length <= maxInline) {
        sent = writeIpcMessage(input.chatJid, result);
      } else {
        const filePath = `${outDir}/${rid}.md`;
        try {
          fs.writeFileSync(filePath, result);
        } catch {
          /* ignore */
        }
        const preview = result.slice(0, Math.min(1200, result.length));
        sent = writeIpcMessage(
          input.chatJid,
          `${rid}: output saved to ${filePath}\n\nPreview:\n${preview}\n\n(Ask me to paste the rest if needed.)`,
        );
      }

      if (sent) {
        finalResult = null;
        finalStreamed = true;
      }
    }

    writeOutput({
      status: 'success',
      result: finalResult,
      streamed: finalStreamed,
      usage,
    });
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}

main();
