import fs from 'fs';
import path from 'path';

import type { RegisteredGroup, RunType } from './types.js';
import type { ContainerInput, ContainerOutput } from './pi-runner.js';
import { runContainerAgent } from './pi-runner.js';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvaluatorContext {
  runType: RunType;
  originalTask: string;
  agentOutput: string;
  durationMs: number;
  toolsInvoked: number;
  changedFiles?: string[];
  group: RegisteredGroup;
  chatJid: string;
  isMain?: boolean;
  workspaceDir?: string;
  workspaceDirOverride?: string;
  startedAtMs?: number;
  forceEvaluate?: boolean;
  abortSignal?: AbortSignal;
}

export interface EvaluatorVerdict {
  pass: boolean;
  score: number;
  issues: string[];
  feedback: string;
  skipped: boolean;
  skippedReason?: string;
}

export interface ArtifactVerification {
  workspaceDir?: string;
  claimedPaths: string[];
  existingPaths: string[];
  missingPaths: string[];
  recentArtifacts: string[];
}

// ---------------------------------------------------------------------------
// Threshold guard
// ---------------------------------------------------------------------------

const MIN_DURATION_MS = 15_000;
const EVAL_DURATION_MS = 45_000;
const EVAL_TOOL_COUNT = 3;
const EVAL_OUTPUT_CHARS = 1500;

export function shouldEvaluate(ctx: EvaluatorContext): {
  evaluate: boolean;
  reason: string;
} {
  // Never evaluate empty output regardless of run type
  if (!ctx.agentOutput || ctx.agentOutput.trim().length === 0) {
    return { evaluate: false, reason: 'empty output' };
  }

  // Only coding and subagent runs are eligible for evaluation
  // chat, cron, scheduled, and heartbeat always skip
  if (ctx.runType !== 'coding' && ctx.runType !== 'subagent') {
    return {
      evaluate: false,
      reason: `${ctx.runType} run type not eligible for evaluation`,
    };
  }

  if (ctx.runType === 'coding' && (ctx.changedFiles?.length ?? 0) > 0) {
    return { evaluate: true, reason: 'coding run with changed files' };
  }

  if (ctx.forceEvaluate) {
    return { evaluate: true, reason: 'forced evaluation' };
  }

  // Fast path: trivially short runs with no tools skip evaluation
  if (
    ctx.durationMs < MIN_DURATION_MS &&
    ctx.toolsInvoked < 2 &&
    ctx.agentOutput.length < 500
  ) {
    return { evaluate: false, reason: 'trivially short run' };
  }

  if (ctx.durationMs >= EVAL_DURATION_MS) {
    return {
      evaluate: true,
      reason: `duration ${ctx.durationMs}ms >= ${EVAL_DURATION_MS}ms`,
    };
  }

  if (ctx.toolsInvoked >= EVAL_TOOL_COUNT) {
    return {
      evaluate: true,
      reason: `${ctx.toolsInvoked} tools >= threshold ${EVAL_TOOL_COUNT}`,
    };
  }

  if (ctx.agentOutput.length >= EVAL_OUTPUT_CHARS) {
    return {
      evaluate: true,
      reason: `output ${ctx.agentOutput.length} chars >= ${EVAL_OUTPUT_CHARS}`,
    };
  }

  return { evaluate: false, reason: 'below all thresholds' };
}

// ---------------------------------------------------------------------------
// Rubric prompt builder (run-type-specific)
// ---------------------------------------------------------------------------

