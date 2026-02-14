/**
 * FFT_nano Agent Runner (Pi runtime)
 *
 * Runs inside a container. Reads JSON input on stdin and runs pi (pi-coding-agent).
 * Outputs a JSON result between sentinel markers on stdout.
 */

import { spawn } from 'child_process';
import fs from 'fs';

import { runDelegatedCodingWorker } from './coder-worker.js';

interface ContainerInput {
  prompt: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  memoryContext?: string;
  codingHint?:
    | 'none'
    | 'force_delegate_execute'
    | 'force_delegate_plan'
    | 'auto'
    | 'force_delegate';
  requestId?: string;
}

type CodingHint = 'none' | 'force_delegate_execute' | 'force_delegate_plan';

interface NormalizedContainerInput extends Omit<ContainerInput, 'codingHint'> {
  codingHint: CodingHint;
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  error?: string;
  streamed?: boolean;
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
    value === 'force_delegate_execute' ||
    value === 'force_delegate_plan' ||
    value === 'none'
  ) {
    return value;
  }
  return 'none';
}

function normalizeInput(input: ContainerInput): NormalizedContainerInput {
  return {
    ...input,
    codingHint: normalizeCodingHint(input.codingHint),
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

function readFileIfExists(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function buildSystemPrompt(input: NormalizedContainerInput): string {
  const providedMemoryContext = (input.memoryContext || '').trim();

  const delegationExtensionAvailable = fs.existsSync(PI_ON_PI_EXTENSION_PATH);
  const forcedDelegateMode = getForcedDelegateMode(input.codingHint);
  const canDelegateToCoder =
    !!forcedDelegateMode &&
    input.isMain &&
    !input.isScheduledTask &&
    delegationExtensionAvailable;

  const lines: string[] = [];
  lines.push('You are FarmFriend, a practical assistant with optional delegated coding capabilities.');
  lines.push('Be direct, safe, and deterministic.');
  lines.push('');
  lines.push('Workspace:');
  lines.push('- /workspace/group is your writable working directory and long-term memory.');
  lines.push('- /workspace/ipc is the bridge to the host process (messages + scheduling).');
  lines.push('');
  lines.push('Runtime hints:');
  lines.push(`- coding_hint: ${input.codingHint}`);
  if (input.requestId) {
    lines.push(`- request_id: ${input.requestId}`);
  }
  lines.push('');

  if (canDelegateToCoder) {
    lines.push('Coding delegation rules:');
    lines.push(
      `- This turn is explicit delegation: call delegate_to_coding_agent exactly once with mode="${forcedDelegateMode}".`,
    );
    if (forcedDelegateMode === 'plan') {
      lines.push('- Return a concrete implementation plan only; do not directly apply file edits in this outer session.');
    } else {
      lines.push('- Execute via delegated coder and return the delegated outcome.');
    }
    lines.push('');
  } else if (isForceDelegateHint(input.codingHint)) {
    // Avoid instructing tool use when the extension is not actually loaded.
    lines.push(
      'Coding delegation status: unavailable for this run (not main, scheduled task, or delegate extension not loaded).',
    );
    lines.push('- Handle this request directly in this session and explain that delegation is unavailable.');
    lines.push('');
  } else if (input.isMain && !input.isScheduledTask) {
    lines.push('Coding delegation offer policy (main chat):');
    lines.push('- Do not delegate automatically on normal turns.');
    lines.push(
      '- If the user appears to want substantial software engineering work (multi-file changes, deep debugging, larger refactors, broad test work), proactively offer explicit coder delegation.',
    );
    lines.push(
      '- Offer this concise opt-in: "/coder <task>" to execute, "/coder-plan <task>" for plan-only, or "use coding agent".',
    );
    lines.push(
      '- For lightweight tasks (small snippets, quick commands, minor edits, simple API calls), continue directly unless the user asks to delegate.',
    );
    lines.push('');
  }

  lines.push('Messaging (no MCP):');
  lines.push(
    'To proactively message the current chat, write a JSON file into /workspace/ipc/messages/*.json with:',
  );
  lines.push('{"type":"message","chatJid":"<jid>","text":"<text>"}');
  lines.push('Write atomically (temp file then rename) to avoid partial reads.');
  lines.push('');

  lines.push('Scheduling:');
  lines.push(
    'To schedule tasks, write JSON into /workspace/ipc/tasks/*.json with one of:',
  );
  lines.push(
    '- schedule: {"type":"schedule_task","prompt":"...","schedule_type":"cron|interval|once","schedule_value":"...","context_mode":"group|isolated","groupFolder":"<folder>"}',
  );
  lines.push('- pause:    {"type":"pause_task","taskId":"..."}');
  lines.push('- resume:   {"type":"resume_task","taskId":"..."}');
  lines.push('- cancel:   {"type":"cancel_task","taskId":"..."}');
  lines.push('- refresh groups (main only): {"type":"refresh_groups"}');
  lines.push(
    '- register group (main only): {"type":"register_group","jid":"...","name":"...","folder":"...","trigger":"@FarmFriend"}',
  );
  lines.push('You can read current tasks at /workspace/ipc/current_tasks.json.');
  lines.push('Main can read groups at /workspace/ipc/available_groups.json.');
  lines.push('');

  lines.push('Formatting constraints (WhatsApp-friendly):');
  lines.push('- Avoid markdown headings (##).');
  lines.push('- Prefer short paragraphs and bullet points.');
  lines.push('');

  if (providedMemoryContext) {
    lines.push('Retrieved memory context:');
    lines.push(providedMemoryContext);
    lines.push('');
  } else {
    // Memory file naming: SOUL.md is canonical. CLAUDE.md is supported for
    // backwards compatibility (older installs/groups).
    const globalMemory =
      readFileIfExists('/workspace/global/SOUL.md') ||
      readFileIfExists('/workspace/project/groups/global/SOUL.md') ||
      readFileIfExists('/workspace/global/CLAUDE.md') ||
      readFileIfExists('/workspace/project/groups/global/CLAUDE.md');

    const groupMemory =
      readFileIfExists('/workspace/group/SOUL.md') ||
      readFileIfExists('/workspace/group/CLAUDE.md');

    if (globalMemory) {
      lines.push('Global memory:');
      lines.push(globalMemory);
      lines.push('');
    }

    if (groupMemory) {
      // Cap group memory to reduce prompt blowups.
      const maxChars = 50_000;
      const trimmed =
        groupMemory.length > maxChars
          ? groupMemory.slice(0, maxChars) +
            `\n\n[NOTE: group memory truncated to ${maxChars} chars]\n`
          : groupMemory;
      lines.push('Group memory:');
      lines.push(trimmed);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function getPiArgs(
  systemPrompt: string,
  prompt: string,
  useContinue: boolean,
  loadDelegationExtension: boolean,
): string[] {
  const args: string[] = ['--mode', 'json'];
  if (useContinue) args.push('-c');

  const model = process.env.PI_MODEL;
  const provider = process.env.PI_API;
  const apiKey = process.env.PI_API_KEY;

  if (provider) args.push('--provider', provider);
  if (model) args.push('--model', model);
  if (apiKey) args.push('--api-key', apiKey);

  if (loadDelegationExtension) {
    args.push('--extension', PI_ON_PI_EXTENSION_PATH);
  }

  args.push('--system-prompt', systemPrompt);
  args.push(prompt);

  return args;
}

async function runPiAgent(
  systemPrompt: string,
  prompt: string,
  input: NormalizedContainerInput,
): Promise<{ result: string; streamed: boolean }> {
  const loadDelegationExtension =
    input.isMain &&
    !input.isScheduledTask &&
    isForceDelegateHint(input.codingHint) &&
    fs.existsSync(PI_ON_PI_EXTENSION_PATH);

  const tryRun = (useContinue: boolean) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const args = getPiArgs(
        systemPrompt,
        prompt,
        useContinue,
        loadDelegationExtension,
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

  // Prefer continuing prior context, but fall back cleanly.
  let res = await tryRun(true);
  if (res.code !== 0) {
    const looksLikeNoSession = /no\s+previous\s+session|no\s+session/i.test(
      res.stderr,
    );
    if (looksLikeNoSession) {
      res = await tryRun(false);
    }
  }

  if (res.code !== 0) {
    throw new Error(res.stderr.trim() || `pi exited with code ${res.code}`);
  }

  // pi --mode json emits JSON objects (one per line). We return the last assistant message.
  let lastAssistant = '';
  let lastError: string | null = null;
  for (const line of res.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const evt = JSON.parse(trimmed) as any;

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
    return { result: res.stdout.trim(), streamed: false };
  }

  return { result: lastAssistant.trim(), streamed: false };
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

  const systemPrompt = buildSystemPrompt(input);
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
    } else {
      const piRun = await runPiAgent(systemPrompt, prompt, input);
      result = piRun.result;
      streamed = piRun.streamed;
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

    writeOutput({ status: 'success', result: finalResult, streamed: finalStreamed });
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
