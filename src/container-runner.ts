/**
 * Container Runner for FFT_nano
 * Spawns agent execution in Apple Container and handles IPC
 */
import { exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  CONTAINER_IMAGE,
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  DATA_DIR,
  FARM_STATE_DIR,
  FARM_STATE_ENABLED,
  FFT_DASHBOARD_REPO_PATH,
  GROUPS_DIR,
  MAIN_GROUP_FOLDER,
  MAIN_WORKSPACE_DIR,
  MEMORY_RETRIEVAL_GATE_ENABLED,
  TIMEZONE,
} from './config.js';
import { getContainerRuntime, getRuntimeCommand } from './container-runtime.js';
import type { ContainerRuntime } from './container-runtime.js';
import {
  assertValidGroupFolder,
  resolveGroupFolderPath,
  resolveGroupIpcPath,
} from './group-folder.js';
import { logger } from './logger.js';
import { buildMemoryContext } from './memory-retrieval.js';
import { validateAdditionalMounts } from './mount-security.js';
import { syncProjectPiSkillsToGroupPiHome } from './pi-skills.js';
import { RegisteredGroup } from './types.js';
import { ensureMemoryScaffold } from './memory-paths.js';
import { ensureMainWorkspaceBootstrap } from './workspace-bootstrap.js';

// Sentinel markers for robust output parsing (must match agent-runner)
const OUTPUT_START_MARKER = '---FFT_NANO_OUTPUT_START---';
const OUTPUT_END_MARKER = '---FFT_NANO_OUTPUT_END---';

export interface ContainerInput {
  prompt: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  secrets?: Record<string, string>;
  codingHint?: 'none' | 'auto' | 'force_delegate_execute' | 'force_delegate_plan';
  requestId?: string;
  memoryContext?: string;
  extraSystemPrompt?: string;
  provider?: string;
  model?: string;
  thinkLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  reasoningLevel?: 'off' | 'on' | 'stream';
  noContinue?: boolean;
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  error?: string;
  streamed?: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    provider?: string;
    model?: string;
  };
}

interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly?: boolean;
}