function buildEvaluatorPrompt(ctx: EvaluatorContext): string {
  const rubric = getRubric(ctx.runType, ctx.changedFiles);
  const artifactVerification = buildArtifactVerification(ctx);

  return [
    '## Role',
    'You are an independent quality reviewer for an AI agent system. You did NOT perform the task below.',
    "Your only job is to evaluate whether the agent's output fully accomplishes the original task.",
    '',
    '## Original Task',
    '```',
    ctx.originalTask.slice(0, 4000),
    '```',
    '',
    "## Agent's Output",
    '```',
    ctx.agentOutput.slice(0, 6000),
    '```',
    '',
    ctx.changedFiles && ctx.changedFiles.length > 0
      ? `## Changed Files\n${ctx.changedFiles.map((f) => `- ${f}`).join('\n')}\n`
      : '',
    artifactVerification
      ? [
          '## Host Artifact Verification',
          'The following JSON was produced by the host filesystem, not by the agent. Treat it as authoritative.',
          '```json',
          JSON.stringify(artifactVerification, null, 2),
          '```',
        ].join('\n')
      : '',
    '## Evaluation Rubric',
    rubric,
    '',
    '## Output Format',
    'You MUST respond with ONLY a valid JSON object on a single line, no markdown fences, no commentary:',
    '{"pass":true,"score":8,"issues":[],"feedback":"Fully accomplished."}',
    '',
    '- pass: true if the task was fully accomplished, false if anything critical was missed',
    '- score: 0-10 (10 = perfect, 0 = completely failed)',
    '- issues: array of specific problems found (empty array if none)',
    '- feedback: one sentence summary of verdict and key finding',
    '',
    'Respond with JSON only.',
  ]
    .filter((line) => line !== undefined && line !== null)
    .join('\n');
}

function getRubric(runType: RunType, changedFiles?: string[]): string {
  switch (runType) {
    case 'coding':
      return [
        '1. Does the diff/changed files address ALL requirements in the original task?',
        '2. Are there obvious logic errors, missing cases, or broken functionality?',
        '3. Were tests run (if applicable)? Did they pass?',
        '4. Is the implementation complete or are there TODO stubs left behind?',
        '5. Does the solution introduce any security or data integrity issues?',
        changedFiles && changedFiles.length === 0
          ? '6. NOTE: No files were changed — was this intentional or did the agent fail to act?'
          : '',
      ]
        .filter(Boolean)
        .join('\n');

    case 'scheduled':
    case 'cron':
      return [
        '1. Did the agent EXECUTE the requested action (not just describe or plan it)?',
        '2. Were all items, records, or targets in the task processed?',
        '3. Were there any errors, timeouts, or partial completions?',
        '4. If the task involved sending/storing/updating something, is there evidence it happened?',
        '5. Is the result suitable to be logged as a completed run?',
      ].join('\n');

    case 'heartbeat':
      return [
        '1. Did the agent complete the tasks specified in its instructions?',
        '2. Were all monitoring checks, farm status checks, or operational tasks performed?',
        '3. Did the agent take any required actions, or only produce narrative?',
        '4. Are there any urgent issues the agent should have flagged but did not?',
        '5. Is the output substantive (not just a placeholder "I checked everything is fine")?',
      ].join('\n');

    case 'subagent':
      return [
        '1. Did the subtask output fully satisfy the scope it was assigned?',
        '2. Is the output usable by a parent agent without additional clarification?',
        '3. Were all sub-steps completed?',
        '4. Are there any errors or missing pieces that would block the parent task?',
      ].join('\n');

    case 'chat':
    default:
      return [
        '1. Did the response fully answer ALL parts of the question or request?',
        '2. Was anything missed, wrong, or only partially addressed?',
        '3. If the task involved multiple steps, were all steps completed?',
        '4. Are all factual claims plausible and internally consistent?',
        "5. Is the response actionable and complete for the user's needs?",
      ].join('\n');
  }
}

const ACTIONFUL_VERBS = [
  'add',
  'append',
  'archive',
  'build',
  'capture',
  'change',
  'commit',
  'configure',
  'create',
  'curate',
  'delete',
  'deploy',
  'deliver',
  'download',
  'edit',
  'export',
  'fix',
  'generate',
  'implement',
  'ingest',
  'install',
  'make',
  'merge',
  'migrate',
  'move',
  'open',
  'patch',
  'perform',
  'publish',
  'push',
  'refactor',
  'release',
  'remove',
  'rename',
  'render',
  'repair',
  'research',
  'restart',
  'run',
  'save',
  'scan',
  'send',
  'setup',
  'test',
  'update',
  'upload',
  'validate',
  'verify',
  'write',
] as const;

