import fs from 'fs';

import { Type } from '@sinclair/typebox';
import {
  createAgentSession,
  createCodingTools,
  createReadOnlyTools,
  DefaultResourceLoader,
  SessionManager,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolDefinition,
} from '@mariozechner/pi-coding-agent';

const WORKER_CWD = '/workspace/group';
const WORKER_AGENT_DIR = '/home/node/.pi/agent-coder';

type DelegateMode = 'plan' | 'execute';

interface DelegateParams {
  task: string;
  mode: DelegateMode;
  constraints?: string;
}

type TextDelta =
  | { kind: 'append'; text: string }
  | { kind: 'replace'; text: string };

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

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block);
      continue;
    }
    if (!block || typeof block !== 'object') continue;

    const maybeText = (block as Record<string, unknown>).text;
    if (typeof maybeText === 'string') {
      parts.push(maybeText);
      continue;
    }
    const maybeContent = (block as Record<string, unknown>).content;
    if (typeof maybeContent === 'string') {
      parts.push(maybeContent);
    }
  }

  return parts.join('');
}

function getLatestAssistantText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || typeof message !== 'object') continue;

    const role = (message as Record<string, unknown>).role;
    if (role !== 'assistant') continue;

    return extractTextFromContent((message as Record<string, unknown>).content);
  }

  return '';
}

function extractAssistantTextDelta(event: unknown): TextDelta | null {
  if (!event || typeof event !== 'object') return null;

  const evt = event as Record<string, unknown>;

  if (evt.type === 'text_delta' && typeof evt.delta === 'string') {
    return { kind: 'append', text: evt.delta };
  }

  if (evt.delta && typeof evt.delta === 'object') {
    const deltaText = (evt.delta as Record<string, unknown>).text;
    if (typeof deltaText === 'string') {
      return { kind: 'append', text: deltaText };
    }
  }

  if (typeof evt.text === 'string') {
    return { kind: 'append', text: evt.text };
  }

  if (evt.message && typeof evt.message === 'object') {
    const content = (evt.message as Record<string, unknown>).content;
    const text = extractTextFromContent(content);
    if (text) return { kind: 'replace', text };
  }

  if (evt.content) {
    const text = extractTextFromContent(evt.content);
    if (text) return { kind: 'replace', text };
  }

  return null;
}

function buildWorkerPrompt(params: DelegateParams): string {
  const lines: string[] = [];

  lines.push('You are a delegated coding worker running inside FFT_nano.');
  lines.push('Stay technical, deterministic, and action-oriented.');
  lines.push('');

  if (params.mode === 'plan') {
    lines.push('Mode: plan');
    lines.push('- Do not modify files.');
    lines.push('- Provide a concrete implementation plan and test strategy.');
  } else {
    lines.push('Mode: execute');
    lines.push('- Implement the requested code changes directly.');
    lines.push('- Run relevant checks/tests when feasible.');
  }

  if (params.constraints?.trim()) {
    lines.push('');
    lines.push('Constraints:');
    lines.push(params.constraints.trim());
  }

  lines.push('');
  lines.push('Task:');
  lines.push(params.task.trim());

  return lines.join('\n');
}

