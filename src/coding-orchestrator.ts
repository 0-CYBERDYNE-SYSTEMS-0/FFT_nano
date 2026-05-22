import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  runEvaluatorPass as defaultRunEvaluatorPass,
  buildRefinementPrompt,
} from './evaluator.js';

import type { RegisteredGroup } from './types.js';
import type {
  ContainerProgressEvent,
  ContainerInput,
  ContainerOutput,
  ExtensionUIRequest,
  ExtensionUIResponse,
  ContainerRuntimeEvent,
} from './pi-runner.js';
import { createHostEventId, type HostEvent } from './runtime/host-events.js';
import { getCoderLearningsForContext } from './coder-learnings.js';
import { createRunProgressReporter } from './run-progress.js';
import { resolveGroupFolderPath } from './group-folder.js';

export interface CodingRunConfig {
  toolMode: 'read_only' | 'full';
  isSubagent: boolean;
  workspaceMode: 'ephemeral_worktree' | 'read_only';
}

/**
 * Derives a legacy route label string from config for display/telemetry purposes.
 * This is NOT used for control flow - use config fields directly instead.
 */
function deriveRouteLabel(config: CodingRunConfig): string {
  const prefix = config.isSubagent ? 'subagent' : 'coder';
  const suffix = config.toolMode === 'read_only' ? 'plan' : 'execute';
  return `${prefix}_${suffix}`;
}

/**
 * Derives a human-readable detail string for host events from config.
 */
function deriveEventDetail(config: CodingRunConfig): string {
  const mode = config.toolMode === 'read_only' ? 'plan' : 'execute';
  return config.isSubagent
    ? `coding_worker:${mode}:subagent`
    : `coding_worker:${mode}`;
}

export interface CodingWorkerRequest {
  requestId: string;
  parentRequestId?: string;
  mode: 'plan' | 'execute';
  config: CodingRunConfig;
  originChatJid: string;
  originGroupFolder: string;
  taskText: string;
  timeoutSeconds: number;
  allowFanout: boolean;
  sessionContext: string;
  assistantName: string;
  sessionKey: string;
  group: RegisteredGroup;
  workspaceRoot?: string;
  runtimePrefs?: {
    provider?: string;
    model?: string;
    thinkLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    reasoningLevel?: 'off' | 'on' | 'stream';
    verboseMode?: 'off' | 'new' | 'all' | 'verbose';
  };
  abortController?: AbortController;
}

export interface CodingWorkerResult {
  status: 'success' | 'error' | 'aborted';
  summary: string;
  finalMessage: string;
  changedFiles: string[];
  commandsRun: string[];
  testsRun: string[];
  artifacts: string[];
  childRunIds: string[];
  startedAt: string;
  finishedAt: string;
  diffSummary?: string;
  worktreePath?: string;
  contractPath?: string;
  qaReportPath?: string;
  qaVerdict?: {
    pass: boolean;
    score: number;
    issues: string[];
    feedback: string;
    refinements: number;
  };
  error?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    provider?: string;
    model?: string;
  };
}

export interface CodingTaskRunResult {
  ok: boolean;
  result: string | null;
  streamed: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    provider?: string;
    model?: string;
  };
  workerResult: CodingWorkerResult;
}

export interface EphemeralWorktree {
  worktreePath: string;
  cleanup: () => Promise<void>;
  listChangedFiles: () => string[];
  getDiffSummary: () => string;
}

interface ActiveCodingRunState {
  requestId: string;
  mode: 'plan' | 'execute';
  chatJid: string;
  groupName: string;
  startedAt: number;
  parentRequestId?: string;
  backend?: 'pi';
  config?: CodingRunConfig;
  state?: 'starting' | 'running' | 'completed' | 'failed' | 'aborted';
  worktreePath?: string;
  childRunIds?: string[];
  abortController?: AbortController;
}

export interface CodingOrchestratorDeps {
  activeRuns: Map<string, ActiveCodingRunState>;
  runContainerAgent: (
    group: RegisteredGroup,
    input: ContainerInput,
    abortSignal?: AbortSignal,
    onRuntimeEvent?: (event: ContainerRuntimeEvent) => void,
    onExtensionUIRequest?: (
      request: ExtensionUIRequest,
    ) => Promise<ExtensionUIResponse>,
    onProgressEvent?: (event: ContainerProgressEvent) => void,
  ) => Promise<ContainerOutput>;
  publishEvent: (event: HostEvent) => void;
  createEphemeralWorktree?: (params: {
    requestId: string;
    sourceWorkspaceDir: string;
    signal?: AbortSignal;
  }) => Promise<EphemeralWorktree>;
  runEvaluatorPass?: typeof defaultRunEvaluatorPass;
}

function summarizeText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return 'Coding worker completed.';
  const [firstParagraph] = trimmed.split(/\n\s*\n/, 1);
  return firstParagraph.slice(0, 280);
}

function sanitizePathToken(value: string): string {
  return (
    value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'run'
  );
}