function ensureMainWorkspaceSeed(): void {
  ensureMainWorkspaceBootstrap({ workspaceDir: MAIN_WORKSPACE_DIR });

  fs.mkdirSync(path.join(MAIN_WORKSPACE_DIR, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(MAIN_WORKSPACE_DIR, 'skills'), { recursive: true });
  ensureMemoryScaffold(MAIN_GROUP_FOLDER);
}

function ensureCodexMultiAgentConfig(codexConfigPath: string): void {
  const featureLine = 'multi_agent = true';
  const featureSection = '[features]';
  const defaultConfig = `${featureSection}\n${featureLine}\n`;

  if (!fs.existsSync(codexConfigPath)) {
    fs.writeFileSync(codexConfigPath, defaultConfig);
    return;
  }

  const current = fs.readFileSync(codexConfigPath, 'utf-8');
  if (/\bmulti_agent\s*=\s*true\b/m.test(current)) return;

  if (/\bmulti_agent\s*=\s*false\b/m.test(current)) {
    const updated = current.replace(
      /\bmulti_agent\s*=\s*false\b/m,
      featureLine,
    );
    fs.writeFileSync(codexConfigPath, updated);
    return;
  }

  if (/^\s*\[features\]\s*$/m.test(current)) {
    const updated = current.replace(
      /^\s*\[features\]\s*$/m,
      `${featureSection}\n${featureLine}`,
    );
    fs.writeFileSync(codexConfigPath, updated);
    return;
  }

  const needsNewline = current.length > 0 && !current.endsWith('\n');
  const suffix = `${needsNewline ? '\n' : ''}${defaultConfig}`;
  fs.writeFileSync(codexConfigPath, `${current}${suffix}`);
}

function buildVolumeMounts(
  group: RegisteredGroup,
  isMain: boolean,
): VolumeMount[] {
  const mounts: VolumeMount[] = [];
  const projectRoot = process.cwd();
  assertValidGroupFolder(group.folder);
  const groupDir = resolveGroupFolderPath(group.folder);

  if (isMain) {
    ensureMainWorkspaceSeed();

    // Main gets the project root read-only. Writable paths the agent needs
    // (group folder, IPC, .claude/) are mounted separately below.
    // Read-only prevents the agent from modifying host application code
    // (src/, dist/, package.json, etc.) which would bypass the sandbox
    // entirely on next restart.
    mounts.push({
      hostPath: projectRoot,
      containerPath: '/workspace/project',
      readonly: true,
    });

    // Main uses dedicated workspace as the primary working directory.
    mounts.push({
      hostPath: MAIN_WORKSPACE_DIR,
      containerPath: '/workspace/group',
      readonly: false,
    });
  } else {
    ensureMemoryScaffold(group.folder);
    // Other groups only get their own folder
    mounts.push({
      hostPath: groupDir,
      containerPath: '/workspace/group',
      readonly: false,
    });

    // Global memory directory (read-only for non-main)
    // Apple Container only supports directory mounts, not file mounts
    const globalDir = path.join(GROUPS_DIR, 'global');
    if (fs.existsSync(globalDir)) {
      mounts.push({
        hostPath: globalDir,
        containerPath: '/workspace/global',
        readonly: true,
      });
    }
  }

  // Per-group Claude sessions directory (isolated from other groups)
  // Each group gets their own ~/.pi to prevent cross-group session access.
  // Pi persists sessions and auth/config under ~/.pi.
  const groupPiHomeDir = path.join(DATA_DIR, 'pi', group.folder, '.pi');
  fs.mkdirSync(groupPiHomeDir, { recursive: true });
  const runtimeSkillSourceDirs = isMain
    ? [path.join(MAIN_WORKSPACE_DIR, 'skills')]
    : [];
  const skillSync = syncProjectPiSkillsToGroupPiHome(projectRoot, groupPiHomeDir, {
    additionalSkillSourceDirs: runtimeSkillSourceDirs,
  });
  if (skillSync.sourceDirExists) {
    logger.debug(
      {
        group: group.name,
        sourceDirs: skillSync.sourceDirs,
        managedSkills: skillSync.managed,
        copiedSkills: skillSync.copied,
        removedSkills: skillSync.removed,
        skippedInvalidSkills: skillSync.skippedInvalid,
        invalidSkillIssueCount: skillSync.invalid.length,
        warnedSkills: skillSync.warnedSkills,
        warningSkillIssueCount: skillSync.warnings.length,
      },
      'Synced project Pi skills into group Pi home',
    );
  }
  if (skillSync.skippedInvalid.length > 0) {
    logger.warn(
      {
        group: group.name,
        skippedInvalidSkills: skillSync.skippedInvalid,
        invalidSkillIssues: skillSync.invalid,
      },
      'Skipped invalid Pi skills during sync',
    );
  }
  if (skillSync.warnedSkills.length > 0) {
    logger.warn(
      {
        group: group.name,
        warnedSkills: skillSync.warnedSkills,
        warningSkillIssues: skillSync.warnings,
      },
      'Pi skills synced with non-blocking policy warnings',
    );
  }
  mounts.push({
    hostPath: groupPiHomeDir,
    containerPath: '/home/node/.pi',
    readonly: false,
  });

  // Persist Codex config per group so nested Codex runs inside the container
  // resolve a stable ~/.codex/config.toml with required feature flags.
  const groupCodexHomeDir = path.join(DATA_DIR, 'codex', group.folder, '.codex');
  fs.mkdirSync(groupCodexHomeDir, { recursive: true });
  ensureCodexMultiAgentConfig(path.join(groupCodexHomeDir, 'config.toml'));
  mounts.push({
    hostPath: groupCodexHomeDir,
    containerPath: '/home/node/.codex',
    readonly: false,
  });

  // Per-group IPC namespace: each group gets its own IPC directory
  // This prevents cross-group privilege escalation via IPC
  const groupIpcDir = resolveGroupIpcPath(group.folder);
  fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'actions'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'action_results'), { recursive: true });
  mounts.push({
    hostPath: groupIpcDir,
    containerPath: '/workspace/ipc',
    readonly: false,
  });

  // Farm state ledger (read-only for all groups)
  if (FARM_STATE_ENABLED && fs.existsSync(FARM_STATE_DIR)) {
    mounts.push({
      hostPath: FARM_STATE_DIR,
      containerPath: '/workspace/farm-state',
      readonly: true,
    });
  }

  // Dashboard workspace (read-write in main only)
  if (FARM_STATE_ENABLED && isMain && FFT_DASHBOARD_REPO_PATH) {
    const haConfigPath = path.join(FFT_DASHBOARD_REPO_PATH, 'ha_config');
    if (fs.existsSync(haConfigPath)) {
      mounts.push({
        hostPath: haConfigPath,
        containerPath: '/workspace/dashboard',
        readonly: false,
      });
    }

    const templatesPath = path.join(FFT_DASHBOARD_REPO_PATH, 'dashboard-templates');
    if (fs.existsSync(templatesPath)) {
      mounts.push({
        hostPath: templatesPath,
        containerPath: '/workspace/dashboard-templates',
        readonly: true,
      });
    }
  }

  // Copy agent-runner source into a per-group writable location so agents
  // can customize it (add tools, change behavior) without affecting other
  // groups. Recompiled on container startup via entrypoint.sh.
  const agentRunnerSrc = path.join(projectRoot, 'container', 'agent-runner', 'src');
  const groupAgentRunnerDir = path.join(DATA_DIR, 'sessions', group.folder, 'agent-runner-src');
  if (!fs.existsSync(groupAgentRunnerDir) && fs.existsSync(agentRunnerSrc)) {
    fs.cpSync(agentRunnerSrc, groupAgentRunnerDir, { recursive: true });
  }
  mounts.push({
    hostPath: groupAgentRunnerDir,
    containerPath: '/app/src',
    readonly: false,
  });

  // Additional mounts validated against external allowlist (tamper-proof from containers)
  if (group.containerConfig?.additionalMounts) {
    const validatedMounts = validateAdditionalMounts(
      group.containerConfig.additionalMounts,
      group.name,
      isMain,
    );
    mounts.push(...validatedMounts);
  }

  return mounts;
}

