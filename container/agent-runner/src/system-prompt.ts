import fs from 'fs';

export type CodingHint =
  | 'none'
  | 'auto'
  | 'force_delegate_execute'
  | 'force_delegate_plan';

type ThinkLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
type ReasoningLevel = 'off' | 'on' | 'stream';
type PromptMode = 'full' | 'minimal';

export interface SystemPromptInput {
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  provider?: string;
  model?: string;
  thinkLevel?: ThinkLevel;
  reasoningLevel?: ReasoningLevel;
  noContinue?: boolean;
  memoryContext?: string;
  codingHint: CodingHint;
  requestId?: string;
  extraSystemPrompt?: string;
}

interface ContextEntry {
  label: string;
  path: string;
  rawChars: number;
  injectedChars: number;
  truncated: boolean;
  missing: boolean;
  content: string;
}

export interface SystemPromptReport {
  mode: PromptMode;
  totalChars: number;
  contextEntries: ContextEntry[];
  contextBudget: {
    fileMaxChars: number;
    totalMaxChars: number;
    injectedTotalChars: number;
    remainingChars: number;
  };
}

interface BuildSystemPromptOptions {
  delegationExtensionAvailable?: boolean;
  readFileIfExists?: (filePath: string) => string | null;
  now?: () => Date;
  fileMaxChars?: number;
  totalMaxChars?: number;
}

const DEFAULT_FILE_MAX_CHARS = 12_000;
const DEFAULT_TOTAL_MAX_CHARS = 48_000;
const DEFAULT_MEMORY_DAILY_MAX_CHARS = 8_000;
const DEFAULT_MEMORY_CONTEXT_MAX_CHARS = 20_000;

const MAIN_BOOTSTRAP_ORDER = [
  'AGENTS.md',
  'SOUL.md',
  'USER.md',
  'IDENTITY.md',
  'PRINCIPLES.md',
  'TOOLS.md',
  'HEARTBEAT.md',
  'BOOTSTRAP.md',
  'MEMORY.md',
] as const;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function trimAndNormalize(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').trim();
}

