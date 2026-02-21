import { spawnSync } from 'child_process';
import fs from 'fs';

import {
  createAgentSession,
  createCodingTools,
  createReadOnlyTools,
  DefaultResourceLoader,
  SessionManager,
} from '@mariozechner/pi-coding-agent';

const DEFAULT_WORKER_CWD = '/workspace/group';
const DEFAULT_WORKER_AGENT_DIR = '/home/node/.pi/agent-coder';

export type DelegateMode = 'plan' | 'execute';

export interface DelegateParams {
  task: string;
  mode: DelegateMode;
  constraints?: string;
}

export interface CoderRunStats {
  toolExecutionCount: number;
  mutatingToolExecutionCount: number;
  failedToolExecutionCount: number;
  toolNames: string[];
  editWritePaths: string[];
  changedFiles: string[];
}

export interface RunCoderWorkerOptions {
  params: DelegateParams;
  signal?: AbortSignal;
  model?: any;
  chatJid?: string;
  requestId?: string;
  cwd?: string;
  agentDir?: string;
}

function isTelegramChatJid(chatJid: string): boolean {
  return chatJid.startsWith('telegram:');
}

function writeIpcMessage(chatJid: string, text: string): boolean {
  if (!chatJid) return false;
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

type TextDelta = { kind: 'append'; text: string } | { kind: 'replace'; text: string };

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
    lines.push('- Use real tools and produce actual file edits.');
    lines.push('- Write project files under /workspace/project or /workspace/group.');
    lines.push('- Do not claim file edits unless you actually performed them with tools.');
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

function parseGitStatusPaths(raw: string): Set<string> {
  const result = new Set<string>();
  const lines = raw.split('\n').map((line) => line.trimEnd()).filter(Boolean);

  for (const line of lines) {
    if (line.length < 4) continue;
    let pathPart = line.slice(3).trim();
    const renameIdx = pathPart.indexOf(' -> ');
    if (renameIdx >= 0) pathPart = pathPart.slice(renameIdx + 4).trim();
    if (pathPart) result.add(pathPart);
  }

  return result;
}

function getGitDirtySet(repoPath: string): Set<string> | null {
  const probe = spawnSync('git', ['-C', repoPath, 'rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8',
  });
  if (probe.status !== 0) return null;

  const status = spawnSync('git', ['-C', repoPath, 'status', '--porcelain'], {
    encoding: 'utf8',
  });
  if (status.status !== 0) return null;

  return parseGitStatusPaths(status.stdout || '');
}

function getNewlyDirtyFiles(before: Set<string> | null, after: Set<string> | null): string[] {
  if (!after) return [];
  if (!before) return Array.from(after).sort();
  const delta: string[] = [];
  for (const path of after) {
    if (!before.has(path)) delta.push(path);
  }
  return delta.sort();
}

function isMutatingTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return normalized === 'write' || normalized === 'edit' || normalized === 'bash';
}