const ACTIONFUL_NOUNS = [
  'app',
  'branch',
  'build',
  'code',
  'config',
  'csv',
  'database',
  'db',
  'deck',
  'deliverable',
  'doc',
  'document',
  'file',
  'fix',
  'html',
  'image',
  'job',
  'knowledge',
  'log',
  'memory',
  'note',
  'page',
  'patch',
  'pdf',
  'pr',
  'raw',
  'report',
  'scheduler',
  'script',
  'site',
  'slide',
  'spreadsheet',
  'task',
  'test',
  'todo',
  'wiki',
] as const;

const ACTIONFUL_PHRASE_PATTERN =
  /\b(do it|handle it|take care of it|ship it|make (?:the )?fix(?:es)?|apply (?:the )?(?:fix|patch|changes)|open (?:a )?(?:pr|pull request)|run (?:the )?(?:tests?|checks?)|test (?:it|this|the changes?))\b/i;

const EXPLAIN_ONLY_PATTERN =
  /\b(explain only|tell me only|just explain|explain without (?:changing|editing|writing|running|doing)|do not (?:change|edit|write|run|save|create|update)|don't (?:change|edit|write|run|save|create|update))\b/i;

function getLatestInboundTaskText(taskText: string): string {
  const marker = '[NEW INBOUND MESSAGES]';
  return taskText.includes(marker)
    ? taskText.slice(taskText.lastIndexOf(marker) + marker.length)
    : taskText;
}

export function isActionfulChatTask(taskText: string): boolean {
  const scopedText = getLatestInboundTaskText(taskText);
  if (EXPLAIN_ONLY_PATTERN.test(scopedText)) return false;
  if (ACTIONFUL_PHRASE_PATTERN.test(scopedText)) return true;

  const matches: Array<{ term: string; index: number; role: 'verb' | 'noun' }> =
    [];
  for (const term of ACTIONFUL_VERBS) {
    const match = new RegExp(`\\b${term}s?\\b`, 'i').exec(scopedText);
    if (match) matches.push({ term, index: match.index, role: 'verb' });
  }
  for (const term of ACTIONFUL_NOUNS) {
    const match = new RegExp(`\\b${term}s?\\b`, 'i').exec(scopedText);
    if (match) matches.push({ term, index: match.index, role: 'noun' });
  }

  const verbMatches = matches.filter((match) => match.role === 'verb');
  const nounMatches = matches.filter((match) => match.role === 'noun');

  return verbMatches.some((verb) =>
    nounMatches.some(
      (noun) =>
        !(verb.term === noun.term && verb.index === noun.index) &&
        Math.abs(verb.index - noun.index) <= 160,
    ),
  );
}

const UNSAFE_AUTO_REFINEMENT_PATTERN =
  /\b(?:archive|commit|configure|delete|deploy|download|export|install|merge|move|open\s+(?:a\s+)?(?:pr|pull request)|publish|push|release|remove|rename|restart|scan|send|setup|upload)\b/i;

const SAFE_LOCAL_REFINEMENT_PATTERN =
  /\b(?:add|append|build|capture|change|create|curate|edit|fix|generate|implement|ingest|make|patch|refactor|render|repair|research|run\s+(?:the\s+)?(?:tests?|checks?)|save|test|update|validate|verify|write)\b/i;

export function canAutoRefineActionfulChatTask(taskText: string): boolean {
  const scopedText = getLatestInboundTaskText(taskText);
  if (EXPLAIN_ONLY_PATTERN.test(scopedText)) return false;
  if (UNSAFE_AUTO_REFINEMENT_PATTERN.test(scopedText)) return false;
  return SAFE_LOCAL_REFINEMENT_PATTERN.test(scopedText);
}

function sanitizeClaimedPath(raw: string): string | null {
  const trimmed = raw
    .trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/[),.;:]+$/g, '');
  if (!trimmed || path.isAbsolute(trimmed)) return null;
  if (trimmed.includes('\0')) return null;
  const normalized = path.posix.normalize(trimmed.replace(/\\/g, '/'));
  if (
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    return null;
  }
  return normalized;
}