function stripDotEnvQuotes(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1);
  }
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return v;
}

function collectRuntimeSecrets(projectRoot: string): Record<string, string> {
  const envFile = path.join(projectRoot, '.env');
  const allowedVars = [
    // Pi / OpenAI-compatible config
    'PI_BASE_URL',
    'PI_API_KEY',
    'PI_MODEL',
    'PI_API',

    // Common provider keys
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'ANTHROPIC_API_KEY',
    'GEMINI_API_KEY',
    'OPENROUTER_API_KEY',
    'GROQ_API_KEY',
    'ZAI_API_KEY',

    // Debugging
    'FFT_NANO_DRY_RUN',

    // Farm bridge / Home Assistant
    'HA_URL',
    'HA_TOKEN',
  ] as const;

  const fromDotEnv: Record<string, string> = {};
  if (fs.existsSync(envFile)) {
    const envContent = fs.readFileSync(envFile, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!(allowedVars as readonly string[]).includes(key)) continue;
      const value = stripDotEnvQuotes(trimmed.slice(eq + 1));
      fromDotEnv[key] = value;
    }
  }

  const fromProcess: Record<string, string> = {};
  for (const key of allowedVars) {
    const v = process.env[key];
    if (typeof v === 'string' && v.length > 0) fromProcess[key] = v;
  }

  const merged: Record<string, string> = { ...fromDotEnv, ...fromProcess };
  if (merged.PI_BASE_URL && !merged.OPENAI_BASE_URL) {
    merged.OPENAI_BASE_URL = merged.PI_BASE_URL;
  }

  // Keep container runtime env stable without mounting env files.
  merged.TZ = TIMEZONE;
  merged.HOME = '/home/node';
  merged.PI_CODING_AGENT_DIR = '/home/node/.pi/agent';
  return merged;
}