function readPathArg(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const value = (args as Record<string, unknown>).path;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isDisallowedAbsolutePath(pathValue: string): boolean {
  if (!pathValue.startsWith('/')) return false;
  return !pathValue.startsWith('/workspace/');
}

export async function runDelegatedCodingWorker(
  options: RunCoderWorkerOptions,
): Promise<{ result: string; streamed: boolean; stats: CoderRunStats }> {
  const params = options.params;
  const chatJid = (options.chatJid || '').trim();
  const requestId = (options.requestId || '').trim();
  const prefix = requestId ? `[${requestId}] ` : '';

  const workerCwd = options.cwd || DEFAULT_WORKER_CWD;
  let workerAgentDir = options.agentDir || DEFAULT_WORKER_AGENT_DIR;
  let sessionDir = `${workerAgentDir}/sessions`;
  try {
    fs.mkdirSync(sessionDir, { recursive: true });
  } catch {
    workerAgentDir = '/tmp/fft_nano_agent_coder';
    sessionDir = `${workerAgentDir}/sessions`;
    fs.mkdirSync(sessionDir, { recursive: true });
  }

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

  let toolExecutionCount = 0;
  let mutatingToolExecutionCount = 0;
  let failedToolExecutionCount = 0;
  const toolNames = new Set<string>();
  const editWritePaths = new Set<string>();
  const disallowedAbsolutePaths = new Set<string>();

  const maybeSendTelegramProgress = () => {
    if (!canStream || !isTelegram) return;
    if (!pendingDiff) return;
    if (progressMsgCount >= maxTelegramMessages) return;

    const now = Date.now();
    if (now - lastProgressSend < telegramMinIntervalMs) return;

    // Chunk at word boundary to avoid cutting words mid-word
    // Find the last space within ~850-900 characters to prevent word truncation
    const searchRange = pendingDiff.slice(0, telegramMaxChunk);
    const lastSpaceIndex = searchRange.lastIndexOf(' ');
    // Only use word boundary if space exists and is reasonably close to max chunk
    // This avoids tiny chunks while still preventing word breaks
    const chunkSize = (lastSpaceIndex > telegramMaxChunk * 0.9) ? lastSpaceIndex + 1 : telegramMaxChunk;
    const chunk = pendingDiff.slice(0, chunkSize);
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

  if (options.signal?.aborted) {
    throw new Error('Delegated coding request aborted before start');
  }

  const beforeProject = getGitDirtySet('/workspace/project');
  const beforeGroup = getGitDirtySet(workerCwd);

  const workerLoader = new DefaultResourceLoader({
    cwd: workerCwd,
    agentDir: workerAgentDir,
    noExtensions: true,
  });
  await workerLoader.reload();

  const workerTools =
    params.mode === 'plan'
      ? createReadOnlyTools(workerCwd)
      : createCodingTools(workerCwd);

  const sessionOptions: Record<string, unknown> = {
    cwd: workerCwd,
    agentDir: workerAgentDir,
    resourceLoader: workerLoader,
    tools: workerTools,
    sessionManager: SessionManager.continueRecent(workerCwd, sessionDir),
  };

  if (options.model) {
    sessionOptions.model = options.model;
  }

  const { session } = await createAgentSession(sessionOptions as any);

  const unsubscribe = session.subscribe((event: any) => {
    if (event?.type === 'message_update') {
      const delta = extractAssistantTextDelta(event?.assistantMessageEvent);
      if (delta) {
        applyDelta(delta);
        maybeSendWhatsAppMilestone();
      }
      return;
    }

    if (event?.type === 'tool_execution_start') {
      const toolName = String(event.toolName || '');
      toolExecutionCount++;
      if (toolName) toolNames.add(toolName);
      if (isMutatingTool(toolName)) {
        mutatingToolExecutionCount++;
      }

      const pathArg = readPathArg(event.args);
      if (pathArg && (toolName === 'edit' || toolName === 'write')) {
        editWritePaths.add(pathArg);
        if (isDisallowedAbsolutePath(pathArg)) {
          disallowedAbsolutePaths.add(pathArg);
        }
      }
      return;
    }

    if (event?.type === 'tool_execution_end' && event?.isError) {
      failedToolExecutionCount++;
    }
  });

  const ticker = setInterval(() => {
    maybeSendTelegramProgress();
    maybeSendWhatsAppMilestone();
  }, 1000);

  const abortListener = () => {
    session.dispose();
  };
  options.signal?.addEventListener('abort', abortListener, { once: true });

  try {
    const workerPrompt = buildWorkerPrompt(params);
    await session.prompt(workerPrompt);

    const result = getLatestAssistantText(session.state.messages).trim();
    const finalResult =
      result || 'Delegated worker completed without a response.';

    const afterProject = getGitDirtySet('/workspace/project');
    const afterGroup = getGitDirtySet(workerCwd);
    const changedFiles = [
      ...getNewlyDirtyFiles(beforeProject, afterProject).map(
        (path) => `project:${path}`,
      ),
      ...getNewlyDirtyFiles(beforeGroup, afterGroup).map(
        (path) => `group:${path}`,
      ),
    ];

    const stats: CoderRunStats = {
      toolExecutionCount,
      mutatingToolExecutionCount,
      failedToolExecutionCount,
      toolNames: Array.from(toolNames).sort(),
      editWritePaths: Array.from(editWritePaths).sort(),
      changedFiles: Array.from(new Set(changedFiles)).sort(),
    };

    if (disallowedAbsolutePaths.size > 0) {
      throw new Error(
        `Coder attempted disallowed absolute paths: ${Array.from(disallowedAbsolutePaths).join(', ')}`,
      );
    }

    if (params.mode === 'execute') {
      if (toolExecutionCount === 0) {
        throw new Error(
          'Coder execute run completed with zero tool executions. Refusing to report success.',
        );
      }

      const hasEditWrite = stats.editWritePaths.length > 0;
      const hasFileDelta = stats.changedFiles.length > 0;
      if (!hasEditWrite && !hasFileDelta) {
        throw new Error(
          'Coder execute run finished without detected file edits. Refusing to report success.',
        );
      }
    }

    return { result: finalResult, streamed, stats };
  } finally {
    clearInterval(ticker);
    unsubscribe();
    options.signal?.removeEventListener('abort', abortListener);
    session.dispose();
  }
}