function commandFromArgs(rawArgs: string | undefined): string | null {
  if (!rawArgs) return null;
  try {
    const parsed = JSON.parse(rawArgs) as Record<string, unknown>;
    const direct = parsed.command;
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
    const cmd = parsed.cmd;
    if (typeof cmd === 'string' && cmd.trim()) return cmd.trim();
  } catch {
    // Fall through to text heuristics.
  }

  const commandMatch =
    rawArgs.match(/"command"\s*:\s*"([^"]+)"/) ||
    rawArgs.match(/"cmd"\s*:\s*"([^"]+)"/);
  if (commandMatch?.[1]) return commandMatch[1].trim();
  return rawArgs.trim() || null;
}

function extractCommands(
  toolExecutions: ContainerOutput['toolExecutions'],
): string[] {
  const commands: string[] = [];
  for (const execution of toolExecutions || []) {
    const command = commandFromArgs(execution.args);
    if (!command) continue;
    commands.push(command);
  }
  return Array.from(new Set(commands));
}

function extractTestsRun(commands: string[]): string[] {
  return commands.filter((command) =>
    /\b(test|vitest|jest|mocha|ava|tap|pytest|cargo test|go test|npm run test|pnpm test|yarn test)\b/i.test(
      command,
    ),
  );
}

interface CoderArtifactManifest {
  schema: 'fft_nano.coder_artifact.v1';
  requestId: string;
  mode: 'plan' | 'execute';
  // config is optional for backward compatibility with old manifests that used route
  config?: CodingRunConfig;
  createdAt: string;
  taskText: string;
  workspaceRoot?: string;
  contractPath?: string;
  qaReportPath?: string;
}

/**
 * Legacy route string from old manifest files.
 * Used only for backward compatibility when reading old manifests.
 */
type LegacyRoute =
  | 'coder_execute'
  | 'coder_plan'
  | 'auto_execute'
  | 'subagent_execute'
  | 'subagent_plan';

/**
 * Checks if a manifest is a legacy format with route instead of config.
 */
function isLegacyManifest(
  manifest: CoderArtifactManifest,
): manifest is CoderArtifactManifest & { route: LegacyRoute } {
  return (
    'route' in manifest &&
    typeof manifest.route === 'string' &&
    !('config' in manifest)
  );
}

/**
 * Derives CodingRunConfig from a legacy route string for backward compatibility.
 */
function configFromLegacyRoute(route: LegacyRoute): CodingRunConfig {
  return {
    toolMode: route.endsWith('_plan') ? 'read_only' : 'full',
    isSubagent: route.startsWith('subagent_'),
    workspaceMode: route.endsWith('_plan') ? 'read_only' : 'ephemeral_worktree',
  };
}

interface LatestPlanContract {
  requestId: string;
  createdAt: string;
  contractPath: string;
  text: string;
}

function getCoderArtifactsDir(request: CodingWorkerRequest): string {
  return path.join(
    resolveGroupFolderPath(request.originGroupFolder),
    'coder-runs',
    sanitizePathToken(request.requestId),
  );
}

function writeCoderArtifact(
  request: CodingWorkerRequest,
  filename: string,
  content: string,
): string {
  const dir = getCoderArtifactsDir(request);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  fs.writeFileSync(
    filePath,
    content.endsWith('\n') ? content : `${content}\n`,
    {
      encoding: 'utf-8',
    },
  );
  return filePath;
}

function writeCoderManifest(
  request: CodingWorkerRequest,
  manifest: Omit<CoderArtifactManifest, 'schema'>,
): string {
  return writeCoderArtifact(
    request,
    'manifest.json',
    JSON.stringify(
      { schema: 'fft_nano.coder_artifact.v1', ...manifest },
      null,
      2,
    ),
  );
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function findLatestPlanContract(
  request: CodingWorkerRequest,
): LatestPlanContract | null {
  const runsDir = path.join(
    resolveGroupFolderPath(request.originGroupFolder),
    'coder-runs',
  );
  if (!fs.existsSync(runsDir)) return null;
  let latest: LatestPlanContract | null = null;
  const requestWorkspaceRoot = path.resolve(
    request.workspaceRoot || process.cwd(),
  );

  for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(runsDir, entry.name, 'manifest.json');
    const manifest = readJsonFile<CoderArtifactManifest>(manifestPath);
    if (!manifest || manifest.mode !== 'plan' || !manifest.contractPath)
      continue;
    const manifestWorkspaceRoot = path.resolve(
      manifest.workspaceRoot || process.cwd(),
    );
    if (requestWorkspaceRoot !== manifestWorkspaceRoot) {
      continue;
    }
    if (!fs.existsSync(manifest.contractPath)) continue;
    const text = fs.readFileSync(manifest.contractPath, 'utf-8');
    if (!latest || manifest.createdAt > latest.createdAt) {
      latest = {
        requestId: manifest.requestId,
        createdAt: manifest.createdAt,
        contractPath: manifest.contractPath,
        text,
      };
    }
  }

  return latest;
}

