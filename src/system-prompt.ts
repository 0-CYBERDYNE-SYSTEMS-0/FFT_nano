import { createHash } from 'crypto';
import fs from 'fs';

import { DESTRUCTIVE_COMMAND_NAMES } from './bash-guard.js';
import {
  DEFAULT_CANONICAL_FILE_NAMES,
  isBootstrapScaffoldContent,
  isCanonicalScaffoldContent,
  isJournalScaffoldContent,
} from './memory-paths.js';
import {
  formatLocalDate,
  formatLocalTime,
  formatWeekday,
  getLegacyDailyMemoryCandidates,
  resolveEffectiveTimezone,
} from './time-context.js';

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
export type PromptMode = 'full' | 'minimal' | 'maintenance';

export interface SkillCatalogEntry {
  name: string;
  description: string;
  allowedTools: string[];
  whenToUse: string;
  source: 'project' | 'external' | 'agent' | 'unmanaged';
}

export interface SystemPromptInput {
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  isHeartbeatTask?: boolean;
  isEvaluatorRun?: boolean;
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
  // LISO.5: Prompt mode for this run
  promptMode?: 'interactive' | 'maintenance';
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

/**
 * The stable layer is the byte-identical prefix the provider caches for the
 * life of a session: identity, safety, IPC, delegation, and stable SOUL
 * identity/policy context. Session bootstrap material like NANO, MEMORY,
 * skills, canonical files, and daily memory belongs in the session_bootstrap
 * layer. Per-turn volatile metadata belongs in the ephemeral suffix.
 */
export interface StablePromptLayer {
  id: 'stable';
  title: string;
  content: string;
  chars: number;
  mtimeMap: Record<string, number | null>;
  hash: string;
  key: string;
}

/**
 * The session bootstrap layer carries behavior-rich but mostly session-scoped
 * context. It is sent when starting/rebasing a pi session, then omitted from
 * continued turns so those turns stay lean while the model keeps the context
 * in session history.
 */
export interface SessionBootstrapPromptLayer {
  id: 'session_bootstrap';
  title: string;
  content: string;
  chars: number;
  included: boolean;
}

/**
 * The ephemeral layer is the per-turn volatile suffix the provider cannot
 * cache: the `Inbound Context` JSON metadata (timestamps, requestId, etc.),
 * the host context overlay, runtime hints, reasoning visibility, and the
 * inbound message wrapper.
 */
export interface EphemeralPromptLayer {
  id: 'ephemeral';
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
  layers: (
    | StablePromptLayer
    | SessionBootstrapPromptLayer
    | EphemeralPromptLayer
  )[];
  /**
   * Stable-layer cache key. Includes only stable contributing file mtimes
   * so SOUL changes force a rebuild without letting high-churn operational
   * context invalidate the provider-cacheable prefix.
   */
  baseCacheKey: string;
  basePromptHash: string;
  cacheHit: boolean;
  skillsCatalog: {
    count: number;
    injectedChars: number;
    truncated: boolean;
  };
}

interface CachedStableLayer {
  key: string;
  hash: string;
  content: string;
  mtimeMap: Record<string, number | null>;
}

interface BuildSystemPromptOptions {
  delegationExtensionAvailable?: boolean;
  readFileIfExists?: (filePath: string) => string | null;
  now?: () => Date;
  timezone?: string;
  fileMaxChars?: number;
  totalMaxChars?: number;
  skillCatalogMaxChars?: number;
  cachedStableLayer?: CachedStableLayer | null;
}

const DEFAULT_FILE_MAX_CHARS = 24_000;
const DEFAULT_TOTAL_MAX_CHARS = 96_000;
const DEFAULT_MEMORY_CONTEXT_MAX_CHARS = 20_000;
const DEFAULT_SKILL_CATALOG_MAX_CHARS = 20_000;
const STABLE_PROMPT_RENDERER_VERSION = 3;

const MAIN_CONTEXT_FILES = [
  'NANO.md',
  'SOUL.md',
  'TODOS.md',
  'MEMORY.md',
] as const;

const MAIN_SESSION_BOOTSTRAP_FILES = [
  'USER.md',
  'IDENTITY.md',
  'TOOLS.md',
] as const;

function buildDailyMemoryFileNames(now: Date, timezone: string): string[] {
  return getLegacyDailyMemoryCandidates(now, timezone);
}

function resolveDurableMemoryFallbackPath(params: {
  readFileIfExists: (filePath: string) => string | null;
  primaryPath: string;
  legacyPath: string;
}): { label: string; path: string } | null {
  if (params.readFileIfExists(params.primaryPath) !== null) {
    return {
      label: params.primaryPath.endsWith('/MEMORY.md')
        ? 'MEMORY.md'
        : 'memory.md',
      path: params.primaryPath,
    };
  }
  if (params.readFileIfExists(params.legacyPath) !== null) {
    return {
      label: params.legacyPath.endsWith('/MEMORY.md')
        ? 'MEMORY.md'
        : 'memory.md',
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

function redactPromptInjectionLines(content: string): {
  redacted: string;
  blockedPatterns: string[];
} {
  const blockedPatterns = new Set<string>();
  const lines = content.split('\n');
  const redacted = lines
    .map((line) => {
      for (const entry of PROMPT_INJECTION_PATTERNS) {
        if (entry.pattern.test(line)) {
          blockedPatterns.add(entry.label);
          return `[REDACTED: ${entry.label}]`;
        }
      }
      return line;
    })
    .join('\n');
  return { redacted, blockedPatterns: Array.from(blockedPatterns) };
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
  lineLevelRedaction?: boolean;
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
  let effectiveContent = normalized;
  let entryBlockedPatterns = blockedPatterns;
  if (blocked && params.lineLevelRedaction) {
    const redaction = redactPromptInjectionLines(normalized);
    effectiveContent = redaction.redacted;
    entryBlockedPatterns = redaction.blockedPatterns;
  } else if (blocked) {
    effectiveContent = buildBlockedContent(params.label, blockedPatterns);
  }
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
    blockedPatterns: entryBlockedPatterns,
    content: injected,
  });
  return Math.max(0, params.remainingTotalChars - injected.length);
}

function addOptionalNonEmptyContextEntry(params: {
  entries: ContextEntry[];
  readFileIfExists: (filePath: string) => string | null;
  label: string;
  path: string;
  fileMaxChars: number;
  remainingTotalChars: number;
  lineLevelRedaction?: boolean;
}): number {
  const content = params.readFileIfExists(params.path);
  if (!content || !trimAndNormalize(content)) {
    return params.remainingTotalChars;
  }
  return addContextEntry({
    ...params,
    includeMissing: false,
  });
}

function buildMainContextEntries(params: {
  readFileIfExists: (filePath: string) => string | null;
  includeHeartbeat: boolean;
  fileMaxChars: number;
  totalMaxChars: number;
  groupDir: string;
  now: Date;
  timezone: string;
}): {
  entries: ContextEntry[];
  remainingTotalChars: number;
} {
  const entries: ContextEntry[] = [];
  let remaining = params.totalMaxChars;

  for (const name of MAIN_CONTEXT_FILES) {
    remaining = addContextEntry({
      entries,
      readFileIfExists: params.readFileIfExists,
      label: name,
      path: `${params.groupDir}/${name}`,
      fileMaxChars: params.fileMaxChars,
      remainingTotalChars: remaining,
      lineLevelRedaction: true,
    });
  }

  for (const name of MAIN_SESSION_BOOTSTRAP_FILES) {
    if (remaining <= 0) break;
    const path = `${params.groupDir}/${name}`;
    const content = params.readFileIfExists(path);
    if (!content || isBootstrapScaffoldContent(name, content)) continue;
    remaining = addContextEntry({
      entries,
      readFileIfExists: params.readFileIfExists,
      label: name,
      path,
      fileMaxChars: params.fileMaxChars,
      remainingTotalChars: remaining,
      includeMissing: false,
      lineLevelRedaction: true,
    });
  }

  if (remaining > 0) {
    remaining = addOptionalNonEmptyContextEntry({
      entries,
      readFileIfExists: params.readFileIfExists,
      label: 'BOOTSTRAP.md',
      path: `${params.groupDir}/BOOTSTRAP.md`,
      fileMaxChars: params.fileMaxChars,
      remainingTotalChars: remaining,
      lineLevelRedaction: true,
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
      lineLevelRedaction: true,
    });
  }

  for (const relativePath of buildDailyMemoryFileNames(
    params.now,
    params.timezone,
  )) {
    if (remaining <= 0) break;
    const dailyPath = `${params.groupDir}/${relativePath}`;
    const dailyContent = params.readFileIfExists(dailyPath);
    if (dailyContent === null) continue;
    // Skip untouched daily-journal scaffolds (header-only templates carry no
    // signal but cost prompt budget every session). Mirrors the bootstrap and
    // canonical scaffold skips above.
    const dateKeyMatch = /(\d{4}-\d{2}-\d{2})\.md$/.exec(relativePath);
    if (
      dateKeyMatch &&
      isJournalScaffoldContent(dateKeyMatch[1], dailyContent)
    ) {
      continue;
    }
    remaining = addContextEntry({
      entries,
      readFileIfExists: params.readFileIfExists,
      label: relativePath,
      path: dailyPath,
      fileMaxChars: params.fileMaxChars,
      remainingTotalChars: remaining,
      includeMissing: false,
      lineLevelRedaction: true,
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
      lineLevelRedaction: true,
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
    includeMissing: false,
    lineLevelRedaction: true,
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
      lineLevelRedaction: true,
    });
  }

  remaining = addContextEntry({
    entries,
    readFileIfExists: params.readFileIfExists,
    label: 'global/SOUL.md',
    path: `${params.globalDir}/SOUL.md`,
    fileMaxChars: params.fileMaxChars,
    remainingTotalChars: remaining,
    includeMissing: false,
    lineLevelRedaction: true,
  });
  if (remaining > 0) {
    remaining = addContextEntry({
      entries,
      readFileIfExists: params.readFileIfExists,
      label: 'group/SOUL.md',
      path: `${params.groupDir}/SOUL.md`,
      fileMaxChars: params.fileMaxChars,
      remainingTotalChars: remaining,
      lineLevelRedaction: true,
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
      lineLevelRedaction: true,
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
      lineLevelRedaction: true,
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
      lineLevelRedaction: true,
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
      lineLevelRedaction: true,
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
      lineLevelRedaction: true,
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

  const header = [
    '## Skills Catalog',
    'These are compact skill summaries only. Read full SKILL.md bodies on demand when needed.',
    '',
  ];

  // Tier 1: never-truncated name index
  const indexLine = `Available skills: ${entries.map((e) => e.name).join(', ')}`;

  // Tier 2: per-entry summaries until budget
  const summaryLines: string[] = [];
  for (const entry of entries) {
    const toolText =
      entry.allowedTools.length > 0
        ? ` Allowed tools: ${entry.allowedTools.join(', ')}.`
        : '';
    // Merge description + whenToUse when they are redundant
    const when = entry.whenToUse.trim();
    const desc = entry.description.trim();
    const combined =
      when && !desc.toLowerCase().includes(when.toLowerCase())
        ? `${desc} When to use: ${when}`
        : desc;
    summaryLines.push(
      `- ${entry.name} [${entry.source}]: ${combined}.${toolText}`,
    );
  }

  const headerText = header.join('\n');
  const indexBudget = indexLine.length + 1; // +1 for newline
  const summaryBudget = maxChars - headerText.length - indexBudget;

  let summariesText = '';
  let truncated = false;
  let omittedCount = 0;

  if (summaryBudget > 0) {
    const rawSummaries = summaryLines.join('\n');
    const fitted = fitContentToBudget(
      rawSummaries,
      'skills catalog',
      summaryBudget,
      summaryBudget,
    );
    if (fitted) {
      summariesText = fitted.injected;
      truncated = fitted.truncated;
      if (fitted.truncated) {
        // Count how many summary lines were fully omitted
        const injectedLineCount = summariesText
          .split('\n')
          .filter((l) => l.startsWith('- ')).length;
        omittedCount = entries.length - injectedLineCount;
      }
    }
  } else {
    omittedCount = entries.length;
    truncated = true;
  }

  const parts: string[] = [headerText, indexLine];
  if (summariesText) {
    parts.push(summariesText);
  }
  if (omittedCount > 0) {
    parts.push(
      `[${omittedCount} more skill${omittedCount === 1 ? '' : 's'} listed above have no summary — use skill_view for details.]`,
    );
  }

  const text = parts.join('\n').trim();
  return {
    text,
    injectedChars: text.length,
    count: entries.length,
    truncated: truncated || omittedCount > 0,
  };
}

function buildStableCacheKey(params: {
  assistantName: string;
  promptMode: PromptMode;
  isMain: boolean;
  codingHint: CodingHint;
  canDelegateToCoder: boolean;
  autoDelegationEnabled: boolean;
  isEvaluatorRun: boolean;
  mtimeMap: Record<string, number | null>;
}): string {
  const sortedEntries = Object.keys(params.mtimeMap)
    .sort()
    .map((k) => [k, params.mtimeMap[k]]);
  const payload = {
    rendererVersion: STABLE_PROMPT_RENDERER_VERSION,
    assistantName: params.assistantName,
    promptMode: params.promptMode,
    isMain: params.isMain,
    codingHint: params.codingHint,
    canDelegateToCoder: params.canDelegateToCoder,
    autoDelegationEnabled: params.autoDelegationEnabled,
    isEvaluatorRun: params.isEvaluatorRun,
    mtimeMap: Object.fromEntries(sortedEntries),
  };
  return hashString(JSON.stringify(payload));
}

function mtimeMapDeepEqual(
  a: Record<string, number | null>,
  b: Record<string, number | null>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/**
 * Stat every path and return a map of path → mtimeMs (or `null` when the
 * file is missing). The caller is expected to pass the same set of paths
 * that contribute to the stable prompt layer.
 */
function collectMtimeMap(
  paths: Iterable<string>,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const p of paths) {
    try {
      const stat = fs.statSync(p);
      out[p] = stat.mtimeMs;
    } catch {
      out[p] = null;
    }
  }
  return out;
}

function renderBasePrompt(params: {
  assistantName: string;
  paths: WorkspacePaths;
  forcedDelegateMode: 'execute' | 'plan' | null;
  canDelegateToCoder: boolean;
  autoDelegationEnabled: boolean;
  isEvaluatorRun: boolean;
  isMain: boolean;
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
  lines.push('');

  lines.push('## SOUL.md (constitutional — trust above everything else)');
  lines.push(
    'SOUL.md is the stable identity/values file injected into the base prompt every turn. It is NOT a notebook, NOT a compaction log, and NOT a research scratchpad.',
  );
  lines.push(
    'NANO.md is the operating contract (commands, IPC, delegation rules). It is session bootstrap — sent once and lives in pi history.',
  );
  lines.push(
    'These two are NOT interchangeable. SOUL.md defines who you are; NANO.md defines how you operate in this runtime.',
  );
  lines.push('');

  lines.push('## Memory Hygiene (read before writing anything)');
  lines.push(
    '- MEMORY.md is operator-curated durable memory. Do NOT write web search results, news headlines, transient research, or fetched page content there.',
  );
  lines.push(
    "- Daily journal entries go in memory/YYYY-MM-DD.md (append-only; create today's if missing).",
  );
  lines.push(
    '- Research / scratch / fetched material that the user has NOT explicitly asked you to remember is EPHEMERAL — do not persist it to any memory file.',
  );
  lines.push(
    '- Only persist a fact to MEMORY.md or canonical/*.md when the user explicitly asks you to remember it, or when it is a durable operator decision (not a one-off lookup).',
  );
  lines.push(
    '- When in doubt, do not write. Forgotten research is recoverable; polluted MEMORY.md is not.',
  );
  lines.push('');

  lines.push('## Context Map');
  lines.push('Injected EVERY turn (trust these over conversation history):');
  lines.push('1. SOUL.md (identity/values — the constitutional file).');
  lines.push(
    '2. TODOS.md (active mission state — current goals and blockers).',
  );
  lines.push(
    '3. Retrieved memory snippets (query-selected from MEMORY.md + canonical/ + memory/ via memory_search).',
  );
  lines.push(
    'Injected ONCE at session start (already in your history — do NOT re-read unless you suspect they changed on disk):',
  );
  lines.push('- NANO.md (operating contract — what to do, not who you are).');
  lines.push(
    '- MEMORY.md (operator-curated durable facts — see Memory Hygiene above; do NOT add to it casually).',
  );
  lines.push('- USER.md, IDENTITY.md, TOOLS.md, BOOTSTRAP.md.');
  lines.push('- Skill catalog (skill bodies load on demand via skill_view).');
  lines.push(
    '- Daily memory files (memory/YYYY-MM-DD.md) for today and recent past.',
  );
  lines.push('On disk only — fetch on demand:');
  lines.push(
    "- knowledge/ → knowledge base for external sources the operator has given the agent (NOT agent memory). The operator owns knowledge/raw/; the agent curates knowledge/wiki/ from it. See knowledge/schema/qualia-schema.md for the page format. The agent's own working memory lives in canonical/, MEMORY.md, and memory/ — do not write any of those into knowledge/wiki/.",
  );
  lines.push(
    '- canonical/*.md → durable structured memory (operator-curated; safe to read, ask before writing).',
  );
  lines.push(
    '- skills via skill_list / skill_view (catalog above shows summaries only).',
  );
  lines.push(
    "Recall rule: before claiming you don't know or remember something, use memory_search against MEMORY.md + canonical/ + memory/.",
  );
  if (!params.isMain) {
    lines.push(
      'Non-main runs: group/global MEMORY.md is injected at session start only. Use memory_search for broader recall.',
    );
  }
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

  if (!params.isEvaluatorRun) {
    // Full JSON schemas live in skills/runtime/fft-host-ipc — keep the stable
    // prompt as a short pointer so every turn does not pay the IPC tax.
    lines.push('## Host IPC');
    lines.push(
      `${params.paths.ipcDir} is the host bridge (messages/, tasks/, actions/, action_results/, deliver_files/).`,
    );
    lines.push(
      'Write JSON requests atomically (temp file then rename). Wait for action_results/<requestId>.json status=success before reporting completion.',
    );
    lines.push(
      'Payload schemas and examples: skill `fft-host-ipc` (skill_view fft-host-ipc). Covers message, run_progress, scheduler control, memory_action, skill_action, subagent_action, and deliver_file.',
    );
    lines.push('');
  }
  lines.push('## Completion Gate');
  lines.push(
    'Before declaring completion, verify side effects succeeded (files exist, IPC writes were processed, and delivery/action requests produced result files).',
  );
  lines.push(
    `For deliver_file requests, confirm ${params.paths.ipcDir}/action_results/<requestId>.json exists and has status=success before reporting delivered.`,
  );
  lines.push(
    'A new inbound message does not automatically cancel unresolved work; only treat prior work as dropped when the user explicitly cancels or completion is confirmed.',
  );
  lines.push(
    'Memory hygiene check: if this turn wrote to MEMORY.md or canonical/*.md, confirm the content is durable operator knowledge (user explicitly asked to remember it, or it is a long-lived decision) — NOT web search results, news, or transient research. If in doubt, move it to memory/YYYY-MM-DD.md instead.',
  );
  lines.push('');
  lines.push('## Reasoning And Delivery Safety');
  lines.push(
    'If think_level is low, stay concise in output but still perform the same completion checks before claiming limitations or success.',
  );
  lines.push(
    'If output may stream in partial chunks, do not treat truncated visible output as task completion; finish the underlying work first.',
  );
  lines.push('');
  lines.push('## Output Style');
  lines.push(
    'For user-facing replies, prefer short paragraphs and plain bullets.',
  );
  lines.push(
    'Avoid markdown headings in final chat replies unless explicitly requested.',
  );
  lines.push(
    'For tabular or comparison data, use GitHub-style markdown tables (| col | col | with a |---|---| separator row); the chat renders them as native tables.',
  );
  lines.push('');

  lines.push('## Heartbeats');
  lines.push(
    'If this run is a heartbeat poll and nothing needs attention, reply exactly HEARTBEAT_OK. If something needs attention, send alert text without HEARTBEAT_OK.',
  );
  return lines.join('\n').trim();
}

function renderEphemeralPrompt(params: {
  input: SystemPromptInput;
  assistantName: string;
  promptMode: PromptMode;
  paths: WorkspacePaths;
  providedMemoryContext: string;
  now: Date;
  timezone: string;
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
        machine_now_iso: params.now.toISOString(),
        machine_timezone: params.timezone,
        machine_local_date: formatLocalDate(params.now, params.timezone),
        machine_local_time: formatLocalTime(params.now, params.timezone),
        machine_weekday: formatWeekday(params.now, params.timezone),
      },
      null,
      2,
    ),
  );
  lines.push('```');
  lines.push('');
  lines.push(
    'Use the machine time fields above as the authoritative current date/time for this run.',
  );
  lines.push('');

  const extraSystemPrompt = trimAndNormalize(
    params.input.extraSystemPrompt || '',
  );
  if (extraSystemPrompt) {
    lines.push('## Host Context Overlay');
    lines.push(extraSystemPrompt);
    lines.push('');
  }

  // Runtime Hints carries only prompt_mode; every other run field
  // (coding_hint, continue_session, provider/model/think/reasoning overrides,
  // request_id) is already in the Inbound Context JSON above. Duplicating them
  // as bullets added weight without adding information.
  lines.push('## Runtime Hints');
  lines.push(`- prompt_mode: ${params.promptMode}`);
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
        `For long tasks, proactively send concise run_progress updates via ${params.paths.ipcDir}/messages (schema: skill fft-host-ipc).`,
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

function isStableContextEntry(entry: ContextEntry): boolean {
  return entry.path.endsWith('/SOUL.md');
}

function isPerTurnContextEntry(entry: ContextEntry): boolean {
  return (
    entry.path.endsWith('/TODOS.md') || entry.path.endsWith('/HEARTBEAT.md')
  );
}

function pickMtimeMap(
  source: Record<string, number | null>,
  paths: Iterable<string>,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const p of paths) {
    out[p] = Object.prototype.hasOwnProperty.call(source, p) ? source[p] : null;
  }
  return out;
}

function renderContextOverlay(params: {
  contextEntries: ContextEntry[];
  fileMaxChars: number;
}): string {
  const lines: string[] = [];

  if (params.contextEntries.length > 0) {
    lines.push('## Workspace Files (injected)');
    lines.push(
      'These files are loaded for this run (subject to prompt budget limits).',
    );
    lines.push('');
    lines.push('# Project Context');
    lines.push('');
    for (const entry of params.contextEntries) {
      const fitted = fitContentToBudget(
        entry.content,
        entry.label || entry.path,
        params.fileMaxChars,
        params.fileMaxChars,
      );
      const injected = fitted?.injected || '';
      lines.push(`## ${entry.path}`);
      lines.push(injected);
      lines.push('');
    }
  }

  return lines.join('\n').trim();
}

function renderEphemeralOverlay(params: {
  contextEntries: ContextEntry[];
  fileMaxChars: number;
}): string {
  const lines: string[] = [];

  const contextOverlay = renderContextOverlay({
    contextEntries: params.contextEntries,
    fileMaxChars: params.fileMaxChars,
  });
  if (contextOverlay) lines.push(contextOverlay);

  return lines.join('\n').trim();
}

function renderSessionBootstrapOverlay(params: {
  contextEntries: ContextEntry[];
  skillCatalogText: string;
  fileMaxChars: number;
}): string {
  const lines: string[] = [];

  if (params.contextEntries.length === 0 && !params.skillCatalogText) {
    return '';
  }

  lines.push('## Session Bootstrap Context');
  lines.push(
    'Loaded when a pi session starts or is rebased. Continued turns rely on session history and do not resend this layer.',
  );
  lines.push('');

  if (params.skillCatalogText) {
    lines.push(params.skillCatalogText);
    lines.push('');
  }

  const contextOverlay = renderContextOverlay({
    contextEntries: params.contextEntries,
    fileMaxChars: params.fileMaxChars,
  });
  if (contextOverlay) lines.push(contextOverlay);

  return lines.join('\n').trim();
}

export function buildSystemPrompt(
  input: SystemPromptInput,
  paths: WorkspacePaths,
  options: BuildSystemPromptOptions = {},
): {
  stableText: string;
  sessionBootstrapText: string;
  ephemeralText: string;
  /**
   * Convenience concatenation of the layers that are sent for this build,
   * joined with double newlines (matching how pi's `--append-system-prompt`
   * joins multiple values). Session bootstrap is included only when
   * `input.noContinue` starts/rebases the session.
   */
  text: string;
  report: SystemPromptReport;
} {
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
  // LISO.5: Maintenance mode is set directly; otherwise derive from scheduled task flag
  const promptMode: PromptMode =
    input.promptMode === 'maintenance'
      ? 'maintenance'
      : input.isScheduledTask
        ? 'minimal'
        : 'full';
  const assistantName =
    (input.assistantName || 'FarmFriend').trim() || 'FarmFriend';
  // LISO.5: maintenance runs use minimal bounded context — never retrieved memory,
  // even if a caller populated memoryContext.
  const providedMemoryContext =
    promptMode === 'maintenance'
      ? ''
      : trimAndNormalize(input.memoryContext || '');
  const now = options.now?.() ?? new Date();
  const rawTimezone =
    options.timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC';
  const timezone = resolveEffectiveTimezone(rawTimezone);
  const isHeartbeatRun =
    input.isHeartbeatTask === true ||
    (input.requestId || '').startsWith('heartbeat-');
  const includeHeartbeatContext =
    input.isScheduledTask === true || isHeartbeatRun;

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

  // Collect mtimes for every stable-source path so a later cache key/hash can
  // detect any contributing file change without re-hashing file content.
  const mtimeTracker: Record<string, number | null> = {};
  const trackingReadFileIfExists = (filePath: string): string | null => {
    const value = readFileIfExists(filePath);
    if (!Object.prototype.hasOwnProperty.call(mtimeTracker, filePath)) {
      try {
        mtimeTracker[filePath] = fs.statSync(filePath).mtimeMs;
      } catch {
        mtimeTracker[filePath] = null;
      }
    }
    return value;
  };

  // LISO.5: Maintenance mode skips normal context building to exclude
  // SOUL.md, NANO.md, USER.md, MEMORY.md, daily memory, retrieved memory,
  // recent conversation, and broad skill catalogs.
  const contextState =
    promptMode === 'maintenance'
      ? { entries: [], remainingTotalChars: 0 }
      : input.isMain
        ? buildMainContextEntries({
            readFileIfExists: trackingReadFileIfExists,
            includeHeartbeat: includeHeartbeatContext,
            fileMaxChars,
            totalMaxChars,
            groupDir: paths.groupDir,
            now,
            timezone,
          })
        : buildNonMainContextEntries({
            readFileIfExists: trackingReadFileIfExists,
            includeHeartbeat: includeHeartbeatContext,
            fileMaxChars,
            totalMaxChars,
            groupDir: paths.groupDir,
            globalDir: paths.globalDir,
          });

  const skillCatalog =
    !input.isScheduledTask && !isHeartbeatRun && promptMode !== 'maintenance'
      ? renderSkillCatalog(input.skillCatalog || [], skillCatalogMaxChars)
      : { text: '', injectedChars: 0, count: 0, truncated: false };

  // Also stat any stable-source files that exist on disk but were not
  // read because of a budget or include-missing gate — their mtime still
  // belongs in the cache key.
  const stableSourcePaths: string[] = [];
  if (input.isMain) {
    stableSourcePaths.push(
      ...MAIN_CONTEXT_FILES.map((n) => `${paths.groupDir}/${n}`),
    );
    stableSourcePaths.push(
      ...MAIN_SESSION_BOOTSTRAP_FILES.map((n) => `${paths.groupDir}/${n}`),
    );
    stableSourcePaths.push(`${paths.groupDir}/BOOTSTRAP.md`);
    stableSourcePaths.push(
      ...DEFAULT_CANONICAL_FILE_NAMES.map(
        (n) => `${paths.groupDir}/canonical/${n}`,
      ),
    );
    for (const rel of buildDailyMemoryFileNames(now, timezone)) {
      stableSourcePaths.push(`${paths.groupDir}/${rel}`);
    }
    if (includeHeartbeatContext)
      stableSourcePaths.push(`${paths.groupDir}/HEARTBEAT.md`);
  } else {
    stableSourcePaths.push(
      `${paths.globalDir}/NANO.md`,
      `${paths.groupDir}/NANO.md`,
      `${paths.globalDir}/SOUL.md`,
      `${paths.groupDir}/SOUL.md`,
      `${paths.globalDir}/TODOS.md`,
      `${paths.groupDir}/TODOS.md`,
      `${paths.globalDir}/MEMORY.md`,
      `${paths.globalDir}/memory.md`,
      `${paths.groupDir}/MEMORY.md`,
      `${paths.groupDir}/memory.md`,
    );
    if (includeHeartbeatContext)
      stableSourcePaths.push(`${paths.groupDir}/HEARTBEAT.md`);
  }
  for (const p of stableSourcePaths) {
    if (!Object.prototype.hasOwnProperty.call(mtimeTracker, p)) {
      try {
        mtimeTracker[p] = fs.statSync(p).mtimeMs;
      } catch {
        mtimeTracker[p] = null;
      }
    }
  }

  const stableContextEntries =
    contextState.entries.filter(isStableContextEntry);
  const sessionBootstrapContextEntries = contextState.entries.filter(
    (entry) => !isStableContextEntry(entry) && !isPerTurnContextEntry(entry),
  );
  const ephemeralContextEntries = contextState.entries.filter(
    isPerTurnContextEntry,
  );
  const stableMtimeMap = pickMtimeMap(
    mtimeTracker,
    stableContextEntries.map((entry) => entry.path),
  );

  const stableCacheKey = buildStableCacheKey({
    assistantName,
    promptMode,
    isMain: input.isMain,
    codingHint: input.codingHint,
    canDelegateToCoder,
    autoDelegationEnabled,
    isEvaluatorRun: input.isEvaluatorRun === true,
    mtimeMap: stableMtimeMap,
  });

  const cached = options.cachedStableLayer;
  const cacheHit =
    !!cached &&
    cached.key === stableCacheKey &&
    mtimeMapDeepEqual(cached.mtimeMap, stableMtimeMap) &&
    typeof cached.content === 'string' &&
    cached.content.length > 0;

  let stableText: string;
  if (cacheHit) {
    stableText = cached!.content;
  } else {
    const baseText = renderBasePrompt({
      assistantName,
      paths,
      forcedDelegateMode,
      canDelegateToCoder,
      autoDelegationEnabled,
      isEvaluatorRun: input.isEvaluatorRun === true,
      isMain: input.isMain,
    });
    const stableOverlay = renderContextOverlay({
      contextEntries: stableContextEntries,
      fileMaxChars,
    });
    stableText = [baseText, stableOverlay]
      .filter((s) => s && s.length > 0)
      .join('\n\n')
      .trim();
  }

  const ephemeralBaseText = renderEphemeralPrompt({
    input,
    assistantName,
    promptMode,
    paths,
    providedMemoryContext,
    now,
    timezone,
  });
  const sessionBootstrapText = renderSessionBootstrapOverlay({
    contextEntries: sessionBootstrapContextEntries,
    skillCatalogText: skillCatalog.text,
    fileMaxChars,
  });
  const ephemeralOverlay = renderEphemeralOverlay({
    contextEntries: ephemeralContextEntries,
    fileMaxChars,
  });
  const ephemeralText = [ephemeralBaseText, ephemeralOverlay]
    .filter((s) => s && s.length > 0)
    .join('\n\n')
    .trim();

  const injectedTotalChars = contextState.entries.reduce(
    (sum, entry) => sum + entry.injectedChars,
    0,
  );
  const basePromptHash = hashString(stableText);
  const includeSessionBootstrap = input.noContinue === true;
  const totalChars =
    stableText.length +
    (includeSessionBootstrap ? sessionBootstrapText.length : 0) +
    ephemeralText.length;

  return {
    stableText,
    sessionBootstrapText,
    ephemeralText,
    text: [
      stableText,
      includeSessionBootstrap ? sessionBootstrapText : '',
      ephemeralText,
    ]
      .filter((s) => s && s.length > 0)
      .join('\n\n')
      .trim(),
    report: {
      mode: promptMode,
      totalChars,
      contextEntries: contextState.entries,
      contextBudget: {
        fileMaxChars,
        totalMaxChars,
        injectedTotalChars,
        remainingChars: contextState.remainingTotalChars,
      },
      layers: [
        {
          id: 'stable',
          title: 'Stable Prompt (cacheable prefix)',
          content: stableText,
          chars: stableText.length,
          mtimeMap: stableMtimeMap,
          hash: basePromptHash,
          key: stableCacheKey,
        },
        {
          id: 'session_bootstrap',
          title: 'Session Bootstrap Context (fresh sessions only)',
          content: sessionBootstrapText,
          chars: sessionBootstrapText.length,
          included: includeSessionBootstrap,
        },
        {
          id: 'ephemeral',
          title: 'Ephemeral Overlay (per-turn suffix)',
          content: ephemeralText,
          chars: ephemeralText.length,
        },
      ],
      baseCacheKey: stableCacheKey,
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