export function extractClaimedArtifactPaths(text: string): string[] {
  const paths = new Set<string>();
  const pathPattern =
    /\b(knowledge\/(?:raw|wiki|schema|reports)\/[^\s)"'`,;:]+|knowledge\/(?:raw|wiki|schema|reports)\/|memory\/\d{4}-\d{2}-\d{2}\.md|MEMORY\.md|TODOS\.md)\b/g;

  for (const match of text.matchAll(pathPattern)) {
    const value = sanitizeClaimedPath(match[1] || '');
    if (value) paths.add(value);
  }

  if (/\btoday'?s memory log\b|\bdaily memory log\b/i.test(text)) {
    const today = new Date().toISOString().slice(0, 10);
    paths.add(`memory/${today}.md`);
  }

  return [...paths].sort();
}

function isPathWithinBase(baseDir: string, targetPath: string): boolean {
  const relative = path.relative(baseDir, targetPath);
  return (
    Boolean(relative) &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)
  );
}

function resolveArtifactPath(
  workspaceDir: string,
  relativePath: string,
): string | null {
  const resolved = path.resolve(workspaceDir, relativePath);
  return isPathWithinBase(workspaceDir, resolved) ? resolved : null;
}

function listRecentArtifacts(
  workspaceDir: string,
  startedAtMs?: number,
): string[] {
  if (!startedAtMs || !Number.isFinite(startedAtMs)) return [];
  const roots = ['knowledge/raw', 'knowledge/wiki', 'memory'];
  const threshold = startedAtMs - 5_000;
  const recent: string[] = [];

  for (const root of roots) {
    const absoluteRoot = resolveArtifactPath(workspaceDir, root);
    if (!absoluteRoot || !fs.existsSync(absoluteRoot)) continue;
    const stack = [absoluteRoot];
    while (stack.length > 0 && recent.length < 50) {
      const current = stack.pop();
      if (!current) continue;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const absolutePath = path.join(current, entry.name);
        if (!isPathWithinBase(workspaceDir, absolutePath)) continue;
        if (entry.isDirectory()) {
          stack.push(absolutePath);
          continue;
        }
        if (!entry.isFile()) continue;
        let stat: fs.Stats;
        try {
          stat = fs.statSync(absolutePath);
        } catch {
          continue;
        }
        if (stat.mtimeMs >= threshold) {
          recent.push(
            path.relative(workspaceDir, absolutePath).replace(/\\/g, '/'),
          );
        }
      }
    }
  }

  return recent.sort().slice(0, 50);
}

export function buildArtifactVerification(
  ctx: Pick<EvaluatorContext, 'agentOutput' | 'workspaceDir' | 'startedAtMs'>,
): ArtifactVerification | null {
  const claimedPaths = extractClaimedArtifactPaths(ctx.agentOutput);
  const workspaceDir = ctx.workspaceDir;
  if (!workspaceDir) {
    return claimedPaths.length > 0
      ? {
          claimedPaths,
          existingPaths: [],
          missingPaths: [],
          recentArtifacts: [],
        }
      : null;
  }

  const existingPaths: string[] = [];
  const missingPaths: string[] = [];
  for (const claimedPath of claimedPaths) {
    const absolutePath = resolveArtifactPath(workspaceDir, claimedPath);
    if (absolutePath && fs.existsSync(absolutePath)) {
      existingPaths.push(claimedPath);
    } else {
      missingPaths.push(claimedPath);
    }
  }

  const recentArtifacts = listRecentArtifacts(workspaceDir, ctx.startedAtMs);
  if (
    claimedPaths.length === 0 &&
    recentArtifacts.length === 0 &&
    !ctx.startedAtMs
  ) {
    return null;
  }

  return {
    workspaceDir,
    claimedPaths,
    existingPaths,
    missingPaths,
    recentArtifacts,
  };
}

export function buildEvaluatorContainerInput(
  ctx: EvaluatorContext,
): ContainerInput {
  return {
    prompt: buildEvaluatorPrompt(ctx),
    groupFolder: ctx.group.folder,
    chatJid: ctx.chatJid,
    isMain: ctx.isMain === true,
    isEvaluatorRun: true,
    noContinue: true,
    toolMode: 'read_only',
    codingHint: 'none',
    workspaceDirOverride: ctx.workspaceDirOverride,
    suppressPreviewStreaming: true,
    lifecyclePolicyOverride: {
      hardTimeoutMs: 90_000,
      staleAfterMs: 60_000,
    },
  };
}