function buildPlanContractArtifact(params: {
  request: CodingWorkerRequest;
  resultText: string;
  startedAt: string;
  finishedAt: string;
}): string {
  return [
    '# Coder Plan Contract',
    '',
    '## Metadata',
    `- request_id: ${params.request.requestId}`,
    `- route: ${deriveRouteLabel(params.request.config)}`,
    `- mode: ${params.request.mode}`,
    `- workspace_root: ${params.request.workspaceRoot || '(default)'}`,
    `- started_at: ${params.startedAt}`,
    `- finished_at: ${params.finishedAt}`,
    '',
    '## Original Task',
    params.request.taskText.trim(),
    '',
    '## Contract Produced By Plan Run',
    params.resultText.trim() || '(plan run returned no text)',
  ].join('\n');
}

function buildExecutionContract(params: {
  request: CodingWorkerRequest;
  latestPlan: LatestPlanContract | null;
}): string {
  const lines = [
    '# Coder Execution Contract',
    '',
    '## Current Request',
    params.request.taskText.trim(),
    '',
    '## Done Means',
    '- Implement the current request in the isolated worktree.',
    '- Keep edits scoped to the current request.',
    '- Run focused verification where practical.',
    '- Report changed files, commands, tests, and any residual risks.',
    '',
    '## Evaluator Must Check',
    '- The final diff satisfies the current request.',
    '- The worker did not merely describe work that should have been performed.',
    '- Claimed files, tests, and artifacts are reflected in host-observed outputs.',
    '- No obvious stubs, TODO-only implementations, or unrelated churn were introduced.',
  ];

  if (params.latestPlan) {
    lines.push(
      '',
      '## Advisory Plan Context',
      `Latest same-group plan contract: ${params.latestPlan.contractPath}`,
      '',
      params.latestPlan.text.slice(0, 6000),
    );
  }

  return lines.join('\n');
}

function formatQaReport(params: {
  request: CodingWorkerRequest;
  contractText: string;
  verdict: {
    pass: boolean;
    score: number;
    issues: string[];
    feedback: string;
    skipped?: boolean;
    skippedReason?: string;
  } | null;
  refinements: number;
  changedFiles: string[];
  testsRun: string[];
  commandsRun: string[];
  diffSummary: string;
  startedAt: string;
  finishedAt: string;
}): string {
  const verdict = params.verdict;
  return [
    '# Coder QA Report',
    '',
    '## Metadata',
    `- request_id: ${params.request.requestId}`,
    `- route: ${deriveRouteLabel(params.request.config)}`,
    `- started_at: ${params.startedAt}`,
    `- finished_at: ${params.finishedAt}`,
    `- refinements: ${params.refinements}`,
    '',
    '## Verdict',
    verdict
      ? `- pass: ${verdict.pass}\n- score: ${verdict.score}\n- skipped: ${verdict.skipped ? 'true' : 'false'}${
          verdict.skippedReason
            ? `\n- skipped_reason: ${verdict.skippedReason}`
            : ''
        }\n- feedback: ${verdict.feedback || '(none)'}`
      : '- pass: unknown\n- score: unknown\n- feedback: evaluator did not run',
    '',
    '## Issues',
    verdict?.issues.length
      ? verdict.issues.map((issue) => `- ${issue}`).join('\n')
      : '- None reported.',
    '',
    '## Host Observed Outputs',
    `- changed_files: ${params.changedFiles.length ? params.changedFiles.join(', ') : '(none)'}`,
    `- tests_run: ${params.testsRun.length ? params.testsRun.join(' | ') : '(none)'}`,
    `- commands_run: ${params.commandsRun.length ? params.commandsRun.join(' | ') : '(none)'}`,
    `- diff_summary: ${params.diffSummary || '(none)'}`,
    '',
    '## Evaluated Contract',
    params.contractText,
  ].join('\n');
}

function formatFinalMessage(params: {
  baseResult: string;
  worktreePath?: string;
  diffSummary?: string;
  changedFiles: string[];
  testsRun: string[];
  contractPath?: string;
  qaReportPath?: string;
  qaVerdict?: CodingWorkerResult['qaVerdict'];
}): string {
  const lines = [params.baseResult.trim()];
  if (params.contractPath) lines.push(`Contract: ${params.contractPath}`);
  if (params.qaReportPath) lines.push(`QA report: ${params.qaReportPath}`);
  if (params.qaVerdict) {
    lines.push(
      `QA verdict: ${params.qaVerdict.pass ? 'pass' : 'fail'} (${params.qaVerdict.score}/10, refinements: ${params.qaVerdict.refinements})`,
    );
  }
  if (params.worktreePath) lines.push(`Worktree: ${params.worktreePath}`);
  if (params.diffSummary) lines.push(`Diff: ${params.diffSummary}`);
  if (params.changedFiles.length > 0) {
    const preview = params.changedFiles.slice(0, 8).join(', ');
    const suffix =
      params.changedFiles.length > 8
        ? ` (+${params.changedFiles.length - 8} more)`
        : '';
    lines.push(`Changed files: ${preview}${suffix}`);
  }
  if (params.testsRun.length > 0) {
    lines.push(`Tests: ${params.testsRun.join(' | ')}`);
  }
  return lines.filter(Boolean).join('\n\n');
}

