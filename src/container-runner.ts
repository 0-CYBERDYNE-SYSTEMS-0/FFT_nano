/**
 * Container Runner for FFT_nano
 * Spawns agent execution in Apple Container and handles IPC
 */
import { spawn } from 'child_process';
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
} from './config.js';
import { getContainerRuntime, getRuntimeCommand } from './container-runtime.js';
import type { ContainerRuntime } from './container-runtime.js';
import { logger } from './logger.js';
import { buildMemoryContext } from './memory-retrieval.js';
import { validateAdditionalMounts } from './mount-security.js';
import { syncProjectPiSkillsToGroupPiHome } from './pi-skills.js';
import { RegisteredGroup } from './types.js';
import { ensureMemoryScaffold } from './memory-paths.js';

// Sentinel markers for robust output parsing (must match agent-runner)
const OUTPUT_START_MARKER = '---FFT_NANO_OUTPUT_START---';
const OUTPUT_END_MARKER = '---FFT_NANO_OUTPUT_END---';

export interface ContainerInput {
  prompt: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  codingHint?: 'none' | 'auto' | 'force_delegate_execute' | 'force_delegate_plan';
  requestId?: string;
  memoryContext?: string;
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
  fs.mkdirSync(MAIN_WORKSPACE_DIR, { recursive: true });

  const defaults: Array<{ name: string; body: string }> = [
    {
      name: 'AGENTS.md',
      body: [
        '# FFT_nano Main Workspace',
        '',
        'Session start:',
        '1. Read SOUL.md',
        '2. Read USER.md',
        '3. Read IDENTITY.md',
        '4. Read PRINCIPLES.md',
        '5. Read TOOLS.md',
        '6. Read HEARTBEAT.md',
        '',
        'Notes:',
        '- Use coding tools directly when needed.',
        '- Delegate deeper implementation work via coding delegation tools when appropriate.',
      ].join('\n'),
    },
    {
      name: 'SOUL.md',
      body: [
        '# SOUL',
        '',
        'You are FarmFriend: concise, practical, and technically rigorous.',
      ].join('\n'),
    },
    {
      name: 'USER.md',
      body: [
        '# USER',
        '',
        'Primary operator: Scrim Wiggins.',
      ].join('\n'),
    },
    {
      name: 'IDENTITY.md',
      body: [
        '# IDENTITY',
        '',
        'Name: FarmFriend',
        'Role: Main orchestrator + coding-capable assistant',
      ].join('\n'),
    },
    {
      name: 'PRINCIPLES.md',
      body: [
        '# PRINCIPLES',
        '',
        '- Be truthful about tool usage and edits.',
        '- Prefer deterministic, testable changes.',
        '- Ask clarifying questions before high-impact external actions.',
      ].join('\n'),
    },
    {
      name: 'TOOLS.md',
      body: [
        '# TOOLS',
        '',
        'Local operator notes for tool conventions go here.',
      ].join('\n'),
    },
    {
      name: 'HEARTBEAT.md',
      body: [
        '# HEARTBEAT',
        '',
        '# Keep minimal. Add only periodic checks you actually want.',
      ].join('\n'),
    },
    {
      name: 'MEMORY.md',
      body: [
        '# MEMORY',
        '',
        'Durable facts, decisions, and compaction summaries belong here.',
      ].join('\n'),
    },
  ];

  for (const file of defaults) {
    const filePath = path.join(MAIN_WORKSPACE_DIR, file.name);
    if (fs.existsSync(filePath)) continue;
    fs.writeFileSync(filePath, `${file.body}\n`);
  }