// ---------------------------------------------------------------------------
// Verdict parser
// ---------------------------------------------------------------------------

function parseVerdict(raw: string | null): EvaluatorVerdict | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Find the first { ... } block in the output
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const pass = typeof parsed.pass === 'boolean' ? parsed.pass : null;
    if (pass === null) return null;
    return {
      pass,
      score:
        typeof parsed.score === 'number'
          ? Math.max(0, Math.min(10, parsed.score))
          : pass
            ? 7
            : 3,
      issues: Array.isArray(parsed.issues)
        ? (parsed.issues as unknown[]).map(String).slice(0, 10)
        : [],
      feedback: typeof parsed.feedback === 'string' ? parsed.feedback : '',
      skipped: false,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core evaluator runner
// ---------------------------------------------------------------------------

export async function runEvaluatorPass(
  ctx: EvaluatorContext,
): Promise<EvaluatorVerdict> {
  const artifactVerification = buildArtifactVerification(ctx);
  if (artifactVerification?.missingPaths.length) {
    return {
      pass: false,
      score: 2,
      issues: artifactVerification.missingPaths.map(
        (p) => `Claimed artifact does not exist: ${p}`,
      ),
      feedback:
        'The agent claimed filesystem artifacts that are missing in the validated workspace.',
      skipped: false,
    };
  }

  const gate = shouldEvaluate(ctx);
  if (!gate.evaluate) {
    return {
      pass: true,
      score: -1,
      issues: [],
      feedback: '',
      skipped: true,
      skippedReason: gate.reason,
    };
  }

  logger.info(
    { runType: ctx.runType, chatJid: ctx.chatJid, reason: gate.reason },
    'Running evaluator pass',
  );

  let evalOutput: ContainerOutput;
  try {
    evalOutput = await runContainerAgent(
      ctx.group,
      buildEvaluatorContainerInput(ctx),
      ctx.abortSignal,
    );
  } catch (err) {
    logger.warn(
      { err, runType: ctx.runType },
      'Evaluator run threw — skipping',
    );
    return {
      pass: true,
      score: -1,
      issues: [],
      feedback: '',
      skipped: true,
      skippedReason: 'evaluator threw',
    };
  }

  if (evalOutput.status === 'error') {
    logger.warn(
      { error: evalOutput.error, runType: ctx.runType },
      'Evaluator run failed — skipping',
    );
    return {
      pass: true,
      score: -1,
      issues: [],
      feedback: '',
      skipped: true,
      skippedReason: 'evaluator error',
    };
  }

  const verdict = parseVerdict(evalOutput.result);
  if (!verdict) {
    logger.warn(
      { raw: evalOutput.result?.slice(0, 200), runType: ctx.runType },
      'Evaluator returned unparseable verdict',
    );
    return {
      pass: true,
      score: -1,
      issues: [],
      feedback: '',
      skipped: true,
      skippedReason: 'unparseable verdict',
    };
  }

  logger.info(
    {
      runType: ctx.runType,
      pass: verdict.pass,
      score: verdict.score,
      issues: verdict.issues.length,
    },
    'Evaluator verdict',
  );

  return verdict;
}

// ---------------------------------------------------------------------------
// Refinement prompt builder (for blocking re-runs)
// ---------------------------------------------------------------------------

export function buildRefinementPrompt(
  originalTask: string,
  verdict: EvaluatorVerdict,
): string {
  return [
    originalTask,
    '',
    '---',
    '[SYSTEM: Previous attempt was evaluated and did not fully succeed.]',
    `Score: ${verdict.score}/10`,
    verdict.issues.length > 0
      ? `Issues found:\n${verdict.issues.map((i) => `- ${i}`).join('\n')}`
      : '',
    `Evaluator feedback: ${verdict.feedback}`,
    '',
    'Please address the above issues and complete the task.',
  ]
    .filter((l) => l !== undefined)
    .join('\n');
}