function buildWorkerPrompt(
  request: CodingWorkerRequest,
  learningsContext: string = '',
  contractText?: string,
): string {
  const lines = [
    '[REAL CODING WORKER RUN]',
    'You are the dedicated coding worker for FFT_nano.',
    'This is a host-managed worker run. Do the engineering work directly; do not claim delegation.',
    '',
    '## Worker Contract',
    `- route: ${deriveRouteLabel(request.config)}`,
    `- mode: ${request.mode}`,
    `- allow_fanout: ${request.allowFanout ? 'true' : 'false'}`,
    `- parent_request_id: ${request.parentRequestId || 'none'}`,
    '',
    '## Primary Task',
    request.taskText,
    '',
  ];

  // Prepend coder learnings context if available
  if (learningsContext) {
    lines.push(
      '## Recent Coder Context',
      '(lessons from previous runs — apply these patterns)',
      '',
      learningsContext,
      '',
    );
  }

  lines.push('## Session Context');
  lines.push(request.sessionContext);

  if (request.mode === 'plan') {
    lines.push(
      '',
      '## Plan Mode Rules',
      'Return a durable implementation spec/contract, not just casual advice.',
      'Include: goal, scope, non-goals, likely files/modules, acceptance criteria, verification plan, risks, and handoff notes.',
      'Do not modify tracked project files in this run.',
      'Use read-only inspection tools only.',
    );
  } else {
    lines.push(
      '',
      '## Execute Mode Rules',
      'Implement the requested work inside the assigned isolated workspace.',
      'Run focused verification where appropriate.',
      'Summarize changed files, commands, and tests in the final answer.',
    );
  }

  if (contractText) {
    lines.push(
      '',
      '## Host Execution Contract',
      'Treat this as the source of truth for what the evaluator will grade. Current request instructions override any advisory prior plan context.',
      '',
      contractText,
    );
  }

  return lines.join('\n');
}

function createWorkerErrorResult(
  request: CodingWorkerRequest,
  startedAt: string,
  message: string,
  status: 'error' | 'aborted' = 'error',
): CodingTaskRunResult {
  const finishedAt = new Date().toISOString();
  const summary = summarizeText(message);
  return {
    ok: false,
    result: message,
    streamed: false,
    workerResult: {
      status,
      summary,
      finalMessage: message,
      changedFiles: [],
      commandsRun: [],
      testsRun: [],
      artifacts: [],
      childRunIds: [],
      startedAt,
      finishedAt,
      error: message,
    },
  };
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; signal?: AbortSignal } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      signal: options.signal,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(' ')} failed with code ${code}: ${(stderr || stdout).trim()}`,
        ),
      );
    });
  });
}

function runCommandSync(
  command: string,
  args: string[],
  cwd: string,
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
  };
}

function hashString(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex');
}

/**
 * Extracts timestamp (epoch ms) from a worktree directory name.
 * Format: <sanitizedRequestId>-<timestamp>
 * Returns null if extraction fails.
 * Minimum valid timestamp is 10000000000 (10+ digits, Sept 2001) to filter out obviously fake timestamps.
 */
function extractWorktreeTimestamp(dirPath: string): number | null {
  const dirName = path.basename(dirPath);
  const lastHyphenIdx = dirName.lastIndexOf('-');
  if (lastHyphenIdx === -1) return null;
  const timestampStr = dirName.slice(lastHyphenIdx + 1);
  // Reject if timestampStr starts with '-' (e.g., "invalid-negative--12345")
  // or contains another hyphen (e.g., "coder--12345" for negative)
  if (timestampStr.startsWith('-') || timestampStr.includes('-')) return null;
  const timestamp = Number(timestampStr);
  // Reject NaN, zero, negative, and obviously fake timestamps (< 10 digits / Sept 2001)
  // Real epoch timestamps are 10+ digits (current timestamps are 13 digits)
  if (isNaN(timestamp) || timestamp <= 0 || timestamp < 1000000000) return null;
  return timestamp;
}

/**
 * Prunes retained worktrees older than retentionTtlMs, while respecting
 * maxRetainedWorktrees limit and protected (active) worktrees.
 *
 * @param worktreeBaseDir - The base directory containing worktree subdirs
 * @param protectedPaths - Set of worktree paths to never prune
 * @param retentionTtlMs - Worktrees older than this are eligible for pruning (default: 48h)
 * @param maxRetainedWorktrees - Maximum worktrees to retain per repo (default: 10)
 */
export async function pruneRetainedWorktrees(params: {
  worktreeBaseDir: string;
  protectedPaths: Set<string>;
  retentionTtlMs?: number;
  maxRetainedWorktrees?: number;
}): Promise<{ pruned: string[]; errors: string[] }> {
  const {
    worktreeBaseDir,
    protectedPaths,
    retentionTtlMs = 48 * 60 * 60 * 1000, // 48 hours default
    maxRetainedWorktrees = 10,
  } = params;

  const pruned: string[] = [];
  const errors: string[] = [];

  if (!fs.existsSync(worktreeBaseDir)) {
    return { pruned, errors };
  }

  const now = Date.now();
  const entries = fs.readdirSync(worktreeBaseDir, { withFileTypes: true });
  const worktreeDirs: { path: string; timestamp: number }[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(worktreeBaseDir, entry.name);
    if (protectedPaths.has(fullPath)) continue;
    const timestamp = extractWorktreeTimestamp(entry.name);
    if (timestamp === null) continue;
    worktreeDirs.push({ path: fullPath, timestamp });
  }

  // Sort by timestamp descending (newest first)
  worktreeDirs.sort((a, b) => b.timestamp - a.timestamp);

  // Mark worktrees for deletion
  const toDelete: string[] = [];
  for (let i = 0; i < worktreeDirs.length; i++) {
    const wt = worktreeDirs[i];
    const age = now - wt.timestamp;
    // Delete if too old OR if we exceed maxRetainedWorktrees (delete oldest ones first)
    if (age > retentionTtlMs || i >= maxRetainedWorktrees) {
      toDelete.push(wt.path);
    }
  }

  // Delete marked worktrees
  for (const wtPath of toDelete) {
    try {
      // First try git worktree remove
      try {
        // We need gitTopLevel to use git worktree remove --force
        // Since we don't have it here, fall back to direct rm
        fs.rmSync(wtPath, { recursive: true, force: true });
      } catch {
        fs.rmSync(wtPath, { recursive: true, force: true });
      }
      pruned.push(wtPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to prune ${wtPath}: ${msg}`);
    }
  }

  return { pruned, errors };
}