  fs.mkdirSync(path.join(MAIN_WORKSPACE_DIR, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(MAIN_WORKSPACE_DIR, 'skills'), { recursive: true });
  ensureMemoryScaffold(MAIN_GROUP_FOLDER);
}

function buildVolumeMounts(
  group: RegisteredGroup,
  isMain: boolean,
): VolumeMount[] {
  const mounts: VolumeMount[] = [];
  const projectRoot = process.cwd();

  if (isMain) {
    ensureMainWorkspaceSeed();

    // Main gets the entire project root mounted
    mounts.push({
      hostPath: projectRoot,
      containerPath: '/workspace/project',
      readonly: false,
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
      hostPath: path.join(GROUPS_DIR, group.folder),
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
      },
      'Synced project Pi skills into group Pi home',
    );
  }
  mounts.push({
    hostPath: groupPiHomeDir,
    containerPath: '/home/node/.pi',
    readonly: false,
  });

  // Per-group IPC namespace: each group gets its own IPC directory
  // This prevents cross-group privilege escalation via IPC
  const groupIpcDir = path.join(DATA_DIR, 'ipc', group.folder);
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

  // Environment file directory (workaround for Apple Container -i env var bug)
  // Only expose specific auth variables needed by the agent runtime, not the entire .env
  const envDir = path.join(DATA_DIR, 'env');
  fs.mkdirSync(envDir, { recursive: true });
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
  ];

  function stripDotEnvQuotes(raw: string): string {
    const v = raw.trim();
    if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
      return v.slice(1, -1);
    }
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
      // Minimal unescape support for common .env patterns.
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

  const fromDotEnv: Record<string, string> = {};
  if (fs.existsSync(envFile)) {
    const envContent = fs.readFileSync(envFile, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!allowedVars.includes(key)) continue;
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

  // Compatibility: older configs may use PI_BASE_URL to mean "OpenAI-compatible base URL".
  // pi (pi-coding-agent) uses provider-specific env vars like OPENAI_BASE_URL.
  if (merged.PI_BASE_URL && !merged.OPENAI_BASE_URL) {
    merged.OPENAI_BASE_URL = merged.PI_BASE_URL;
  }

  const quoteSh = (v: string) => `'${v.replace(/'/g, `'"'"'`)}'`;
  const lines: string[] = [];
  for (const key of allowedVars) {
    const value = merged[key];
    if (typeof value !== 'string' || value.length === 0) continue;
    lines.push(`${key}=${quoteSh(value)}`);
  }

  // pi uses ~/.pi/agent for auth/models. Ensure HOME and the agent dir are
  // consistent inside the container even if the runtime injects a host HOME.
  lines.push(`HOME=${quoteSh('/home/node')}`);
  lines.push(`PI_CODING_AGENT_DIR=${quoteSh('/home/node/.pi/agent')}`);

  fs.writeFileSync(path.join(envDir, 'env'), lines.join('\n') + '\n');
  mounts.push({
    hostPath: envDir,
    containerPath: '/workspace/env-dir',
    readonly: true,
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

function buildContainerArgs(
  runtime: ContainerRuntime,
  mounts: VolumeMount[],
): string[] {
  const args: string[] = ['run', '-i', '--rm'];

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

  const groupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const mounts = buildVolumeMounts(group, input.isMain);
  const runtime = getContainerRuntime();
  const containerArgs = buildContainerArgs(runtime, mounts);
  const runtimeCmd = getRuntimeCommand(runtime);

  logger.debug(
    {
      group: group.name,
      mounts: mounts.map(
        (m) =>
          `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
      ),
      containerArgs: containerArgs.join(' '),
      runtime,
    },
    'Container mount configuration',
  );

  logger.info(
    {
      group: group.name,
      mountCount: mounts.length,
      isMain: input.isMain,
    },
    'Spawning container agent',
  );

  const logsDir = path.join(GROUPS_DIR, group.folder, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  return new Promise((resolve) => {
    const container = spawn(runtimeCmd, containerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let settled = false;
    let onAbort: (() => void) | null = null;
    let exited = false;
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

    container.stdin.write(JSON.stringify(payload));
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
      logger.error({ group: group.name }, 'Container timeout, killing');
      container.kill('SIGKILL');
      finish({
        status: 'error',
        result: null,
        error: `Container timed out after ${CONTAINER_TIMEOUT}ms`,
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

      if (isVerbose) {
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

        if (code !== 0) {
          logLines.push(
            `=== Stderr (last 500 chars) ===`,
            stderr.slice(-500),
            ``,
          );
        }
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
            stderr: stderr.slice(-500),
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
            stdout: stdout.slice(-500),
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
  }>,
): void {
  // Write filtered tasks to the group's IPC directory
  const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
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
  const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
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
