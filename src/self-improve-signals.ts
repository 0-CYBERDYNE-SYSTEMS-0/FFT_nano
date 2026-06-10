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

export type SenderRole = 'operator' | 'member' | 'unknown';

export interface ExtractLearningSignalsInput {
  userTask: string;
  agentOutput: string;
  toolExecutions?: PiToolExecution[];
  senderRole?: SenderRole | null | '';
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

  // Normalize senderRole: treat null/undefined/'' as 'unknown'
  const rawRole = input.senderRole;
  // Defensive: coerce any non-valid SenderRole value to 'unknown'
  const senderRole: SenderRole =
    rawRole === 'operator' || rawRole === 'member' || rawRole === 'unknown'
      ? rawRole
      : 'unknown';

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

  // WS3.1/WS3.2: remember/correction signals from non-operator senders are
  // downgraded to 'light'. fail-then-fix and multi-step-procedure are
  // unaffected (they derive from host-observed tool trace, not text).
  const isOperator = senderRole === 'operator';

  const hasFailThenFix = signals.includes('fail-then-fix');
  const hasRememberOrCorrection = signals.some(
    (s) => s === 'remember' || s === 'correction',
  );
  const hasMultiStep = signals.includes('multi-step-procedure');

  // fail-then-fix always escalates to full (host-observed, trustworthy)
  if (hasFailThenFix) {
    return { signals, priority: 'full' };
  }

  // remember/correction: full only for operator, light for member/unknown
  if (hasRememberOrCorrection) {
    return {
      signals,
      priority: isOperator ? 'full' : 'light',
    };
  }

  // multi-step-procedure is always light
  if (hasMultiStep) {
    return { signals, priority: 'light' };
  }

  return { signals, priority: 'none' };
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
  // INV.1: authorityId stamped on every line so the authority can be traced
  // back to a specific run for forensic review (VAL-XARE-009).
  authorityId: string;
  // WS3.5: sender_role on every event for observability of downgrades
  sender_role: SenderRole;
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