export async function createDefaultEphemeralWorktree(params: {
  requestId: string;
  sourceWorkspaceDir: string;
  signal?: AbortSignal;
}): Promise<EphemeralWorktree> {
  const workspaceRoot = path.resolve(params.sourceWorkspaceDir);
  const gitTopLevel = (
    await runCommand(
      'git',
      ['-C', workspaceRoot, 'rev-parse', '--show-toplevel'],
      {
        signal: params.signal,
      },
    )
  ).stdout.trim();
  if (!gitTopLevel) {
    throw new Error(`Could not resolve git root for ${workspaceRoot}`);
  }

  const repoHash = hashString(gitTopLevel);
  const worktreeBase = path.join(
    os.tmpdir(),
    'fft-nano-coder-worktrees',
    repoHash,
  );
  fs.mkdirSync(worktreeBase, { recursive: true });

  const worktreePath = path.join(
    worktreeBase,
    `${sanitizePathToken(params.requestId)}-${Date.now()}`,
  );

  // Check if the repo is unborn (has no commits)
  let isUnbornRepo = false;
  try {
    await runCommand('git', ['-C', gitTopLevel, 'rev-parse', 'HEAD'], {
      signal: params.signal,
    });
  } catch {
    isUnbornRepo = true;
  }

  if (isUnbornRepo) {
    // For unborn repos, create the directory and initialize a fresh git repo
    // This is needed because git worktree add requires at least one commit
    fs.mkdirSync(worktreePath, { recursive: true });
    const excludes = [
      '.git',
      'node_modules',
      '.next',
      'dist',
      'coverage',
      'logs',
      'data',
      'groups',
      'store',
      '.desloppify',
      '.venv',
      '.venv-*',
      '.venv-desloppify',
    ];
    const rsyncArgs = [
      '-a',
      '--delete',
      ...excludes.flatMap((value) => ['--exclude', value]),
      `${workspaceRoot}/`,
      `${worktreePath}/`,
    ];
    await runCommand('rsync', rsyncArgs, { signal: params.signal });
    // Initialize the worktree as a fresh git repo
    await runCommand('git', ['init'], {
      cwd: worktreePath,
      signal: params.signal,
    });
  } else {
    await runCommand(
      'git',
      ['-C', gitTopLevel, 'worktree', 'add', '--detach', worktreePath, 'HEAD'],
      {
        signal: params.signal,
      },
    );

    const excludes = [
      '.git',
      'node_modules',
      '.next',
      'dist',
      'coverage',
      'logs',
      'data',
      'groups',
      'store',
      '.desloppify',
      '.venv',
      '.venv-*',
      '.venv-desloppify',
    ];
    const rsyncArgs = [
      '-a',
      '--delete',
      ...excludes.flatMap((value) => ['--exclude', value]),
      `${workspaceRoot}/`,
      `${worktreePath}/`,
    ];
    await runCommand('rsync', rsyncArgs, { signal: params.signal });
  }

  return {
    worktreePath,
    cleanup: async () => {
      if (isUnbornRepo) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      } else {
        try {
          await runCommand('git', [
            '-C',
            gitTopLevel,
            'worktree',
            'remove',
            '--force',
            worktreePath,
          ]);
        } catch {
          fs.rmSync(worktreePath, { recursive: true, force: true });
        }
      }
    },
    listChangedFiles: () => {
      const status = runCommandSync('git', ['status', '--short'], worktreePath);
      if (status.status !== 0) return [];
      return status.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^[A-Z? ]+\s+/, ''));
    },
    getDiffSummary: () => {
      const summary = runCommandSync(
        'git',
        ['diff', '--shortstat', 'HEAD'],
        worktreePath,
      );
      if (summary.status !== 0) return '';
      return summary.stdout.trim();
    },
  };
}

/**
 * Computes the worktree base directory path for a given workspace.
 * Useful for calling pruneRetainedWorktrees before creating a worktree.
 */
