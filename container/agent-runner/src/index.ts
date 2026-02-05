/**
 * FFT_nano Agent Runner (Pi runtime)
 *
 * Runs inside a container. Reads JSON input on stdin and runs pi (pi-coding-agent).
 * Outputs a JSON result between sentinel markers on stdout.
 */

import { spawn } from 'child_process';
import fs from 'fs';

interface ContainerInput {
  prompt: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  error?: string;
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

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

function readFileIfExists(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function buildSystemPrompt(input: ContainerInput): string {
  const globalMemory =
    readFileIfExists('/workspace/global/CLAUDE.md') ||
    readFileIfExists('/workspace/project/groups/global/CLAUDE.md');

  const lines: string[] = [];
  lines.push('You are FarmFriend, an agricultural assistant.');
  lines.push('Be direct, practical, and safe.');
  lines.push('');
  lines.push('Workspace:');
  lines.push('- /workspace/group is your writable working directory and long-term memory.');
  lines.push('- /workspace/ipc is the bridge to the host process (messages + scheduling).');
  lines.push('');
  lines.push('Messaging (no MCP):');
  lines.push(
    'To proactively message the current chat, write a JSON file into /workspace/ipc/messages/*.json with:',
  );
  lines.push('{"type":"message","chatJid":"<jid>","text":"<text>"}');
  lines.push('Write atomically (temp file then rename) to avoid partial reads.');
  lines.push('Example:');
  lines.push(
    '  bash: tmp=/workspace/ipc/messages/.tmp_$(date +%s).json; ' +
      'printf %s \'{"type":"message","chatJid":"' +
      input.chatJid +
      '","text":"Hello"}\' > "$tmp"; ' +
      'mv "$tmp" /workspace/ipc/messages/msg_$(date +%s).json',
  );
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

  if (globalMemory) {
    lines.push('Global memory:');
    lines.push(globalMemory);
    lines.push('');
  }

  return lines.join('\n');
}

function getPiArgs(
  systemPrompt: string,
  prompt: string,
  useContinue: boolean,
): string[] {
  const args: string[] = ['--mode', 'json'];
  if (useContinue) args.push('-c');

  const model = process.env.PI_MODEL;
  const provider = process.env.PI_API;
  const apiKey = process.env.PI_API_KEY;

  if (provider) args.push('--provider', provider);
  if (model) args.push('--model', model);
  if (apiKey) args.push('--api-key', apiKey);

  args.push('--system-prompt', systemPrompt);
  args.push(prompt);

  return args;
}

async function runPiAgent(systemPrompt: string, prompt: string): Promise<string> {
  const tryRun = (useContinue: boolean) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const args = getPiArgs(systemPrompt, prompt, useContinue);
      const child = spawn('pi', args, {
        cwd: '/workspace/group',
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
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.on('error', (err) => resolve({ code: 1, stdout, stderr: String(err) }));
    });

  // Prefer continuing prior context, but fall back cleanly.
  let res = await tryRun(true);
  if (res.code !== 0) {
    const looksLikeNoSession = /no\s+previous\s+session|no\s+session/i.test(res.stderr);
    if (looksLikeNoSession) {
      res = await tryRun(false);
    }
  }

  if (res.code !== 0) {
    throw new Error(res.stderr.trim() || `pi exited with code ${res.code}`);
  }

  // pi --mode json emits JSON objects (one per line). We return the last assistant message.
  let lastAssistant = '';
  for (const line of res.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const evt = JSON.parse(trimmed) as any;
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
          else if (block && typeof block.content === 'string') parts.push(block.content);
        }
        const joined = parts.join('');
        if (joined) lastAssistant = joined;
      }
    } catch {
      // Ignore non-JSON lines
    }
  }

  if (!lastAssistant) {
    // If JSON parse fails due to formatting differences, fall back to raw stdout.
    return res.stdout.trim();
  }

  return lastAssistant.trim();
}

async function main(): Promise<void> {
  let input: ContainerInput;

  try {
    input = JSON.parse(await readStdin()) as ContainerInput;
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`,
    });
    process.exit(1);
    return;
  }

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

    const result = await runPiAgent(systemPrompt, prompt);
    writeOutput({ status: 'success', result });
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
