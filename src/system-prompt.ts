import { createHash } from 'crypto';
import fs from 'fs';

import { DESTRUCTIVE_COMMAND_NAMES } from './bash-guard.js';
import {
  DEFAULT_CANONICAL_FILE_NAMES,
  isCanonicalScaffoldContent,
} from './memory-paths.js';

export type CodingHint =
  | 'none'
  | 'auto'
  | 'force_delegate_execute'
  | 'force_delegate_plan';

export type ThinkLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';
export type ReasoningLevel = 'off' | 'on' | 'stream';
export type PromptMode = 'full' | 'minimal';

export interface SkillCatalogEntry {
  name: string;
  description: string;
  allowedTools: string[];
  whenToUse: string;
  source: 'project' | 'external';
}

export interface SystemPromptInput {
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  isHeartbeatTask?: boolean;
  assistantName?: string;
  provider?: string;
  model?: string;
  thinkLevel?: ThinkLevel;
  reasoningLevel?: ReasoningLevel;
  noContinue?: boolean;
  memoryContext?: string;
  codingHint: CodingHint;
  requestId?: string;
  extraSystemPrompt?: string;
  skillCatalog?: SkillCatalogEntry[];
}

export interface WorkspacePaths {
  groupDir: string;
  globalDir: string;
  ipcDir: string;
}

export interface ContextEntry {
  label: string;
  path: string;
  rawChars: number;
  injectedChars: number;
  truncated: boolean;
  missing: boolean;
  blocked: boolean;
  blockedPatterns: string[];
  content: string;
}

export interface PromptLayer {
  id: 'base' | 'overlays';
  title: string;
  content: string;
  chars: number;
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
  layers: PromptLayer[];
  baseCacheKey: string;
  basePromptHash: string;
  cacheHit: boolean;
  skillsCatalog: {
    count: number;
    injectedChars: number;
    truncated: boolean;
  };
}

interface CachedBaseLayer {
  key: string;
  hash: string;
  content: string;
}

interface BuildSystemPromptOptions {
  delegationExtensionAvailable?: boolean;
  readFileIfExists?: (filePath: string) => string | null;
  now?: () => Date;
  fileMaxChars?: number;
  totalMaxChars?: number;
  skillCatalogMaxChars?: number;
  cachedBaseLayer?: CachedBaseLayer | null;
}

const DEFAULT_FILE_MAX_CHARS = 12_000;
const DEFAULT_TOTAL_MAX_CHARS = 48_000;
const DEFAULT_MEMORY_CONTEXT_MAX_CHARS = 20_000;
const DEFAULT_SKILL_CATALOG_MAX_CHARS = 6_000;

const MAIN_ALWAYS_INJECTED_FILES = [
  'NANO.md',
  'SOUL.md',
  'TODOS.md',
  'MEMORY.md',
] as const;

function buildDailyMemoryFileNames(now: Date): string[] {
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return [
    `memory/${today.toISOString().slice(0, 10)}.md`,
    `memory/${yesterday.toISOString().slice(0, 10)}.md`,
  ];
}

function resolveDurableMemoryFallbackPath(params: {
  readFileIfExists: (filePath: string) => string | null;
  primaryPath: string;
  legacyPath: string;
}): { label: string; path: string } | null {
  if (params.readFileIfExists(params.primaryPath) !== null) {
    return {
      label: params.primaryPath.endsWith('/MEMORY.md') ? 'MEMORY.md' : 'memory.md',
      path: params.primaryPath,
    };
  }
  if (params.readFileIfExists(params.legacyPath) !== null) {
    return {
      label: params.legacyPath.endsWith('/MEMORY.md') ? 'MEMORY.md' : 'memory.md',
      path: params.legacyPath,
    };
  }
  return null;
}