export function getWorktreeBaseDir(
  sourceWorkspaceDir: string,
): Promise<string> {
  return runCommand('git', [
    '-C',
    path.resolve(sourceWorkspaceDir),
    'rev-parse',
    '--show-toplevel',
  ]).then(({ stdout }) => {
    const gitTopLevel = stdout.trim();
    if (!gitTopLevel) {
      throw new Error(`Could not resolve git root for ${sourceWorkspaceDir}`);
    }
    const repoHash = hashString(gitTopLevel);
    return path.join(os.tmpdir(), 'fft-nano-coder-worktrees', repoHash);
  });
}

export function createCodingOrchestrator(deps: CodingOrchestratorDeps): {
  runTask: (request: CodingWorkerRequest) => Promise<CodingTaskRunResult>;
} {
  const createEphemeralWorktree =
    deps.createEphemeralWorktree || createDefaultEphemeralWorktree;
  const runEvaluatorPass = deps.runEvaluatorPass || defaultRunEvaluatorPass;

  async function runTask(
    request: CodingWorkerRequest,
  ): Promise<CodingTaskRunResult> {
    const startedAt = new Date().toISOString();
    const childRunIds: string[] = [];
    let worktree: EphemeralWorktree | null = null;
    let cleanedUp = false;
    const runProgress = createRunProgressReporter({
      source: 'coding-orchestrator',
      runId: request.requestId,
      sessionKey: request.sessionKey,
      chatJid: request.originChatJid,
      heartbeatMs: Math.max(
        5_000,
        Number.parseInt(
          process.env.FFT_NANO_PROGRESS_HEARTBEAT_MS || '30000',
          10,
        ) || 30_000,
      ),
      emit: (event) => deps.publishEvent(event),
    });

    const activeRun: ActiveCodingRunState = {
      requestId: request.requestId,
      mode: request.mode,
      chatJid: request.originChatJid,
      groupName: request.group.name,
      startedAt: Date.now(),
      parentRequestId: request.parentRequestId,
      backend: 'pi',
      config: request.config,
      state: 'starting',
      childRunIds,
      abortController: request.abortController,
    };
    deps.activeRuns.set(request.requestId, activeRun);

    deps.publishEvent({
      kind: 'run_started',
      id: createHostEventId('coder'),
      createdAt: startedAt,
      source: 'coding-orchestrator',
      runId: request.requestId,
      sessionKey: request.sessionKey,
      chatJid: request.originChatJid,
      detail: deriveEventDetail(request.config),
    });

    const cleanupWorktree = async () => {
      if (!worktree || cleanedUp) return;
      cleanedUp = true;
      await worktree.cleanup();
    };

    try {
      let workspaceDirOverride: string | undefined;
      let executionContract: string | undefined;
      let contractPath: string | undefined;
      let qaReportPath: string | undefined;
      let qaVerdict: CodingWorkerResult['qaVerdict'];
      if (request.mode === 'execute') {
        // Prune stale worktrees before creating a new one, protecting active runs
        const activeWorktreePaths = new Set<string>();
        for (const run of deps.activeRuns.values()) {
          if (run.worktreePath) {
            activeWorktreePaths.add(run.worktreePath);
          }
        }
        const worktreeBaseDir = await getWorktreeBaseDir(
          request.workspaceRoot || process.cwd(),
        );
        await pruneRetainedWorktrees({
          worktreeBaseDir,
          protectedPaths: activeWorktreePaths,
          retentionTtlMs: 48 * 60 * 60 * 1000, // 48 hours
          maxRetainedWorktrees: 10,
        });

        worktree = await createEphemeralWorktree({
          requestId: request.requestId,
          sourceWorkspaceDir: request.workspaceRoot || process.cwd(),
          signal: request.abortController?.signal,
        });
        workspaceDirOverride = worktree.worktreePath;
        activeRun.worktreePath = worktree.worktreePath;

        const latestPlan = findLatestPlanContract(request);
        executionContract = buildExecutionContract({ request, latestPlan });
        contractPath = writeCoderArtifact(
          request,
          'EXECUTION_CONTRACT.md',
          executionContract,
        );
        writeCoderManifest(request, {
          requestId: request.requestId,
          mode: request.mode,
          config: request.config,
          createdAt: startedAt,
          taskText: request.taskText,
          workspaceRoot: request.workspaceRoot,
          contractPath,
        });
      }
      activeRun.state = 'running';

      // Fetch coder learnings from MEMORY.md to prepend to context
      const learningsContext = await getCoderLearningsForContext(
        request.originGroupFolder,
        5, // maxEntries
      );

      const output = await deps.runContainerAgent(
        request.group,
        {
          prompt: buildWorkerPrompt(
            request,
            learningsContext,
            executionContract,
          ),
          groupFolder: request.group.folder,
          chatJid: request.originChatJid,
          isMain: request.group.folder === request.originGroupFolder,
          isSubagent: request.config.isSubagent,
          assistantName: request.assistantName,
          requestId: request.requestId,
          codingHint: 'none',
          noContinue: true,
          toolMode: request.config.toolMode,
          workspaceDirOverride,
          provider: request.runtimePrefs?.provider,
          model: request.runtimePrefs?.model,
          thinkLevel: request.runtimePrefs?.thinkLevel,
          reasoningLevel: request.runtimePrefs?.reasoningLevel,
          verboseMode: request.runtimePrefs?.verboseMode,
          extraSystemPrompt: [
            '## Coding Worker Metadata',
            '```json',
            JSON.stringify(
              {
                schema: 'fft_nano.coding_worker_request.v1',
                requestId: request.requestId,
                parentRequestId: request.parentRequestId || null,
                route: deriveRouteLabel(request.config),
                mode: request.mode,
                workspaceMode: request.config.workspaceMode,
                timeoutSeconds: request.timeoutSeconds,
                allowFanout: request.allowFanout,
                contractPath: contractPath || null,
              },
              null,
              2,
            ),
            '```',
          ].join('\n'),
        },
        request.abortController?.signal,
        (event) => {
          deps.publishEvent({
            kind: 'tool_progress',
            id: createHostEventId('tool'),
            createdAt: new Date().toISOString(),
            source: 'coding-orchestrator',
            runId: request.requestId,
            sessionKey: request.sessionKey,
            chatJid: request.originChatJid,
            index: event.index,
            toolName: event.toolName,
            status: event.status,
            ...(event.args ? { args: event.args } : {}),
            ...(event.output ? { output: event.output } : {}),
            ...(event.error ? { error: event.error } : {}),
          });
        },
        undefined,
        (event) => {
          runProgress.handle(event);
        },
      );

      if (output.status === 'error') {
        const message = output.error || 'Coding worker failed.';
        const aborted = /aborted/i.test(message);
        activeRun.state = aborted ? 'aborted' : 'failed';
        await cleanupWorktree();
        deps.publishEvent({
          kind: aborted ? 'run_aborted' : 'run_failed',
          id: createHostEventId('coder'),
          createdAt: new Date().toISOString(),
          source: 'coding-orchestrator',
          runId: request.requestId,
          sessionKey: request.sessionKey,
          chatJid: request.originChatJid,
          ...(aborted ? { detail: message } : { errorMessage: message }),
        });
        return createWorkerErrorResult(
          request,
          startedAt,
          message,
          aborted ? 'aborted' : 'error',
        );
      }

      const commandsRun = extractCommands(output.toolExecutions);
      const testsRun = extractTestsRun(commandsRun);
      const changedFiles = worktree ? worktree.listChangedFiles() : [];
      const diffSummary = worktree ? worktree.getDiffSummary() : '';
      if (request.mode === 'plan') {
        contractPath = writeCoderArtifact(
          request,
          'CODER_PLAN_CONTRACT.md',
          buildPlanContractArtifact({
            request,
            resultText: output.result || '',
            startedAt,
            finishedAt: new Date().toISOString(),
          }),
        );
        writeCoderManifest(request, {
          requestId: request.requestId,
          mode: request.mode,
          config: request.config,
          createdAt: startedAt,
          taskText: request.taskText,
          workspaceRoot: request.workspaceRoot,
          contractPath,
        });
      }
      const artifacts = [
        ...(worktree ? [worktree.worktreePath] : []),
        ...(contractPath ? [contractPath] : []),
      ];
      const baseResult = output.result?.trim() || 'Coding worker completed.';
      const finalMessage = formatFinalMessage({
        baseResult,
        worktreePath: worktree?.worktreePath,
        diffSummary,
        changedFiles,
        testsRun,
        contractPath,
      });
      const finishedAt = new Date().toISOString();
      const workerResult: CodingWorkerResult = {
        status: 'success',
        summary: summarizeText(baseResult),
        finalMessage,
        changedFiles,
        commandsRun,
        testsRun,
        artifacts,
        childRunIds,
        startedAt,
        finishedAt,
        ...(diffSummary ? { diffSummary } : {}),
        ...(worktree ? { worktreePath: worktree.worktreePath } : {}),
        ...(contractPath ? { contractPath } : {}),
        usage: output.usage,
      };

      // Evaluator pass — blocking with refinement loop for execute runs.
      // Plan-only runs are skipped (no side effects to verify).
      if (request.mode === 'execute') {
        const EVAL_MAX_REFINEMENTS = 2;
        let refinements = 0;
        let evalTaskText = executionContract || request.taskText;
        let evalOutput = output;
        let evalChangedFiles = changedFiles;
        let lastVerdict: Awaited<ReturnType<typeof runEvaluatorPass>> | null =
          null;

        for (
          let evalAttempt = 0;
          evalAttempt <= EVAL_MAX_REFINEMENTS;
          evalAttempt += 1
        ) {
          const verdict = await runEvaluatorPass({
            runType: request.config.isSubagent ? 'subagent' : 'coding',
            originalTask: evalTaskText,
            agentOutput: evalOutput.result ?? '',
            durationMs: Date.now() - new Date(startedAt).getTime(),
            toolsInvoked: evalOutput.toolExecutions?.length ?? 0,
            changedFiles: evalChangedFiles,
            group: request.group,
            chatJid: request.originChatJid,
            isMain: request.group.folder === request.originGroupFolder,
            workspaceDir: workspaceDirOverride,
            workspaceDirOverride,
            startedAtMs: new Date(startedAt).getTime(),
            forceEvaluate: true,
            abortSignal: request.abortController?.signal,
          });
          lastVerdict = verdict;

          if (verdict.skipped || verdict.pass) break;
          if (refinements >= EVAL_MAX_REFINEMENTS) break;

          // Evaluator found issues — run a refinement pass
          const refinedPrompt = buildRefinementPrompt(evalTaskText, verdict);
          const refinedOutput = await deps.runContainerAgent(
            request.group,
            {
              prompt: buildWorkerPrompt(
                { ...request, taskText: refinedPrompt },
                learningsContext,
                executionContract,
              ),
              groupFolder: request.group.folder,
              chatJid: request.originChatJid,
              isMain: request.group.folder === request.originGroupFolder,
              isSubagent: request.config.isSubagent,
              assistantName: request.assistantName,
              requestId: request.requestId,
              codingHint: 'none',
              noContinue: true,
              toolMode: 'full',
              workspaceDirOverride,
              provider: request.runtimePrefs?.provider,
              model: request.runtimePrefs?.model,
            },
            request.abortController?.signal,
          );

          if (refinedOutput.status === 'success' && refinedOutput.result) {
            refinements += 1;
            evalOutput = refinedOutput;
            evalChangedFiles = worktree
              ? worktree.listChangedFiles()
              : evalChangedFiles;
            evalTaskText = refinedPrompt;
          } else {
            // Refinement failed — keep best result and stop
            break;
          }
        }

        // Rebuild final result from potentially-refined output
        const finalCommandsRun = extractCommands(evalOutput.toolExecutions);
        const finalTestsRun = extractTestsRun(finalCommandsRun);
        const finalChangedFiles = evalChangedFiles;
        const finalBase = evalOutput.result?.trim() || baseResult;
        const finalDiff = worktree ? worktree.getDiffSummary() : diffSummary;
        if (lastVerdict) {
          qaVerdict = {
            pass: lastVerdict.pass,
            score: lastVerdict.score,
            issues: lastVerdict.issues,
            feedback: lastVerdict.feedback,
            refinements,
          };
          qaReportPath = writeCoderArtifact(
            request,
            'CODER_QA_REPORT.md',
            formatQaReport({
              request,
              contractText: executionContract || request.taskText,
              verdict: lastVerdict,
              refinements,
              changedFiles: finalChangedFiles,
              testsRun: finalTestsRun,
              commandsRun: finalCommandsRun,
              diffSummary: finalDiff,
              startedAt,
              finishedAt: new Date().toISOString(),
            }),
          );
          writeCoderManifest(request, {
            requestId: request.requestId,
            mode: request.mode,
            config: request.config,
            createdAt: startedAt,
            taskText: request.taskText,
            workspaceRoot: request.workspaceRoot,
            contractPath,
            qaReportPath,
          });
        }
        const refinedFinalMessage = formatFinalMessage({
          baseResult: finalBase,
          worktreePath: worktree?.worktreePath,
          diffSummary: finalDiff,
          changedFiles: finalChangedFiles,
          testsRun: finalTestsRun,
          contractPath,
          qaReportPath,
          qaVerdict,
        });
        workerResult.finalMessage = refinedFinalMessage;
        workerResult.changedFiles = finalChangedFiles;
        workerResult.commandsRun = finalCommandsRun;
        workerResult.testsRun = finalTestsRun;
        workerResult.summary = summarizeText(finalBase);
        if (qaReportPath) workerResult.qaReportPath = qaReportPath;
        if (qaVerdict) workerResult.qaVerdict = qaVerdict;
        if (qaReportPath) {
          workerResult.artifacts = Array.from(
            new Set([...workerResult.artifacts, qaReportPath]),
          );
        }
      }

      activeRun.state = 'completed';
      deps.publishEvent({
        kind: 'run_finished',
        id: createHostEventId('coder'),
        createdAt: finishedAt,
        source: 'coding-orchestrator',
        runId: request.requestId,
        sessionKey: request.sessionKey,
        chatJid: request.originChatJid,
        detail: deriveEventDetail(request.config),
      });
      return {
        ok: true,
        result: workerResult.finalMessage,
        streamed: false,
        usage: output.usage,
        workerResult,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const aborted = /aborted/i.test(message);
      activeRun.state = aborted ? 'aborted' : 'failed';
      await cleanupWorktree();
      deps.publishEvent({
        kind: aborted ? 'run_aborted' : 'run_failed',
        id: createHostEventId('coder'),
        createdAt: new Date().toISOString(),
        source: 'coding-orchestrator',
        runId: request.requestId,
        sessionKey: request.sessionKey,
        chatJid: request.originChatJid,
        ...(aborted ? { detail: message } : { errorMessage: message }),
      });
      return createWorkerErrorResult(
        request,
        startedAt,
        message,
        aborted ? 'aborted' : 'error',
      );
    } finally {
      runProgress.stop();
      deps.activeRuns.delete(request.requestId);
    }
  }

  return { runTask };
}