async function runWorker(
  params: DelegateParams,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
): Promise<{ result: string; streamed: boolean }> {
  const chatJid = (process.env.FFT_NANO_CHAT_JID || '').trim();
  const requestId = (process.env.FFT_NANO_REQUEST_ID || '').trim();
  const prefix = requestId ? `[${requestId}] ` : '';

  const canStream = chatJid.length > 0;
  const isTelegram = canStream && isTelegramChatJid(chatJid);

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
    if (!canStream || !isTelegram) return;
    if (!pendingDiff) return;

    const now = Date.now();
    if (progressMsgCount >= maxTelegramMessages) return;
    if (now - lastProgressSend < telegramMinIntervalMs) return;

    const chunk = pendingDiff.slice(0, telegramMaxChunk);
    pendingDiff = pendingDiff.slice(chunk.length);

    const ok = writeIpcMessage(chatJid, `${prefix}${chunk}`);
    if (ok) {
      streamed = true;
      progressMsgCount++;
      lastProgressSend = now;
    }
  };

  const maybeSendWhatsAppMilestone = () => {
    if (!canStream || isTelegram) return;
    if (progressMsgCount >= maxWhatsAppMessages) return;

    const now = Date.now();
    if (milestoneIdx >= whatsAppMilestonesMs.length) return;
    if (now - startTs < whatsAppMilestonesMs[milestoneIdx]) return;

    milestoneIdx++;
    const preview = assistantSoFar.trim()
      ? assistantSoFar.trim().slice(-350)
      : 'Still working...';

    const ok = writeIpcMessage(chatJid, `${prefix}Progress update: ${preview}`);
    if (ok) {
      streamed = true;
      progressMsgCount++;
    }
  };

  const applyDelta = (delta: TextDelta) => {
    if (delta.kind === 'append') assistantSoFar += delta.text;
    else assistantSoFar = delta.text;

    if (!canStream || !isTelegram) return;

    if (assistantSoFar.length > lastStreamedLen) {
      pendingDiff += assistantSoFar.slice(lastStreamedLen);
      lastStreamedLen = assistantSoFar.length;
    } else if (assistantSoFar.length < lastStreamedLen) {
      lastStreamedLen = assistantSoFar.length;
      pendingDiff = '';
    }

    maybeSendTelegramProgress();
  };

  if (signal?.aborted) {
    throw new Error('Delegated coding request aborted before start');
  }

  const workerLoader = new DefaultResourceLoader({
    cwd: WORKER_CWD,
    agentDir: WORKER_AGENT_DIR,
    noExtensions: true,
  });
  await workerLoader.reload();

  const workerTools =
    params.mode === 'plan'
      ? createReadOnlyTools(WORKER_CWD)
      : createCodingTools(WORKER_CWD);

  const { session } = await createAgentSession({
    cwd: WORKER_CWD,
    agentDir: WORKER_AGENT_DIR,
    resourceLoader: workerLoader,
    tools: workerTools,
    sessionManager: SessionManager.inMemory(WORKER_CWD),
    model: ctx.model,
  });

  const unsubscribe = session.subscribe((event: any) => {
    const evtType = event?.type;
    if (evtType !== 'message_update') return;

    const assistantEvent = event?.assistantMessageEvent;
    const delta = extractAssistantTextDelta(assistantEvent);
    if (!delta) return;

    applyDelta(delta);
    maybeSendWhatsAppMilestone();
  });

  const ticker = setInterval(() => {
    maybeSendTelegramProgress();
    maybeSendWhatsAppMilestone();
  }, 1000);

  const abortListener = () => {
    session.dispose();
  };
  signal?.addEventListener('abort', abortListener, { once: true });

  try {
    const workerPrompt = buildWorkerPrompt(params);
    await session.prompt(workerPrompt);

    const result = getLatestAssistantText(session.state.messages);
    return {
      result: result.trim() || 'Delegated worker completed without a response.',
      streamed,
    };
  } finally {
    clearInterval(ticker);
    unsubscribe();
    signal?.removeEventListener('abort', abortListener);
    session.dispose();
  }
}

export default function piOnPiExtension(pi: ExtensionAPI): void {
  const delegateTool: ToolDefinition = {
    name: 'delegate_to_coding_agent',
    label: 'Delegate To Coding Agent',
    description:
      'Delegate a software-engineering task to an isolated coding worker session. Use for coding, debugging, tests, refactors, and implementation planning.',
    parameters: Type.Object({
      task: Type.String({
        minLength: 1,
        description: 'The exact coding task for the worker, with required context.',
      }),
      mode: Type.Union([Type.Literal('plan'), Type.Literal('execute')], {
        description:
          'plan: propose changes only. execute: implement changes in the workspace.',
      }),
      constraints: Type.Optional(
        Type.String({
          description: 'Optional constraints and guardrails for the delegated run.',
        }),
      ),
    }),
    execute: async (_toolCallId, rawParams, signal, _onUpdate, ctx) => {
      if (process.env.FFT_NANO_IS_MAIN !== '1') {
        return {
          content: [
            {
              type: 'text',
              text: 'Coding delegation is only available in the main/admin chat.',
            },
          ],
          details: { blocked: true },
        };
      }

      const params = rawParams as DelegateParams;
      if (!params.task?.trim()) {
        return {
          content: [{ type: 'text', text: 'No coding task was provided.' }],
          details: { blocked: true },
        };
      }

      const { result, streamed } = await runWorker(params, signal, ctx);

      return {
        content: [{ type: 'text', text: result }],
        details: {
          delegated: true,
          mode: params.mode,
          streamed,
        },
      };
    },
  };

  pi.registerTool(delegateTool);
}