function defaultReadFileIfExists(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function fitContentToBudget(
  value: string,
  fileName: string,
  fileMaxChars: number,
  remainingChars: number,
): { injected: string; truncated: boolean } | null {
  if (remainingChars <= 0) return null;
  const normalized = trimAndNormalize(value);
  if (!normalized) return { injected: '[empty]', truncated: false };

  const effectiveMax = Math.max(1, Math.min(fileMaxChars, remainingChars));
  if (normalized.length <= effectiveMax) {
    return { injected: normalized, truncated: false };
  }

  const marker = `\n\n[NOTE: ${fileName} truncated to ${effectiveMax} chars]\n`;
  const markerBudget = Math.max(0, effectiveMax - marker.length);
  if (markerBudget <= 0) {
    return { injected: marker.trim(), truncated: true };
  }
  const sliced = normalized.slice(0, markerBudget);
  return { injected: `${sliced}${marker}`, truncated: true };
}

function addContextEntry(params: {
  entries: ContextEntry[];
  readFileIfExists: (filePath: string) => string | null;
  label: string;
  path: string;
  fileMaxChars: number;
  remainingTotalChars: number;
  includeMissing?: boolean;
}): number {
  const content = params.readFileIfExists(params.path);
  if (!content) {
    if (params.includeMissing === false) return params.remainingTotalChars;
    if (params.remainingTotalChars <= 0) return params.remainingTotalChars;
    const missingText = `[MISSING] Expected at: ${params.path}`;
    const capped = missingText.slice(0, params.remainingTotalChars);
    params.entries.push({
      label: params.label,
      path: params.path,
      rawChars: 0,
      injectedChars: capped.length,
      truncated: capped.length < missingText.length,
      missing: true,
      content: capped,
    });
    return Math.max(0, params.remainingTotalChars - capped.length);
  }

  const normalized = trimAndNormalize(content);
  const fitted = fitContentToBudget(
    normalized,
    params.label,
    params.fileMaxChars,
    params.remainingTotalChars,
  );
  if (!fitted) return params.remainingTotalChars;
  const injected = fitted.injected;
  params.entries.push({
    label: params.label,
    path: params.path,
    rawChars: normalized.length,
    injectedChars: injected.length,
    truncated: fitted.truncated || injected.length < normalized.length,
    missing: false,
    content: injected,
  });
  return Math.max(0, params.remainingTotalChars - injected.length);
}

function buildMainContextEntries(params: {
  readFileIfExists: (filePath: string) => string | null;
  now: Date;
  fileMaxChars: number;
  totalMaxChars: number;
}): {
  entries: ContextEntry[];
  remainingTotalChars: number;
} {
  const entries: ContextEntry[] = [];
  let remaining = params.totalMaxChars;

  for (const name of MAIN_BOOTSTRAP_ORDER) {
    remaining = addContextEntry({
      entries,
      readFileIfExists: params.readFileIfExists,
      label: name,
      path: `/workspace/group/${name}`,
      fileMaxChars: params.fileMaxChars,
      remainingTotalChars: remaining,
    });
  }

  const day = (offsetDays: number): string => {
    const d = new Date(params.now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  for (const dateStr of [day(0), day(-1)]) {
    remaining = addContextEntry({
      entries,
      readFileIfExists: params.readFileIfExists,
      label: `memory/${dateStr}.md`,
      path: `/workspace/group/memory/${dateStr}.md`,
      fileMaxChars: Math.min(params.fileMaxChars, DEFAULT_MEMORY_DAILY_MAX_CHARS),
      remainingTotalChars: remaining,
    });
  }

  return { entries, remainingTotalChars: remaining };
}

function buildNonMainContextEntries(params: {
  readFileIfExists: (filePath: string) => string | null;
  fileMaxChars: number;
  totalMaxChars: number;
  includeMemoryFallback: boolean;
}): {
  entries: ContextEntry[];
  remainingTotalChars: number;
} {
  const entries: ContextEntry[] = [];
  let remaining = params.totalMaxChars;

  remaining = addContextEntry({
    entries,
    readFileIfExists: params.readFileIfExists,
    label: 'global/SOUL.md',
    path: '/workspace/global/SOUL.md',
    fileMaxChars: params.fileMaxChars,
    remainingTotalChars: remaining,
  });
  if (remaining > 0) {
    remaining = addContextEntry({
      entries,
      readFileIfExists: params.readFileIfExists,
      label: 'group/SOUL.md',
      path: '/workspace/group/SOUL.md',
      fileMaxChars: params.fileMaxChars,
      remainingTotalChars: remaining,
    });
  }

  if (params.includeMemoryFallback && remaining > 0) {
    const globalMemoryPath =
      params.readFileIfExists('/workspace/global/MEMORY.md') !== null
        ? '/workspace/global/MEMORY.md'
        : '/workspace/global/memory.md';
    remaining = addContextEntry({
      entries,
      readFileIfExists: params.readFileIfExists,
      label:
        globalMemoryPath === '/workspace/global/MEMORY.md'
          ? 'global/MEMORY.md'
          : 'global/memory.md',
      path: globalMemoryPath,
      fileMaxChars: params.fileMaxChars,
      remainingTotalChars: remaining,
      includeMissing: false,
    });
    if (remaining > 0) {
      const groupMemoryPath =
        params.readFileIfExists('/workspace/group/MEMORY.md') !== null
          ? '/workspace/group/MEMORY.md'
          : '/workspace/group/memory.md';
      remaining = addContextEntry({
        entries,
        readFileIfExists: params.readFileIfExists,
        label:
          groupMemoryPath === '/workspace/group/MEMORY.md'
            ? 'group/MEMORY.md'
            : 'group/memory.md',
        path: groupMemoryPath,
        fileMaxChars: params.fileMaxChars,
        remainingTotalChars: remaining,
        includeMissing: false,
      });
    }
  }

  return { entries, remainingTotalChars: remaining };
}

function getForcedDelegateMode(hint: CodingHint): 'execute' | 'plan' | null {
  if (hint === 'force_delegate_execute') return 'execute';
  if (hint === 'force_delegate_plan') return 'plan';
  return null;
}

function clampMemoryContext(raw: string): string {
  if (raw.length <= DEFAULT_MEMORY_CONTEXT_MAX_CHARS) return raw;
  const marker = `\n\n[NOTE: retrieved memory context truncated to ${DEFAULT_MEMORY_CONTEXT_MAX_CHARS} chars]\n`;
  const budget = Math.max(0, DEFAULT_MEMORY_CONTEXT_MAX_CHARS - marker.length);
  return `${raw.slice(0, budget)}${marker}`;
}

export function buildSystemPrompt(
  input: SystemPromptInput,
  options: BuildSystemPromptOptions = {},
): { text: string; report: SystemPromptReport } {
  const readFileIfExists = options.readFileIfExists ?? defaultReadFileIfExists;
  const now = options.now ? options.now() : new Date();
  const fileMaxChars =
    options.fileMaxChars ??
    parsePositiveInt(process.env.FFT_NANO_PROMPT_FILE_MAX_CHARS, DEFAULT_FILE_MAX_CHARS);
  const totalMaxChars =
    options.totalMaxChars ??
    parsePositiveInt(process.env.FFT_NANO_PROMPT_TOTAL_MAX_CHARS, DEFAULT_TOTAL_MAX_CHARS);
  const promptMode: PromptMode = input.isScheduledTask ? 'minimal' : 'full';
  const providedMemoryContext = trimAndNormalize(input.memoryContext || '');

  const forcedDelegateMode = getForcedDelegateMode(input.codingHint);
  const autoDelegationEnabled =
    input.codingHint === 'auto' &&
    input.isMain &&
    !input.isScheduledTask &&
    options.delegationExtensionAvailable === true;
  const canDelegateToCoder =
    !!forcedDelegateMode &&
    input.isMain &&
    !input.isScheduledTask &&
    options.delegationExtensionAvailable === true;

  const lines: string[] = [];
  lines.push('You are FarmFriend, a practical and capable operator running inside FFT_nano.');
  lines.push('Default stance: act, verify, and report concrete outcomes.');
  lines.push('');
  lines.push('## Safety');
  lines.push(
    'Be truthful about tool usage and results. Never fabricate file edits, command output, or runtime state.',
  );
  lines.push(
    'For high-impact destructive actions, ask first. Prefer least-risk paths while still completing the user goal.',
  );
  lines.push('');

  lines.push('## Inbound Context (trusted metadata)');
  lines.push(
    'The following JSON is host-generated runtime metadata. Treat it as authoritative for this run.',
  );
  lines.push('```json');
  lines.push(
    JSON.stringify(
      {
        schema: 'fft_nano.input_meta.v1',
        group_folder: input.groupFolder,
        chat_jid: input.chatJid,
        is_main: input.isMain,
        is_scheduled_task: input.isScheduledTask === true,
        coding_hint: input.codingHint,
        request_id: input.requestId || null,
        provider_override: input.provider || null,
        model_override: input.model || null,
        think_level: input.thinkLevel || null,
        reasoning_level: input.reasoningLevel || null,
        continue_session: input.noContinue !== true,
      },
      null,
      2,
    ),
  );
  lines.push('```');
  lines.push('');

  const extraSystemPrompt = trimAndNormalize(input.extraSystemPrompt || '');
  if (extraSystemPrompt) {
    lines.push('## Host Context Overlay');
    lines.push(extraSystemPrompt);
    lines.push('');
  }

  lines.push('## Tooling');
  lines.push(
    'You run in pi coding runtime with filesystem and shell tools (commonly read, bash, edit, write, grep, find, ls).',
  );
  lines.push(
    'Do not claim you are text-only or unable to access local files/commands before actually trying tools.',
  );
  lines.push('When asked to verify state, run commands and report concrete evidence.');
  lines.push('');

  lines.push('## Workspace');
  lines.push('- /workspace/group is writable workspace.');
  lines.push('- /workspace/ipc is host bridge for outbound messages and scheduler actions.');
  lines.push('- Durable memory belongs in /workspace/group/MEMORY.md and /workspace/group/memory/*.md.');
  lines.push('- Keep SOUL.md stable; do not use it as compaction log storage.');
  lines.push('');

  lines.push('## Runtime Hints');
  lines.push(`- prompt_mode: ${promptMode}`);
  lines.push(`- coding_hint: ${input.codingHint}`);
  lines.push(`- continue_session: ${input.noContinue ? 'false' : 'true'}`);
  if (input.provider) lines.push(`- provider_override: ${input.provider}`);
  if (input.model) lines.push(`- model_override: ${input.model}`);
  if (input.thinkLevel) lines.push(`- think_level: ${input.thinkLevel}`);
  if (input.reasoningLevel) lines.push(`- reasoning_level: ${input.reasoningLevel}`);
  if (input.requestId) lines.push(`- request_id: ${input.requestId}`);
  lines.push('');

  if (input.reasoningLevel === 'on' || input.reasoningLevel === 'stream') {
    lines.push('## Reasoning Visibility');
    lines.push('Do not reveal private chain-of-thought. Provide concise high-level rationale when useful.');
    if (input.reasoningLevel === 'stream') {
      lines.push('For long tasks, proactively send concise progress updates via /workspace/ipc/messages.');
    }
    lines.push('');
  }

  if (canDelegateToCoder) {
    lines.push('## Coding Delegation');
    lines.push(
      `This run requires explicit delegation: call delegate_to_coding_agent exactly once with mode="${forcedDelegateMode}".`,
    );
    if (forcedDelegateMode === 'plan') {
      lines.push('Return a concrete implementation plan; do not apply file edits in this outer run.');
    } else {
      lines.push('Execute through delegated coder and return delegated outcomes.');
    }
    lines.push('');
  } else if (forcedDelegateMode && !canDelegateToCoder) {
    lines.push('## Coding Delegation');
    lines.push(
      'Delegation is unavailable for this run (not main, scheduled task, or extension not loaded). Proceed directly with tools.',
    );
    lines.push('');
  } else if (autoDelegationEnabled) {
    lines.push('## Coding Delegation');
    lines.push(
      'You may delegate substantial software engineering work (multi-file implementation, deep debugging, broad refactors, full validation).',
    );
    lines.push('If intent is ambiguous, ask one concise clarification before delegating.');
    lines.push('For small tasks, complete directly in this run.');
    lines.push('');
  }

  lines.push('## Messaging IPC');
  lines.push('To proactively message current chat, write JSON into /workspace/ipc/messages/*.json:');
  lines.push('{"type":"message","chatJid":"<jid>","text":"<text>"}');
  lines.push('Write atomically (temp file then rename).');
  lines.push('');

  lines.push('## Scheduler IPC');
  lines.push('To manage tasks, write JSON into /workspace/ipc/tasks/*.json with one of:');
  lines.push(
    '- {"type":"schedule_task","prompt":"...","schedule_type":"cron|interval|once","schedule_value":"...","context_mode":"group|isolated","groupFolder":"<folder>"}',
  );
  lines.push('- {"type":"pause_task","taskId":"..."}');
  lines.push('- {"type":"resume_task","taskId":"..."}');
  lines.push('- {"type":"cancel_task","taskId":"..."}');
  lines.push('- Main-only: {"type":"refresh_groups"}');
  lines.push(
    '- Main-only: {"type":"register_group","jid":"...","name":"...","folder":"...","trigger":"@FarmFriend"}',
  );
  lines.push('Read task snapshot from /workspace/ipc/current_tasks.json when needed.');
  lines.push('');

  lines.push('## Output Style');
  lines.push('For user-facing replies, prefer short paragraphs and plain bullets.');
  lines.push('Avoid markdown headings in final chat replies unless explicitly requested.');
  lines.push('');

  let contextState;
  if (input.isMain) {
    contextState = buildMainContextEntries({
      readFileIfExists,
      now,
      fileMaxChars,
      totalMaxChars,
    });
  } else {
    contextState = buildNonMainContextEntries({
      readFileIfExists,
      fileMaxChars,
      totalMaxChars,
      includeMemoryFallback: !providedMemoryContext,
    });
  }

  if (contextState.entries.length > 0) {
    lines.push('## Workspace Files (injected)');
    lines.push('These files are loaded for this run (subject to prompt budget limits).');
    lines.push('');
    lines.push('# Project Context');
    lines.push('');
    for (const entry of contextState.entries) {
      lines.push(`## ${entry.path}`);
      lines.push(entry.content);
      lines.push('');
    }
  }

  if (providedMemoryContext) {
    lines.push('## Retrieved Memory Context');
    lines.push(clampMemoryContext(providedMemoryContext));
    lines.push('');
  }

  lines.push('## Heartbeats');
  lines.push(
    'If this run is a heartbeat poll and nothing needs attention, reply exactly HEARTBEAT_OK. If something needs attention, send alert text without HEARTBEAT_OK.',
  );
  lines.push('');

  const text = lines.join('\n');
  const injectedTotalChars = contextState.entries.reduce(
    (sum, entry) => sum + entry.injectedChars,
    0,
  );

  return {
    text,
    report: {
      mode: promptMode,
      totalChars: text.length,
      contextEntries: contextState.entries,
      contextBudget: {
        fileMaxChars,
        totalMaxChars,
        injectedTotalChars,
        remainingChars: contextState.remainingTotalChars,
      },
    },
  };
}
