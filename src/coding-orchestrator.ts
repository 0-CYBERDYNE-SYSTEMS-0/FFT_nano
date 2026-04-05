import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

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

export type CodingWorkerRoute =
  | 'coder_execute'
  | 'coder_plan'
  | 'auto_execute'
  | 'subagent_execute'
  | 'subagent_plan';

export interface CodingWorkerRequest {
  requestId: string;
  parentRequestId?: string;
  mode: 'plan' | 'execute';
  route: CodingWorkerRoute;
  originChatJid: string;
  originGroupFolder: string;
  taskText: string;
  workspaceMode: 'ephemeral_worktree' | 'read_only';
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
  route?: CodingWorkerRoute;
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

function formatFinalMessage(params: {
  baseResult: string;
  worktreePath?: string;
  diffSummary?: string;
  changedFiles: string[];
  testsRun: string[];
}): string {
  const lines = [params.baseResult.trim()];
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

function buildWorkerPrompt(request: CodingWorkerRequest, learningsContext: string = ''): string {
  const lines = [
    '[REAL CODING WORKER RUN]',
    'You are the dedicated coding worker for FFT_nano.',
    'This is a host-managed worker run. Do the engineering work directly; do not claim delegation.',
    '',
    '## Worker Contract',
    `- route: ${request.route}`,
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
      'Return a concrete implementation plan.',
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

  return lines.join('\n');
}

function isSubagentRoute(route: CodingWorkerRoute): boolean {
  return route === 'subagent_execute' || route === 'subagent_plan';
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
    await runCommand('git', ['init'], { cwd: worktreePath, signal: params.signal });
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
export function getWorktreeBaseDir(sourceWorkspaceDir: string): Promise<string> {
  return runCommand(
    'git',
    ['-C', path.resolve(sourceWorkspaceDir), 'rev-parse', '--show-toplevel'],
  ).then(({ stdout }) => {
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
        Number.parseInt(process.env.FFT_NANO_PROGRESS_HEARTBEAT_MS || '30000', 10) ||
          30_000,
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
      route: request.route,
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
      detail: `coding_worker:${request.route}`,
    });

    const cleanupWorktree = async () => {
      if (!worktree || cleanedUp) return;
      cleanedUp = true;
      await worktree.cleanup();
    };

    try {
      let workspaceDirOverride: string | undefined;
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
          prompt: buildWorkerPrompt(request, learningsContext),
          groupFolder: request.group.folder,
          chatJid: request.originChatJid,
          isMain: request.group.folder === request.originGroupFolder,
          isSubagent: isSubagentRoute(request.route),
          assistantName: request.assistantName,
          requestId: request.requestId,
          codingHint: 'none',
          noContinue: true,
          toolMode: request.mode === 'plan' ? 'read_only' : 'full',
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
                route: request.route,
                mode: request.mode,
                workspaceMode: request.workspaceMode,
                timeoutSeconds: request.timeoutSeconds,
                allowFanout: request.allowFanout,
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
      const artifacts = worktree ? [worktree.worktreePath] : [];
      const baseResult = output.result?.trim() || 'Coding worker completed.';
      const finalMessage = formatFinalMessage({
        baseResult,
        worktreePath: worktree?.worktreePath,
        diffSummary,
        changedFiles,
        testsRun,
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
        usage: output.usage,
      };

      activeRun.state = 'completed';
      deps.publishEvent({
        kind: 'run_finished',
        id: createHostEventId('coder'),
        createdAt: finishedAt,
        source: 'coding-orchestrator',
        runId: request.requestId,
        sessionKey: request.sessionKey,
        chatJid: request.originChatJid,
        detail: `coding_worker:${request.route}`,
      });
      return {
        ok: true,
        result: finalMessage,
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