const PROMPT_INJECTION_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: 'override_previous_instructions',
    pattern:
      /\b(?:ignore|disregard|override)\s+(?:all\s+)?previous instructions\b/i,
  },
  {
    label: 'system_prompt_reference',
    pattern: /\b(?:system prompt|developer message|developer instructions)\b/i,
  },
  {
    label: 'role_reassignment',
    pattern: /\b(?:you are now|act as|role:\s*system)\b/i,
  },
  {
    label: 'tool_call_markup',
    pattern: /<\/?(?:tool_call|assistant|system|developer)\b/i,
  },
  {
    label: 'jailbreak_phrase',
    pattern: /\bjailbreak|prompt injection|ignore safeguards\b/i,
  },
];

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

function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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

function classifyPromptInjection(content: string): string[] {
  const findings = new Set<string>();
  for (const entry of PROMPT_INJECTION_PATTERNS) {
    if (entry.pattern.test(content)) findings.add(entry.label);
  }
  return Array.from(findings);
}

function buildBlockedContent(label: string, patterns: string[]): string {
  return `[BLOCKED: ${label} contained potential prompt injection (${patterns.join(', ')}). Content not loaded.]`;
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
  if (content === null) {
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
      blocked: false,
      blockedPatterns: [],
      content: capped,
    });
    return Math.max(0, params.remainingTotalChars - capped.length);
  }

  const normalized = trimAndNormalize(content);
  const blockedPatterns = classifyPromptInjection(normalized);
  const blocked = blockedPatterns.length > 0;
  const effectiveContent = blocked
    ? buildBlockedContent(params.label, blockedPatterns)
    : normalized;
  const fitted = fitContentToBudget(
    effectiveContent,
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
    truncated: fitted.truncated || injected.length < effectiveContent.length,
    missing: false,
    blocked,
    blockedPatterns,
    content: injected,
  });
  return Math.max(0, params.remainingTotalChars - injected.length);
}

function buildMainContextEntries(params: {
  readFileIfExists: (filePath: string) => string | null;
  includeHeartbeat: boolean;
  fileMaxChars: number;
  totalMaxChars: number;
  groupDir: string;
  now: Date;
}): {
  entries: ContextEntry[];
  remainingTotalChars: number;
} {
  const entries: ContextEntry[] = [];
  let remaining = params.totalMaxChars;

  for (const name of MAIN_ALWAYS_INJECTED_FILES) {
    remaining = addContextEntry({
      entries,
      readFileIfExists: params.readFileIfExists,
      label: name,
      path: `${params.groupDir}/${name}`,
      fileMaxChars: params.fileMaxChars,
      remainingTotalChars: remaining,
    });
  }

  for (const fileName of DEFAULT_CANONICAL_FILE_NAMES) {
    if (remaining <= 0) break;
    const canonicalPath = `${params.groupDir}/canonical/${fileName}`;
    const content = params.readFileIfExists(canonicalPath);
    if (!content || isCanonicalScaffoldContent(fileName, content)) continue;
    remaining = addContextEntry({
      entries,
      readFileIfExists: params.readFileIfExists,
      label: `canonical/${fileName}`,
      path: canonicalPath,
      fileMaxChars: params.fileMaxChars,
      remainingTotalChars: remaining,
      includeMissing: false,
    });
  }

  for (const relativePath of buildDailyMemoryFileNames(params.now)) {
    if (remaining <= 0) break;
    remaining = addContextEntry({
      entries,
      readFileIfExists: params.readFileIfExists,
      label: relativePath,
      path: `${params.groupDir}/${relativePath}`,
      fileMaxChars: params.fileMaxChars,
      remainingTotalChars: remaining,
      includeMissing: false,
    });
  }

  if (params.includeHeartbeat && remaining > 0) {
    remaining = addContextEntry({
      entries,
      readFileIfExists: params.readFileIfExists,
      label: 'HEARTBEAT.md',
      path: `${params.groupDir}/HEARTBEAT.md`,
      fileMaxChars: params.fileMaxChars,
      remainingTotalChars: remaining,
      includeMissing: false,
    });
  }

  return { entries, remainingTotalChars: remaining };
}

