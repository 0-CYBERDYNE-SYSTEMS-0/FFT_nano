/**
 * FFT_nano Agent Runner (Pi runtime)
 *
 * Runs inside a container. Reads JSON input on stdin and runs pi (pi-coding-agent).
 * Outputs a JSON result between sentinel markers on stdout.
 */

import { spawn } from 'child_process';
import fs from 'fs';

import { runDelegatedCodingWorker } from './coder-worker.js';
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
  provider?: string;
  model?: string;
  thinkLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  reasoningLevel?: 'off' | 'on' | 'stream';
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
const PI_ON_PI_EXTENSION_PATH = '/app/dist/extensions/pi-on-pi.js';

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
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

function normalizeInput(input: ContainerInput): NormalizedContainerInput {
  return {
    ...input,
    codingHint: normalizeCodingHint(input.codingHint),
    thinkLevel: normalizeThinkLevel(input.thinkLevel),
    reasoningLevel: normalizeReasoningLevel(input.reasoningLevel),
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
    const dir = '/workspace/ipc/messages';
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

  if (loadDelegationExtension) {
    args.push('--extension', PI_ON_PI_EXTENSION_PATH);
  }

  // Keep pi's default coding system prompt (tool behavior + conventions) and
  // append FFT-specific runtime context on top.
  args.push('--append-system-prompt', systemPrompt);
  args.push('--tools', 'read,bash,edit,write,grep,find,ls');
  args.push(prompt);

  return args;
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

  const tryRun = (useContinue: boolean) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const args = getPiArgs(
        systemPrompt,
        prompt,
        useContinue,
        loadDelegationExtension,
        input,
      );
      const env = {
        ...process.env,
        PI_CODING_AGENT_DIR: '/home/node/.pi/agent-farmfriend',
        FFT_NANO_CHAT_JID: input.chatJid,
        FFT_NANO_REQUEST_ID: input.requestId || '',
        FFT_NANO_CODING_HINT: input.codingHint,
        FFT_NANO_IS_MAIN: input.isMain ? '1' : '0',
      };

      const child = spawn('pi', args, {
        cwd: '/workspace/group',
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      child.on('close', (code) => {
        resolve({ code, stdout, stderr });
      });
      child.on('error', (err) => {
        resolve({ code: 1, stdout, stderr: String(err) });
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

  // pi --mode json emits JSON objects (one per line). We return the last assistant message.
  let lastAssistant = '';
  let lastError: string | null = null;
  let usage:
    | {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        provider?: string;
        model?: string;
      }
    | undefined;
  const toNumber = (value: unknown): number | undefined => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return value >= 0 ? value : undefined;
  };

  const extractUsage = (evt: any) => {
    const messageUsage = evt?.message?.usage;
    const directUsage = evt?.usage;
    const usageCandidate = messageUsage && typeof messageUsage === 'object'
      ? messageUsage
      : directUsage && typeof directUsage === 'object'
        ? directUsage
        : undefined;
    if (!usageCandidate) return;

    const inputTokens =
      toNumber(usageCandidate.inputTokens) ??
      toNumber(usageCandidate.input_tokens) ??
      toNumber(usageCandidate.promptTokens) ??
      toNumber(usageCandidate.prompt_tokens);
    const outputTokens =
      toNumber(usageCandidate.outputTokens) ??
      toNumber(usageCandidate.output_tokens) ??
      toNumber(usageCandidate.completionTokens) ??
      toNumber(usageCandidate.completion_tokens);
    const totalTokens =
      toNumber(usageCandidate.totalTokens) ??
      toNumber(usageCandidate.total_tokens) ??
      (typeof inputTokens === 'number' || typeof outputTokens === 'number'
        ? (inputTokens || 0) + (outputTokens || 0)
        : undefined);

    usage = {
      inputTokens,
      outputTokens,
      totalTokens,
      provider:
        (typeof evt?.message?.provider === 'string' && evt.message.provider) ||
        (typeof evt?.provider === 'string' && evt.provider) ||
        input.provider,
      model:
        (typeof evt?.message?.model === 'string' && evt.message.model) ||
        (typeof evt?.model === 'string' && evt.model) ||
        input.model,
    };
  };

  for (const line of res.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const evt = JSON.parse(trimmed) as any;
      extractUsage(evt);

      // If the model/provider returns an error stop reason, don't forward raw
      // event streams back to chat. Surface the error instead.
      const stopReason = evt?.message?.stopReason;
      const errorMessage = evt?.message?.errorMessage;
      if (
        stopReason === 'error' &&
        typeof errorMessage === 'string' &&
        errorMessage
      ) {
        lastError = errorMessage;
      }

      if (evt?.type !== 'message_end') continue;
      if (evt?.message?.role !== 'assistant') continue;

      const content = evt?.message?.content;
      if (typeof content === 'string') {
        lastAssistant = content;
        continue;
      }
      if (Array.isArray(content)) {
        const parts: string[] = [];
        for (const block of content) {
          if (typeof block === 'string') parts.push(block);
          else if (block && typeof block.text === 'string') parts.push(block.text);
          else if (block && typeof block.content === 'string') {
            parts.push(block.content);
          }
        }
        const joined = parts.join('');
        if (joined) lastAssistant = joined;
      }
    } catch {
      // Ignore non-JSON lines
    }
  }

  if (!lastAssistant && lastError) {
    throw new Error(lastError);
  }

  if (!lastAssistant) {
    // If JSON parse fails due to formatting differences, fall back to raw stdout.
    return { result: res.stdout.trim(), streamed: false, usage };
  }

  return { result: lastAssistant.trim(), streamed: false, usage };
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
      const outDir = '/workspace/group/coder_runs';
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
