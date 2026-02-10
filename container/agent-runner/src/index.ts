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
  profile?: 'farmfriend' | 'coder';
  requestId?: string;
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

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
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

function buildSystemPrompt(input: ContainerInput): string {
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

  const isCoder = input.profile === 'coder';

  const lines: string[] = [];
  if (isCoder) {
    lines.push('You are FarmFriend (Coder), a headless coding agent.');
    lines.push('Be direct, technical, and deterministic.');
    lines.push('Prefer concrete file edits, commands, and verification.');
  } else {
    lines.push('You are FarmFriend, an agricultural assistant.');
    lines.push('Be direct, practical, and safe.');
  }
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

type TextDelta =
  | { kind: 'append'; text: string }
  | { kind: 'replace'; text: string };

function extractAssistantTextDelta(evt: any): TextDelta | null {
  if (!evt || typeof evt !== 'object') return null;

  // Common delta-style shapes (best-effort).
  if (evt.delta && typeof evt.delta.text === 'string') {
    return { kind: 'append', text: evt.delta.text };
  }
  if (typeof evt.text === 'string' && evt.role === 'assistant') {
    return { kind: 'append', text: evt.text };
  }

  // Full-message shapes (we treat as a replace).
  if (evt.message?.role !== 'assistant') return null;
  const content = evt.message?.content;
  if (typeof content === 'string') return { kind: 'replace', text: content };
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === 'string') parts.push(block);
      else if (block && typeof block.text === 'string') parts.push(block.text);
      else if (block && typeof block.content === 'string') parts.push(block.content);
    }
    return { kind: 'replace', text: parts.join('') };
  }

  return null;
}

async function runPiAgent(
  systemPrompt: string,
  prompt: string,
  input: ContainerInput,
): Promise<{ result: string; streamed: boolean }> {
  const isCoder = input.profile === 'coder' && !input.isScheduledTask;
  const isTelegram = isTelegramChatJid(input.chatJid);

  let streamed = false;
  let assistantSoFar = '';
  let pendingDiff = '';
  let lastStreamedLen = 0;
  let lastProgressSend = 0;
  let progressMsgCount = 0;

  const maxTelegramMessages = 50;
  const telegramMinIntervalMs = 4000;
  const telegramMaxChunk = 900;

  const maxWhatsAppMessages = 3;
  const whatsAppMilestonesMs = [30_000, 120_000, 240_000];
  const startTs = Date.now();
  let milestoneIdx = 0;

  const maybeSendTelegramProgress = () => {
    if (!isCoder || !isTelegram) return;
    if (!pendingDiff) return;
    const now = Date.now();
    if (progressMsgCount >= maxTelegramMessages) return;
    if (now - lastProgressSend < telegramMinIntervalMs) return;

    const chunk = pendingDiff.slice(0, telegramMaxChunk);
    pendingDiff = pendingDiff.slice(chunk.length);
    const ok = writeIpcMessage(
      input.chatJid,
      (input.requestId ? `[${input.requestId}] ` : '') + chunk,
    );
    if (ok) {
      streamed = true;
      progressMsgCount++;
      lastProgressSend = now;
    }
  };

  const maybeSendWhatsAppMilestone = () => {
    if (!isCoder || isTelegram) return;
    if (progressMsgCount >= maxWhatsAppMessages) return;
    const now = Date.now();
    if (milestoneIdx >= whatsAppMilestonesMs.length) return;
    if (now - startTs < whatsAppMilestonesMs[milestoneIdx]) return;

    milestoneIdx++;
    const preview = assistantSoFar.trim()
      ? assistantSoFar.trim().slice(-350)
      : 'Still working...';
    const ok = writeIpcMessage(
      input.chatJid,
      `${input.requestId ? `[${input.requestId}] ` : ''}Progress update: ${preview}`,
    );
    if (ok) {
      streamed = true;
      progressMsgCount++;
    }
  };

  const applyDelta = (d: TextDelta) => {
    if (d.kind === 'append') assistantSoFar += d.text;
    else assistantSoFar = d.text;

    // For Telegram we stream small diffs; for WhatsApp we only use it as preview
    // in milestone updates.
    if (isCoder && isTelegram) {
      if (assistantSoFar.length > lastStreamedLen) {
        pendingDiff += assistantSoFar.slice(lastStreamedLen);
        lastStreamedLen = assistantSoFar.length;
      } else if (assistantSoFar.length < lastStreamedLen) {
        // If the stream resets/replaces with shorter text, reset our cursor.
        lastStreamedLen = assistantSoFar.length;
        pendingDiff = '';
      }
      maybeSendTelegramProgress();
    }
  };

  const tryRun = (useContinue: boolean) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const args = getPiArgs(systemPrompt, prompt, useContinue);
      const env = { ...process.env };
      // Separate pi state between manager and coder runs.
      if (input.profile === 'coder') {
        env.PI_CODING_AGENT_DIR = '/home/node/.pi/agent-coder';
      } else {
        env.PI_CODING_AGENT_DIR = '/home/node/.pi/agent-farmfriend';
      }

      const child = spawn('pi', args, {
        cwd: '/workspace/group',
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let buf = '';

      child.stdout.on('data', (d) => {
        const s = d.toString();
        stdout += s;

        if (!isCoder) return;

        buf += s;
        let idx: number;
        while ((idx = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            const delta = extractAssistantTextDelta(evt);
            if (delta) applyDelta(delta);
          } catch {
            // ignore non-JSON lines
          }
        }

        maybeSendTelegramProgress();
        maybeSendWhatsAppMilestone();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      const ticker = isCoder
        ? setInterval(() => {
            maybeSendTelegramProgress();
            maybeSendWhatsAppMilestone();
          }, 1000)
        : null;

      child.on('close', (code) => {
        if (ticker) clearInterval(ticker);
        resolve({ code, stdout, stderr });
      });
      child.on('error', (err) => {
        if (ticker) clearInterval(ticker);
        resolve({ code: 1, stdout, stderr: String(err) });
      });
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
      if (stopReason === 'error' && typeof errorMessage === 'string' && errorMessage) {
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
          else if (block && typeof block.content === 'string') parts.push(block.content);
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
    return { result: res.stdout.trim(), streamed };
  }

  return { result: lastAssistant.trim(), streamed };
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

    const { result, streamed } = await runPiAgent(systemPrompt, prompt, input);

    // OpenClaw-style: for coder runs, send output back to the originating chat
    // via IPC (same platform), and suppress the host-side final send to avoid
    // duplicate messages.
    if (input.profile === 'coder' && !input.isScheduledTask) {
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

      writeOutput({
        status: 'success',
        result: sent ? null : result,
        streamed: sent || streamed,
      });
      return;
    }

    writeOutput({ status: 'success', result, streamed });
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