function buildContainerArgs(
  runtime: ContainerRuntime,
  mounts: VolumeMount[],
  containerName: string,
): string[] {
  const args: string[] = ['run', '-i', '--rm', '--name', containerName];

  if (runtime === 'docker') {
    for (const mount of mounts) {
      const roSuffix = mount.readonly ? ':ro' : '';
      args.push('-v', `${mount.hostPath}:${mount.containerPath}${roSuffix}`);
    }
  } else {
    // Apple Container: --mount for readonly, -v for read-write
    for (const mount of mounts) {
      if (mount.readonly) {
        args.push(
          '--mount',
          `type=bind,source=${mount.hostPath},target=${mount.containerPath},readonly`,
        );
      } else {
        args.push('-v', `${mount.hostPath}:${mount.containerPath}`);
      }
    }
  }

  args.push(CONTAINER_IMAGE);

  return args;
}

export async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  abortSignal?: AbortSignal,
): Promise<ContainerOutput> {
  const startTime = Date.now();
  let payload: ContainerInput = input;
  const projectRoot = process.cwd();
  let groupDir: string;
  try {
    assertValidGroupFolder(group.folder);
    groupDir = resolveGroupFolderPath(group.folder);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error(
      { groupName: group.name, groupFolder: group.folder, error },
      'Rejected run for invalid group folder',
    );
    return {
      status: 'error',
      result: null,
      error,
    };
  }

  if (MEMORY_RETRIEVAL_GATE_ENABLED) {
    try {
      const memory = buildMemoryContext({
        groupFolder: group.folder,
        prompt: input.prompt,
      });
      if (memory.context) {
        payload = { ...input, memoryContext: memory.context };
      }
      logger.debug(
        {
          group: group.name,
          chunksTotal: memory.chunksTotal,
          selectedK: memory.selectedK,
          contextChars: memory.contextChars,
          queryChars: memory.queryChars,
          gateEnabled: MEMORY_RETRIEVAL_GATE_ENABLED,
        },
        'Built retrieval-gated memory context',
      );
    } catch (err) {
      logger.warn(
        { group: group.name, err },
        'Failed to build memory context; continuing without retrieval context',
      );
    }
  }

  fs.mkdirSync(groupDir, { recursive: true });

  const mounts = buildVolumeMounts(group, input.isMain);
  const runtime = getContainerRuntime();
  const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
  const containerName = `nanoclaw-${safeName}-${Date.now()}`;
  const containerArgs = buildContainerArgs(runtime, mounts, containerName);
  const runtimeCmd = getRuntimeCommand(runtime);

  logger.debug(
    {
      group: group.name,
      mounts: mounts.map(
        (m) =>
          `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
      ),
      containerArgs: containerArgs.join(' '),
      containerName,
      runtime,
    },
    'Container mount configuration',
  );

  logger.info(
    {
      group: group.name,
      containerName,
      mountCount: mounts.length,
      isMain: input.isMain,
    },
    'Spawning container agent',
  );

  const logsDir = path.join(groupDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  return new Promise((resolve) => {
    const container = spawn(runtimeCmd, containerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let settled = false;
    let onAbort: (() => void) | null = null;
    let exited = false;
    let timedOut = false;
    let abortEscalationTimer: ReturnType<typeof setTimeout> | null = null;

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

    const finish = (output: ContainerOutput) => {
      if (settled) return;
      settled = true;
      if (abortSignal && onAbort) {
        abortSignal.removeEventListener('abort', onAbort);
      }
      resolve(output);
    };

    const payloadWithSecrets: ContainerInput = {
      ...payload,
      secrets: collectRuntimeSecrets(projectRoot),
    };
    container.stdin.write(JSON.stringify(payloadWithSecrets));
    container.stdin.end();

    container.stdout.on('data', (data) => {
      if (stdoutTruncated) return;
      const chunk = data.toString();
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
      if (chunk.length > remaining) {
        stdout += chunk.slice(0, remaining);
        stdoutTruncated = true;
        logger.warn(
          { group: group.name, size: stdout.length },
          'Container stdout truncated due to size limit',
        );
      } else {
        stdout += chunk;
      }
    });

    container.stderr.on('data', (data) => {
      const chunk = data.toString();
      const lines = chunk.trim().split('\n');
      for (const line of lines) {
        if (line) logger.debug({ container: group.folder }, line);
      }
      if (stderrTruncated) return;
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
      if (chunk.length > remaining) {
        stderr += chunk.slice(0, remaining);
        stderrTruncated = true;
        logger.warn(
          { group: group.name, size: stderr.length },
          'Container stderr truncated due to size limit',
        );
      } else {
        stderr += chunk;
      }
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      logger.error(
        { group: group.name, containerName, runtime },
        'Container timeout, stopping gracefully',
      );
      exec(`${runtimeCmd} stop ${containerName}`, { timeout: 15000 }, (err) => {
        if (!err) return;
        logger.warn(
          { group: group.name, containerName, runtime, err },
          'Graceful runtime stop failed; escalating to SIGKILL',
        );
        container.kill('SIGKILL');
      });
    }, group.containerConfig?.timeout || CONTAINER_TIMEOUT);

    container.once('exit', () => {
      exited = true;
      if (abortEscalationTimer) {
        clearTimeout(abortEscalationTimer);
        abortEscalationTimer = null;
      }
    });

    onAbort = () => {
      logger.info({ group: group.name }, 'Container run aborted by signal');
      if (!exited) {
        container.kill('SIGTERM');
      }
      abortEscalationTimer = setTimeout(() => {
        if (exited) return;
        logger.warn(
          { group: group.name },
          'Container did not exit after SIGTERM; escalating to SIGKILL',
        );
        container.kill('SIGKILL');
      }, 750);
      clearTimeout(timeout);
      finish({
        status: 'error',
        result: null,
        error: 'Aborted by user',
      });
    };

    if (abortSignal) {
      if (abortSignal.aborted) {
        onAbort();
      } else {
        abortSignal.addEventListener('abort', onAbort, { once: true });
      }
    }

    container.on('close', (code) => {
      if (settled) return;
      clearTimeout(timeout);
      const duration = Date.now() - startTime;

      if (timedOut) {
        finish({
          status: 'error',
          result: null,
          error: `Container timed out after ${group.containerConfig?.timeout || CONTAINER_TIMEOUT}ms`,
        });
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = path.join(logsDir, `container-${timestamp}.log`);
      const isVerbose =
        process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace';

      const logLines = [
        `=== Container Run Log ===`,
        `Timestamp: ${new Date().toISOString()}`,
        `Group: ${group.name}`,
        `IsMain: ${input.isMain}`,
        `Duration: ${duration}ms`,
        `Exit Code: ${code}`,
        `Stdout Truncated: ${stdoutTruncated}`,
        `Stderr Truncated: ${stderrTruncated}`,
        ``,
      ];

      const isError = code !== 0;

      if (isVerbose || isError) {
        logLines.push(
          `=== Input ===`,
          JSON.stringify(payload, null, 2),
          ``,
          `=== Container Args ===`,
          containerArgs.join(' '),
          ``,
          `=== Mounts ===`,
          mounts
            .map(
              (m) =>
                `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
            )
            .join('\n'),
          ``,
          `=== Stderr${stderrTruncated ? ' (TRUNCATED)' : ''} ===`,
          stderr,
          ``,
          `=== Stdout${stdoutTruncated ? ' (TRUNCATED)' : ''} ===`,
          stdout,
        );
      } else {
        logLines.push(
          `=== Input Summary ===`,
          `Prompt length: ${payload.prompt.length} chars`,
          `Memory context length: ${(payload.memoryContext || '').length} chars`,
          `Session: managed by pi (~/.pi)`,
          ``,
          `=== Mounts ===`,
          mounts
            .map((m) => `${m.containerPath}${m.readonly ? ' (ro)' : ''}`)
            .join('\n'),
          ``,
        );
      }

      fs.writeFileSync(logFile, logLines.join('\n'));
      logger.debug({ logFile, verbose: isVerbose }, 'Container log written');

      if (code !== 0) {
        // agent-runner may have written a structured JSON error to stdout even
        // when exiting non-zero. Try to parse it for a more useful message.
        let parsedError: string | null = null;
        try {
          const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
          const endIdx = stdout.indexOf(OUTPUT_END_MARKER);
          if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
            const jsonLine = stdout
              .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
              .trim();
            const output: ContainerOutput = JSON.parse(jsonLine);
            if (output.status === 'error' && output.error) {
              parsedError = output.error;
            }
          }
        } catch {
          /* ignore parse failures */
        }

        logger.error(
          {
            group: group.name,
            code,
            duration,
            stderr,
            stdout,
            logFile,
          },
          'Container exited with error',
        );

        finish({
          status: 'error',
          result: null,
          error:
            parsedError ||
            `Container exited with code ${code}: ${stderr.slice(-200)}`,
        });
        return;
      }

      try {
        // Extract JSON between sentinel markers for robust parsing
        const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
        const endIdx = stdout.indexOf(OUTPUT_END_MARKER);

        let jsonLine: string;
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonLine = stdout
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
        } else {
          // Fallback: last non-empty line (backwards compatibility)
          const lines = stdout.trim().split('\n');
          jsonLine = lines[lines.length - 1];
        }

        const output: ContainerOutput = JSON.parse(jsonLine);

        logger.info(
          {
            group: group.name,
            duration,
            status: output.status,
            hasResult: !!output.result,
          },
          'Container completed',
        );

        finish(output);
      } catch (err) {
        logger.error(
          {
            group: group.name,
            stdout,
            stderr,
            error: err,
          },
          'Failed to parse container output',
        );

        finish({
          status: 'error',
          result: null,
          error: `Failed to parse container output: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    container.on('error', (err) => {
      if (settled) return;
      clearTimeout(timeout);
      logger.error({ group: group.name, error: err }, 'Container spawn error');
      finish({
        status: 'error',
        result: null,
        error: `Container spawn error: ${err.message}`,
      });
    });
  });
}

export function writeTasksSnapshot(
  groupFolder: string,
  isMain: boolean,
  tasks: Array<{
    id: string;
    groupFolder: string;
    prompt: string;
    schedule_type: string;
    schedule_value: string;
    status: string;
    next_run: string | null;
    context_mode?: string;
    session_target?: string | null;
    wake_mode?: string | null;
    delivery_mode?: string | null;
    timeout_seconds?: number | null;
  }>,
): void {
  // Write filtered tasks to the group's IPC directory
  let groupIpcDir: string;
  try {
    groupIpcDir = resolveGroupIpcPath(groupFolder);
  } catch (err) {
    logger.warn(
      { groupFolder, err },
      'Skipping tasks snapshot for invalid group folder',
    );
    return;
  }
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Main sees all tasks, others only see their own
  const filteredTasks = isMain
    ? tasks
    : tasks.filter((t) => t.groupFolder === groupFolder);

  const tasksFile = path.join(groupIpcDir, 'current_tasks.json');
  fs.writeFileSync(tasksFile, JSON.stringify(filteredTasks, null, 2));
}

export interface AvailableGroup {
  jid: string;
  name: string;
  lastActivity: string;
  isRegistered: boolean;
}

/**
 * Write available groups snapshot for the container to read.
 * Only main group can see all available groups (for activation).
 * Non-main groups only see their own registration status.
 */
export function writeGroupsSnapshot(
  groupFolder: string,
  isMain: boolean,
  groups: AvailableGroup[],
  registeredJids: Set<string>,
): void {
  let groupIpcDir: string;
  try {
    groupIpcDir = resolveGroupIpcPath(groupFolder);
  } catch (err) {
    logger.warn(
      { groupFolder, err },
      'Skipping groups snapshot for invalid group folder',
    );
    return;
  }
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Main sees all groups; others see nothing (they can't activate groups)
  const visibleGroups = isMain ? groups : [];

  const groupsFile = path.join(groupIpcDir, 'available_groups.json');
  fs.writeFileSync(
    groupsFile,
    JSON.stringify(
      {
        groups: visibleGroups,
        lastSync: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}
