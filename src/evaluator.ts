import type { RegisteredGroup, RunType } from './types.js';
import type { ContainerOutput } from './pi-runner.js';
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

// ---------------------------------------------------------------------------
// Threshold guard
// ---------------------------------------------------------------------------

const MIN_DURATION_MS = 15_000;
const EVAL_DURATION_MS = 45_000;
const EVAL_TOOL_COUNT = 3;
const EVAL_OUTPUT_CHARS = 1500;

// Run types that are always evaluated regardless of duration/tool/output thresholds.
const ALWAYS_EVAL_TYPES = new Set<RunType>(['scheduled', 'cron', 'heartbeat']);

export function shouldEvaluate(ctx: EvaluatorContext): { evaluate: boolean; reason: string } {
  // Never evaluate empty output regardless of run type
  if (!ctx.agentOutput || ctx.agentOutput.trim().length === 0) {
    return { evaluate: false, reason: 'empty output' };
  }

  // Always-eval run types bypass all other thresholds
  if (ALWAYS_EVAL_TYPES.has(ctx.runType)) {
    return { evaluate: true, reason: `always-eval run type: ${ctx.runType}` };
  }

  if (ctx.runType === 'coding' && (ctx.changedFiles?.length ?? 0) > 0) {
    return { evaluate: true, reason: 'coding run with changed files' };
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
    return { evaluate: true, reason: `duration ${ctx.durationMs}ms >= ${EVAL_DURATION_MS}ms` };
  }

  if (ctx.toolsInvoked >= EVAL_TOOL_COUNT) {
    return { evaluate: true, reason: `${ctx.toolsInvoked} tools >= threshold ${EVAL_TOOL_COUNT}` };
  }

  if (ctx.agentOutput.length >= EVAL_OUTPUT_CHARS) {
    return { evaluate: true, reason: `output ${ctx.agentOutput.length} chars >= ${EVAL_OUTPUT_CHARS}` };
  }

  return { evaluate: false, reason: 'below all thresholds' };
}

// ---------------------------------------------------------------------------
// Rubric prompt builder (run-type-specific)
// ---------------------------------------------------------------------------

function buildEvaluatorPrompt(ctx: EvaluatorContext): string {
  const rubric = getRubric(ctx.runType, ctx.changedFiles);

  return [
    '## Role',
    'You are an independent quality reviewer for an AI agent system. You did NOT perform the task below.',
    'Your only job is to evaluate whether the agent\'s output fully accomplishes the original task.',
    '',
    '## Original Task',
    '```',
    ctx.originalTask.slice(0, 4000),
    '```',
    '',
    '## Agent\'s Output',
    '```',
    ctx.agentOutput.slice(0, 6000),
    '```',
    '',
    ctx.changedFiles && ctx.changedFiles.length > 0
      ? `## Changed Files\n${ctx.changedFiles.map((f) => `- ${f}`).join('\n')}\n`
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
        '5. Is the response actionable and complete for the user\'s needs?',
      ].join('\n');
  }
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
      score: typeof parsed.score === 'number' ? Math.max(0, Math.min(10, parsed.score)) : (pass ? 7 : 3),
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

export async function runEvaluatorPass(ctx: EvaluatorContext): Promise<EvaluatorVerdict> {
  const gate = shouldEvaluate(ctx);
  if (!gate.evaluate) {
    return { pass: true, score: -1, issues: [], feedback: '', skipped: true, skippedReason: gate.reason };
  }

  logger.info(
    { runType: ctx.runType, chatJid: ctx.chatJid, reason: gate.reason },
    'Running evaluator pass',
  );

  let evalOutput: ContainerOutput;
  try {
    evalOutput = await runContainerAgent(
      ctx.group,
      {
        prompt: buildEvaluatorPrompt(ctx),
        groupFolder: ctx.group.folder,
        chatJid: ctx.chatJid,
        isMain: false,
        isEvaluatorRun: true,
        noContinue: true,
        toolMode: 'read_only',
        codingHint: 'none',
        suppressPreviewStreaming: true,
        lifecyclePolicyOverride: {
          hardTimeoutMs: 90_000,
          staleAfterMs: 60_000,
        },
      },
      ctx.abortSignal,
    );
  } catch (err) {
    logger.warn({ err, runType: ctx.runType }, 'Evaluator run threw — skipping');
    return { pass: true, score: -1, issues: [], feedback: '', skipped: true, skippedReason: 'evaluator threw' };
  }

  if (evalOutput.status === 'error') {
    logger.warn({ error: evalOutput.error, runType: ctx.runType }, 'Evaluator run failed — skipping');
    return { pass: true, score: -1, issues: [], feedback: '', skipped: true, skippedReason: 'evaluator error' };
  }

  const verdict = parseVerdict(evalOutput.result);
  if (!verdict) {
    logger.warn({ raw: evalOutput.result?.slice(0, 200), runType: ctx.runType }, 'Evaluator returned unparseable verdict');
    return { pass: true, score: -1, issues: [], feedback: '', skipped: true, skippedReason: 'unparseable verdict' };
  }

  logger.info(
    { runType: ctx.runType, pass: verdict.pass, score: verdict.score, issues: verdict.issues.length },
    'Evaluator verdict',
  );

  return verdict;
}

// ---------------------------------------------------------------------------
// Refinement prompt builder (for blocking re-runs)
// ---------------------------------------------------------------------------

export function buildRefinementPrompt(originalTask: string, verdict: EvaluatorVerdict): string {
  return [
    originalTask,
    '',
    '---',
    '[SYSTEM: Previous attempt was evaluated and did not fully succeed.]',
    `Score: ${verdict.score}/10`,
    verdict.issues.length > 0 ? `Issues found:\n${verdict.issues.map((i) => `- ${i}`).join('\n')}` : '',
    `Evaluator feedback: ${verdict.feedback}`,
    '',
    'Please address the above issues and complete the task.',
  ]
    .filter((l) => l !== undefined)
    .join('\n');
}