function buildNonMainContextEntries(params: {
  readFileIfExists: (filePath: string) => string | null;
  includeHeartbeat: boolean;
  fileMaxChars: number;
  totalMaxChars: number;
  groupDir: string;
  globalDir: string;
}): {
  entries: ContextEntry[];
  remainingTotalChars: number;
} {
  const entries: ContextEntry[] = [];
  let remaining = params.totalMaxChars;

  remaining = addContextEntry({
    entries,
    readFileIfExists: params.readFileIfExists,
    label: 'global/NANO.md',
    path: `${params.globalDir}/NANO.md`,
    fileMaxChars: params.fileMaxChars,
    remainingTotalChars: remaining,
  });
  if (remaining > 0) {
    remaining = addContextEntry({
      entries,
      readFileIfExists: params.readFileIfExists,
      label: 'group/NANO.md',
      path: `${params.groupDir}/NANO.md`,
      fileMaxChars: params.fileMaxChars,
      remainingTotalChars: remaining,
      includeMissing: false,
    });
  }

  remaining = addContextEntry({
    entries,
    readFileIfExists: params.readFileIfExists,
    label: 'global/SOUL.md',
    path: `${params.globalDir}/SOUL.md`,
    fileMaxChars: params.fileMaxChars,
    remainingTotalChars: remaining,
  });
  if (remaining > 0) {
    remaining = addContextEntry({
      entries,
      readFileIfExists: params.readFileIfExists,
      label: 'group/SOUL.md',
      path: `${params.groupDir}/SOUL.md`,
      fileMaxChars: params.fileMaxChars,
      remainingTotalChars: remaining,
    });
  }

  if (remaining > 0) {
    remaining = addContextEntry({
      entries,
      readFileIfExists: params.readFileIfExists,
      label: 'global/TODOS.md',
      path: `${params.globalDir}/TODOS.md`,
      fileMaxChars: params.fileMaxChars,
      remainingTotalChars: remaining,
      includeMissing: false,
    });
  }

  if (remaining > 0) {
    remaining = addContextEntry({
      entries,
      readFileIfExists: params.readFileIfExists,
      label: 'group/TODOS.md',
      path: `${params.groupDir}/TODOS.md`,
      fileMaxChars: params.fileMaxChars,
      remainingTotalChars: remaining,
      includeMissing: false,
    });
  }

  if (params.includeHeartbeat && remaining > 0) {
    remaining = addContextEntry({
      entries,
      readFileIfExists: params.readFileIfExists,
      label: 'group/HEARTBEAT.md',
      path: `${params.groupDir}/HEARTBEAT.md`,
      fileMaxChars: params.fileMaxChars,
      remainingTotalChars: remaining,
      includeMissing: false,
    });
  }

  const globalMemoryFallback =
    remaining > 0
      ? resolveDurableMemoryFallbackPath({
          readFileIfExists: params.readFileIfExists,
          primaryPath: `${params.globalDir}/MEMORY.md`,
          legacyPath: `${params.globalDir}/memory.md`,
        })
      : null;
  if (globalMemoryFallback && remaining > 0) {
    remaining = addContextEntry({
      entries,
      readFileIfExists: params.readFileIfExists,
      label: `global/${globalMemoryFallback.label}`,
      path: globalMemoryFallback.path,
      fileMaxChars: params.fileMaxChars,
      remainingTotalChars: remaining,
      includeMissing: false,
    });
  }

  const groupMemoryFallback =
    remaining > 0
      ? resolveDurableMemoryFallbackPath({
          readFileIfExists: params.readFileIfExists,
          primaryPath: `${params.groupDir}/MEMORY.md`,
          legacyPath: `${params.groupDir}/memory.md`,
        })
      : null;
  if (groupMemoryFallback && remaining > 0) {
    remaining = addContextEntry({
      entries,
      readFileIfExists: params.readFileIfExists,
      label: `group/${groupMemoryFallback.label}`,
      path: groupMemoryFallback.path,
      fileMaxChars: params.fileMaxChars,
      remainingTotalChars: remaining,
      includeMissing: false,
    });
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

function renderSkillCatalog(
  entries: SkillCatalogEntry[],
  maxChars: number,
): { text: string; injectedChars: number; count: number; truncated: boolean } {
  if (entries.length === 0) {
    return { text: '', injectedChars: 0, count: 0, truncated: false };
  }
  const lines = [
    '## Skills Catalog',
    'These are compact skill summaries only. Read full SKILL.md bodies on demand when needed.',
    '',
  ];
  for (const entry of entries) {
    const toolText =
      entry.allowedTools.length > 0
        ? ` Allowed tools: ${entry.allowedTools.join(', ')}.`
        : '';
    lines.push(
      `- ${entry.name} [${entry.source}]: ${entry.description}.${toolText} When to use: ${entry.whenToUse}`,
    );
  }
  const raw = lines.join('\n').trim();
  const fitted = fitContentToBudget(raw, 'skills catalog', maxChars, maxChars);
  const text = fitted?.injected || '';
  return {
    text,
    injectedChars: text.length,
    count: entries.length,
    truncated: fitted?.truncated || false,
  };
}

function buildBaseCacheKey(params: {
  assistantName: string;
  promptMode: PromptMode;
  isMain: boolean;
  codingHint: CodingHint;
  canDelegateToCoder: boolean;
  autoDelegationEnabled: boolean;
  contextEntries: ContextEntry[];
  skillCatalogText: string;
}): string {
  const payload = {
    assistantName: params.assistantName,
    promptMode: params.promptMode,
    isMain: params.isMain,
    codingHint: params.codingHint,
    canDelegateToCoder: params.canDelegateToCoder,
    autoDelegationEnabled: params.autoDelegationEnabled,
    skillCatalogHash: hashString(params.skillCatalogText),
    contextEntries: params.contextEntries.map((entry) => ({
      path: entry.path,
      missing: entry.missing,
      blocked: entry.blocked,
      blockedPatterns: entry.blockedPatterns,
      rawChars: entry.rawChars,
      contentHash: hashString(entry.content),
    })),
  };
  return hashString(JSON.stringify(payload));
}

function renderBasePrompt(params: {
  assistantName: string;
  paths: WorkspacePaths;
  contextEntries: ContextEntry[];
  skillCatalogText: string;
  forcedDelegateMode: 'execute' | 'plan' | null;
  canDelegateToCoder: boolean;
  autoDelegationEnabled: boolean;
}): string {
  const lines: string[] = [];
  lines.push(
    `You are ${params.assistantName}, a practical and capable operator running inside FFT_nano.`,
  );
  lines.push('Default stance: act, verify, and report concrete outcomes.');
  lines.push('');
  lines.push('## Safety');
  lines.push(
    'Be truthful about tool usage and results. Never fabricate file edits, command output, or runtime state.',
  );
  lines.push(
    `BLOCKED COMMANDS: The following are forbidden without explicit user confirmation: ${DESTRUCTIVE_COMMAND_NAMES.join(', ')}.`,
  );
  lines.push(
    'If you need a destructive operation: describe the exact command, explain why, and WAIT for user confirmation.',
  );
  lines.push(
    'Prefer non-destructive alternatives (move to tmp, git stash, etc.) when possible.',
  );
  lines.push('');
  lines.push('## Tooling');
  lines.push(
    'You run in pi coding runtime with filesystem and shell tools (commonly read, bash, edit, write, grep, find, ls).',
  );
  lines.push(
    'Do not claim you are text-only or unable to access local files/commands before actually trying tools.',
  );
  lines.push(
    'When asked to verify state, run commands and report concrete evidence.',
  );
  lines.push('');
  lines.push('## Workspace');
  lines.push(`- ${params.paths.groupDir} is writable workspace.`);
  lines.push(
    `- ${params.paths.ipcDir} is host bridge for outbound messages and scheduler actions.`,
  );
  lines.push(
    `- Active mission state belongs in ${params.paths.groupDir}/TODOS.md.`,
  );
  lines.push(
    `- Durable memory belongs in ${params.paths.groupDir}/canonical/*.md.`,
  );
  lines.push(
    `- Daily staging and compaction notes belong in ${params.paths.groupDir}/memory/*.md.`,
  );
  lines.push('- Keep SOUL.md stable; do not use it as compaction log storage.');
  lines.push('');

  if (params.canDelegateToCoder) {
    lines.push('## Coding Delegation');
    lines.push(
      `This run requires explicit delegation: call delegate_to_coding_agent exactly once with mode="${params.forcedDelegateMode}".`,
    );
    if (params.forcedDelegateMode === 'plan') {
      lines.push(
        'Return a concrete implementation plan; do not apply file edits in this outer run.',
      );
    } else {
      lines.push(
        'Execute through delegated coder and return delegated outcomes.',
      );
    }
    lines.push('');
  } else if (params.forcedDelegateMode && !params.canDelegateToCoder) {
    lines.push('## Coding Delegation');
    lines.push(
      'Delegation is unavailable for this run (not main, scheduled task, or extension not loaded). Proceed directly with tools.',
    );
    lines.push('');
  } else if (params.autoDelegationEnabled) {
    lines.push('## Coding Delegation');
    lines.push(
      'You may delegate substantial software engineering work (multi-file implementation, deep debugging, broad refactors, full validation).',
    );
    lines.push(
      'If intent is ambiguous, ask one concise clarification before delegating.',
    );
    lines.push('For small tasks, complete directly in this run.');
    lines.push('');
  }

  if (params.skillCatalogText) {
    lines.push(params.skillCatalogText);
    lines.push('');
  }

  lines.push('## Messaging IPC');
  lines.push(
    `To proactively message current chat, write JSON into ${params.paths.ipcDir}/messages/*.json:`,
  );
  lines.push('{"type":"message","chatJid":"<jid>","text":"<text>"}');
  lines.push('Write atomically (temp file then rename).');
  lines.push('');
  lines.push('## Scheduler IPC');
  lines.push(
    `To manage tasks, write JSON into ${params.paths.ipcDir}/tasks/*.json with one of:`,
  );
  lines.push(
    '- v2: {"type":"schedule_task","prompt":"...","schedule":{"kind":"cron|every|at",...},"session_target":"main|isolated","wake_mode":"next-heartbeat|now","delivery":{"mode":"none|announce|webhook","to":"<jid?>","webhookUrl":"https://..."},"timeout_seconds":120,"stagger_ms":2500,"delete_after_run":false,"context_mode":"group|isolated","groupFolder":"<folder>"}',
  );
  lines.push(
    '- {"type":"schedule_task","prompt":"...","schedule_type":"cron|interval|once","schedule_value":"...","context_mode":"group|isolated","groupFolder":"<folder>"}',
  );
  lines.push('- legacy payloads remain supported for backward compatibility.');
  lines.push('- {"type":"pause_task","taskId":"..."}');
  lines.push('- {"type":"resume_task","taskId":"..."}');
  lines.push('- {"type":"cancel_task","taskId":"..."}');
  lines.push('- Main-only: {"type":"refresh_groups"}');
  lines.push(
    `- Main-only: {"type":"register_group","jid":"...","name":"...","folder":"...","trigger":"@${params.assistantName}"}`,
  );
  lines.push(
    `Read task snapshot from ${params.paths.ipcDir}/current_tasks.json when needed.`,
  );
  lines.push('');
  lines.push('## Memory Action IPC');
  lines.push(
    `Write memory action requests into ${params.paths.ipcDir}/actions/*.json and read results from ${params.paths.ipcDir}/action_results/<requestId>.json.`,
  );
  lines.push(
    '- In non-main/shared runs, group/global MEMORY.md falls back into the prompt when present. Use memory_search or memory_get for broader recall.',
  );
  lines.push('- Search: {"type":"memory_action","action":"memory_search","requestId":"<id>","params":{"query":"...","topK":8,"sources":"all"}}');
  lines.push('- Get: {"type":"memory_action","action":"memory_get","requestId":"<id>","params":{"path":"MEMORY.md"}}');
  lines.push('- Write: {"type":"memory_action","action":"memory_write","requestId":"<id>","params":{"intent":"todo_upsert_task","payload":{"entryId":"T1","text":"...","status":"PENDING"}}}');
  lines.push('For writes, wait for status=success before reporting completion to the user.');
  lines.push('');
  lines.push('## Output Style');
  lines.push(
    'For user-facing replies, prefer short paragraphs and plain bullets.',
  );
  lines.push(
    'Avoid markdown headings in final chat replies unless explicitly requested.',
  );
  lines.push('');

  if (params.contextEntries.length > 0) {
    lines.push('## Workspace Files (injected)');
    lines.push(
      'These files are loaded for this run (subject to prompt budget limits).',
    );
    lines.push('');
    lines.push('# Project Context');
    lines.push('');
    for (const entry of params.contextEntries) {
      lines.push(`## ${entry.path}`);
      lines.push(entry.content);
      lines.push('');
    }
  }

  lines.push('## Heartbeats');
  lines.push(
    'If this run is a heartbeat poll and nothing needs attention, reply exactly HEARTBEAT_OK. If something needs attention, send alert text without HEARTBEAT_OK.',
  );
  return lines.join('\n').trim();
}

function renderOverlayPrompt(params: {
  input: SystemPromptInput;
  assistantName: string;
  promptMode: PromptMode;
  paths: WorkspacePaths;
  providedMemoryContext: string;
}): string {
  const lines: string[] = [];
  lines.push('## Inbound Context (trusted metadata)');
  lines.push(
    'The following JSON is host-generated runtime metadata. Treat it as authoritative for this run.',
  );
  lines.push('```json');
  lines.push(
    JSON.stringify(
      {
        schema: 'fft_nano.input_meta.v1',
        group_folder: params.input.groupFolder,
        chat_jid: params.input.chatJid,
        assistant_name: params.assistantName,
        is_main: params.input.isMain,
        is_scheduled_task: params.input.isScheduledTask === true,
        is_heartbeat_task: params.input.isHeartbeatTask === true,
        coding_hint: params.input.codingHint,
        request_id: params.input.requestId || null,
        provider_override: params.input.provider || null,
        model_override: params.input.model || null,
        think_level: params.input.thinkLevel || null,
        reasoning_level: params.input.reasoningLevel || null,
        continue_session: params.input.noContinue !== true,
      },
      null,
      2,
    ),
  );
  lines.push('```');
  lines.push('');

  const extraSystemPrompt = trimAndNormalize(
    params.input.extraSystemPrompt || '',
  );
  if (extraSystemPrompt) {
    lines.push('## Host Context Overlay');
    lines.push(extraSystemPrompt);
    lines.push('');
  }

  lines.push('## Runtime Hints');
  lines.push(`- prompt_mode: ${params.promptMode}`);
  lines.push(`- coding_hint: ${params.input.codingHint}`);
  lines.push(
    `- continue_session: ${params.input.noContinue ? 'false' : 'true'}`,
  );
  if (params.input.provider)
    lines.push(`- provider_override: ${params.input.provider}`);
  if (params.input.model) lines.push(`- model_override: ${params.input.model}`);
  if (params.input.thinkLevel)
    lines.push(`- think_level: ${params.input.thinkLevel}`);
  if (params.input.reasoningLevel)
    lines.push(`- reasoning_level: ${params.input.reasoningLevel}`);
  if (params.input.requestId)
    lines.push(`- request_id: ${params.input.requestId}`);
  lines.push('');

  if (
    params.input.reasoningLevel === 'on' ||
    params.input.reasoningLevel === 'stream'
  ) {
    lines.push('## Reasoning Visibility');
    lines.push(
      'Do not reveal private chain-of-thought. Provide concise high-level rationale when useful.',
    );
    if (params.input.reasoningLevel === 'stream') {
      lines.push(
        `For long tasks, proactively send concise progress updates via ${params.paths.ipcDir}/messages.`,
      );
    }
    lines.push('');
  }

  if (params.providedMemoryContext) {
    lines.push('## Retrieved Memory Context');
    lines.push(clampMemoryContext(params.providedMemoryContext));
  }

  return lines.join('\n').trim();
}

export function buildSystemPrompt(
  input: SystemPromptInput,
  paths: WorkspacePaths,
  options: BuildSystemPromptOptions = {},
): { text: string; report: SystemPromptReport } {
  const readFileIfExists = options.readFileIfExists ?? defaultReadFileIfExists;
  const fileMaxChars =
    options.fileMaxChars ??
    parsePositiveInt(
      process.env.FFT_NANO_PROMPT_FILE_MAX_CHARS,
      DEFAULT_FILE_MAX_CHARS,
    );
  const totalMaxChars =
    options.totalMaxChars ??
    parsePositiveInt(
      process.env.FFT_NANO_PROMPT_TOTAL_MAX_CHARS,
      DEFAULT_TOTAL_MAX_CHARS,
    );
  const skillCatalogMaxChars =
    options.skillCatalogMaxChars ??
    parsePositiveInt(
      process.env.FFT_NANO_SKILL_CATALOG_MAX_CHARS,
      DEFAULT_SKILL_CATALOG_MAX_CHARS,
    );
  const promptMode: PromptMode = input.isScheduledTask ? 'minimal' : 'full';
  const assistantName =
    (input.assistantName || 'FarmFriend').trim() || 'FarmFriend';
  const providedMemoryContext = trimAndNormalize(input.memoryContext || '');
  const isHeartbeatRun =
    input.isHeartbeatTask === true ||
    (input.requestId || '').startsWith('heartbeat-');
  const includeHeartbeatContext = input.isScheduledTask === true || isHeartbeatRun;

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

  const contextState = input.isMain
    ? buildMainContextEntries({
        readFileIfExists,
      includeHeartbeat: includeHeartbeatContext,
      fileMaxChars,
      totalMaxChars,
      groupDir: paths.groupDir,
      now: options.now?.() ?? new Date(),
    })
    : buildNonMainContextEntries({
        readFileIfExists,
        includeHeartbeat: includeHeartbeatContext,
        fileMaxChars,
        totalMaxChars,
        groupDir: paths.groupDir,
        globalDir: paths.globalDir,
      });

  const skillCatalog =
    !input.isScheduledTask && !isHeartbeatRun
      ? renderSkillCatalog(input.skillCatalog || [], skillCatalogMaxChars)
      : { text: '', injectedChars: 0, count: 0, truncated: false };

  const baseCacheKey = buildBaseCacheKey({
    assistantName,
    promptMode,
    isMain: input.isMain,
    codingHint: input.codingHint,
    canDelegateToCoder,
    autoDelegationEnabled,
    contextEntries: contextState.entries,
    skillCatalogText: skillCatalog.text,
  });

  const cacheHit =
    options.cachedBaseLayer?.key === baseCacheKey &&
    typeof options.cachedBaseLayer.content === 'string' &&
    options.cachedBaseLayer.content.length > 0;
  const baseContent = cacheHit
    ? options.cachedBaseLayer!.content
    : renderBasePrompt({
        assistantName,
        paths,
        contextEntries: contextState.entries,
        skillCatalogText: skillCatalog.text,
        forcedDelegateMode,
        canDelegateToCoder,
        autoDelegationEnabled,
      });
  const overlayContent = renderOverlayPrompt({
    input,
    assistantName,
    promptMode,
    paths,
    providedMemoryContext,
  });
  const text = [baseContent, overlayContent]
    .filter(Boolean)
    .join('\n\n')
    .trim();
  const injectedTotalChars = contextState.entries.reduce(
    (sum, entry) => sum + entry.injectedChars,
    0,
  );
  const basePromptHash = hashString(baseContent);

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
      layers: [
        {
          id: 'base',
          title: 'Base Prompt',
          content: baseContent,
          chars: baseContent.length,
        },
        {
          id: 'overlays',
          title: 'Runtime Overlays',
          content: overlayContent,
          chars: overlayContent.length,
        },
      ],
      baseCacheKey,
      basePromptHash,
      cacheHit,
      skillsCatalog: {
        count: skillCatalog.count,
        injectedChars: skillCatalog.injectedChars,
        truncated: skillCatalog.truncated,
      },
    },
  };
}
