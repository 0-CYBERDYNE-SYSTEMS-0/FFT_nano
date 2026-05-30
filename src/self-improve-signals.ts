import fs from 'fs';
import path from 'path';

import { resolveGroupFolderPath } from './group-folder.js';
import { logger } from './logger.js';
import type { PiToolExecution } from './pi-json-parser.js';

// ---------------------------------------------------------------------------
// Learning-signal extraction
//
// Deterministic, lexical detection of high-value learning signals in a finished
// turn. No LLM call — this runs inline in microseconds so it can gate the
// (expensive) quiet reviewer without adding latency to the user-facing path.
// ---------------------------------------------------------------------------

export type SelfImprovePriority = 'none' | 'light' | 'full';

export interface LearningSignalResult {
  signals: string[];
  priority: SelfImprovePriority;
}

export interface ExtractLearningSignalsInput {
  userTask: string;
  agentOutput: string;
  toolExecutions?: PiToolExecution[];
}

// Multi-step procedure heuristic: a run that used at least this many tools is a
// candidate operational procedure worth a light review.
const MULTI_STEP_TOOL_THRESHOLD = 6;

// Explicit durable-memory requests. Word-boundary anchored to avoid matching
// "remembered" inside ordinary prose.
const REMEMBER_PATTERNS: RegExp[] = [
  /\bremember\b/i,
  /\bnext time\b/i,
  /\bfrom now on\b/i,
  /\bgoing forward\b/i,
  /\bin (the )?future\b/i,
  /\balways\b/i,
];

// User-correction markers. Anchored to correction phrasing so common words like
// "actually"/"don't" inside neutral requests are less likely to over-fire.
const CORRECTION_PATTERNS: RegExp[] = [
  /\bthat'?s (wrong|incorrect|not right)\b/i,
  /\bthat is (wrong|incorrect|not right)\b/i,
  /\b(no|nope),/i,
  /\bnot what i\b/i,
  /\bdon'?t do that\b/i,
  /\byou (should|shouldn'?t|need to|must)\b/i,
  /\bstop (doing|using)\b/i,
  /\bincorrect\b/i,
  /\bwrong\b/i,
  /\bactually,?\s/i,
];

function anyMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

// Detect a command/tool path that failed and then later succeeded in the same
// run — a reusable recovery worth capturing.
function detectFailThenFix(toolExecutions: PiToolExecution[]): boolean {
  const failedTools = new Set<string>();
  for (const exec of toolExecutions) {
    if (exec.status === 'error') {
      failedTools.add(exec.toolName);
    } else if (exec.status === 'ok' && failedTools.has(exec.toolName)) {
      return true;
    }
  }
  return false;
}

export function extractLearningSignals(
  input: ExtractLearningSignalsInput,
): LearningSignalResult {
  const signals: string[] = [];
  const userTask = input.userTask || '';
  const toolExecutions = input.toolExecutions || [];

  if (anyMatch(userTask, REMEMBER_PATTERNS)) {
    signals.push('remember');
  }
  if (anyMatch(userTask, CORRECTION_PATTERNS)) {
    signals.push('correction');
  }
  if (detectFailThenFix(toolExecutions)) {
    signals.push('fail-then-fix');
  }
  if (toolExecutions.length >= MULTI_STEP_TOOL_THRESHOLD) {
    signals.push('multi-step-procedure');
  }

  // High-value signals (explicit memory request, user correction, reusable
  // recovery) warrant a full review. A long procedure alone is only light.
  const hasFullSignal = signals.some(
    (s) => s === 'remember' || s === 'correction' || s === 'fail-then-fix',
  );
  const priority: SelfImprovePriority = hasFullSignal
    ? 'full'
    : signals.length > 0
      ? 'light'
      : 'none';

  return { signals, priority };
}

// ---------------------------------------------------------------------------
// Structured event log
//
// One JSONL line per self-improvement pass, written to the group's log dir so
// no-ops are explainable without a DB migration. Mirrors the existing
// report-file pattern (skill-manager reports also live in the group log dir).
// ---------------------------------------------------------------------------

export interface SelfImproveEvent {
  run_id: string;
  group_id: string;
  review_type: 'skill-self-improve' | 'skill-manager';
  trigger_reason: string;
  signals_detected: string[];
  review_fired: boolean;
  noop_reason?: string;
  duration_ms?: number;
  success: boolean;
}

function selfImproveEventLogPath(groupFolder: string): string {
  return path.join(
    resolveGroupFolderPath(groupFolder),
    'logs',
    'self-improve-events.jsonl',
  );
}

export function recordSelfImproveEvent(
  groupFolder: string,
  event: Omit<SelfImproveEvent, 'group_id'>,
): void {
  try {
    const filePath = selfImproveEventLogPath(groupFolder);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      group_id: groupFolder,
      ...event,
    });
    fs.appendFileSync(filePath, `${line}\n`);
  } catch (err) {
    logger.warn(
      { err, groupFolder, runId: event.run_id },
      'Failed to record self-improve event',
    );
  }
}
