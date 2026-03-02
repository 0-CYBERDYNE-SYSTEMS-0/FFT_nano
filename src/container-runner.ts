/**
 * Container Runner for FFT_nano
 * Spawns agent execution via Docker (preferred) or explicit host runtime
 */
import { createHash } from 'crypto';
import { exec, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  CONTAINER_IMAGE,
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  DATA_DIR,
  FEATURE_FARM,
  FARM_STATE_DIR,
  FARM_STATE_ENABLED,
  FFT_DASHBOARD_REPO_PATH,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
  MAIN_WORKSPACE_DIR,
  MEMORY_RETRIEVAL_GATE_ENABLED,
  PARITY_CONFIG,
  TIMEZONE,
} from './config.js';
import { getContainerRuntime } from './container-runtime.js';
import type { ContainerRuntime } from './container-runtime.js';
import {
  assertValidGroupFolder,
  resolveGroupFolderPath,
  resolveGroupIpcPath,
} from './group-folder.js';
import { logger } from './logger.js';
import { getMemoryBackend } from './memory-backend.js';
import { validateAdditionalMounts } from './mount-security.js';
import { syncProjectPiSkillsToGroupPiHome } from './pi-skills.js';
import { RegisteredGroup } from './types.js';
import { ensureMemoryScaffold } from './memory-paths.js';
import { ensureMainWorkspaceBootstrap } from './workspace-bootstrap.js';

// Sentinel markers for robust output parsing (must match agent-runner)
const OUTPUT_START_MARKER = '---FFT_NANO_OUTPUT_START---';
const OUTPUT_END_MARKER = '---FFT_NANO_OUTPUT_END---';

function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const DOCKER_REUSE_ENABLED = !['0', 'false', 'no'].includes(
  (process.env.FFT_NANO_DOCKER_REUSE || '1').trim().toLowerCase(),
);
const DOCKER_REUSE_MAX_RUNS = envPositiveInt('FFT_NANO_DOCKER_REUSE_MAX_RUNS', 200);
const DOCKER_REUSE_MAX_AGE_MS = envPositiveInt(
  'FFT_NANO_DOCKER_REUSE_MAX_AGE_MS',
  6 * 60 * 60 * 1000,
);
const DOCKER_REUSE_MAX_IDLE_MS = envPositiveInt(
  'FFT_NANO_DOCKER_REUSE_MAX_IDLE_MS',
  20 * 60 * 1000,
);
const PROJECT_RUNTIME_SLUG = createHash('sha1')
  .update(process.cwd())
  .digest('hex')
  .slice(0, 8);

interface DockerContainerState {
  name: string;
  groupFolder: string;
  createdAt: number;
  lastUsedAt: number;
  runs: number;
  mountSignature: string;
}

const dockerContainerStates = new Map<string, DockerContainerState>();

function resolveReusableContainerName(groupFolder: string): string {
  const safe = groupFolder.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 40);
  return `nanoclaw-${PROJECT_RUNTIME_SLUG}-${safe}`;
}

function mountSignature(mounts: VolumeMount[]): string {
  return mounts
    .map((mount) => `${mount.hostPath}->${mount.containerPath}${mount.readonly ? ':ro' : ':rw'}`)
    .sort()
    .join('|');
}

function runDockerCtl(args: string[], timeoutMs = 15_000): {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync('docker', args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
  });
  return {
    ok: (result.status ?? 1) === 0,
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function dockerContainerRunning(name: string): boolean {
  const inspect = runDockerCtl(['inspect', '-f', '{{.State.Running}}', name], 10_000);
  return inspect.ok && inspect.stdout.trim() === 'true';
}

function dockerContainerExists(name: string): boolean {
  const inspect = runDockerCtl(['inspect', name], 10_000);
  return inspect.ok;
}

function dockerStopAndRemove(name: string): void {
  if (!dockerContainerExists(name)) return;
  runDockerCtl(['stop', '-t', '3', name], 10_000);
  runDockerCtl(['rm', '-f', name], 10_000);
}

interface DockerInspectMount {
  Type?: string;
  Source?: string;
  Destination?: string;
  RW?: boolean;
}

interface DockerInspectContainer {
  Mounts?: DockerInspectMount[];
}

function dockerContainerMountSignature(name: string): string | null {
  const inspect = runDockerCtl(['inspect', name], 10_000);
  if (!inspect.ok) return null;
  try {
    const parsed = JSON.parse(inspect.stdout) as DockerInspectContainer[];
    const mounts = Array.isArray(parsed?.[0]?.Mounts) ? parsed[0].Mounts : [];
    return mounts
      .filter((mount) => mount?.Type === 'bind')
      .map((mount) => {
        const source = String(mount.Source || '');
        const destination = String(mount.Destination || '');
        const rw = mount.RW === false ? ':ro' : ':rw';
        return `${source}->${destination}${rw}`;
      })
      .filter((entry) => !entry.startsWith('->'))
      .sort()
      .join('|');
  } catch {
    return null;
  }
}

function createReusableContainer(params: {
  name: string;
  groupFolder: string;
  mounts: VolumeMount[];
}): { ok: boolean; error?: string } {
  const args: string[] = [
    'run',
    '-d',
    '--name',
    params.name,
    '--label',
    'fft.nano.managed=1',
    '--label',
    `fft.nano.group=${params.groupFolder}`,
    '--entrypoint',
    'sh',
  ];

  for (const mount of params.mounts) {
    const roSuffix = mount.readonly ? ':ro' : '';
    args.push('-v', `${mount.hostPath}:${mount.containerPath}${roSuffix}`);
  }

  args.push(CONTAINER_IMAGE, '-lc', 'while true; do sleep 3600; done');
  const run = runDockerCtl(args, 30_000);
  if (!run.ok) {
    return {
      ok: false,
      error: run.stderr.trim() || `docker run failed with code ${run.code ?? 'unknown'}`,
    };
  }
  return { ok: true };
}

function ensureReusableDockerContainer(params: {
  group: RegisteredGroup;
  mounts: VolumeMount[];
}): { ok: boolean; name: string; recycled: boolean; error?: string } {
  const { group, mounts } = params;
  const name = resolveReusableContainerName(group.folder);
  const now = Date.now();
  const signature = mountSignature(mounts);
  const existingState = dockerContainerStates.get(group.folder);

  const shouldRecycleByPolicy =
    !!existingState &&
    (existingState.mountSignature !== signature ||
      existingState.runs >= DOCKER_REUSE_MAX_RUNS ||
      now - existingState.createdAt >= DOCKER_REUSE_MAX_AGE_MS ||
      now - existingState.lastUsedAt >= DOCKER_REUSE_MAX_IDLE_MS);

  let recycled = false;
  if (shouldRecycleByPolicy) {
    dockerStopAndRemove(name);
    dockerContainerStates.delete(group.folder);
    recycled = true;
  }

  // On fresh process startup, in-memory state is empty; validate live mounts directly.
  if (dockerContainerExists(name)) {
    const liveSignature = dockerContainerMountSignature(name);
    if (!liveSignature || liveSignature !== signature) {
      logger.warn(
        { group: group.name, name, expectedSignature: signature, liveSignature },
        'Reusable container mount signature mismatch; recycling container',
      );
      dockerStopAndRemove(name);
      dockerContainerStates.delete(group.folder);
      recycled = true;
    }
  }

  if (dockerContainerRunning(name)) {
    if (existingState) {
      existingState.lastUsedAt = now;
    } else {
      dockerContainerStates.set(group.folder, {
        name,
        groupFolder: group.folder,
        createdAt: now,
        lastUsedAt: now,
        runs: 0,
        mountSignature: signature,
      });
    }
    return { ok: true, name, recycled };
  }

  if (dockerContainerExists(name)) {
    const started = runDockerCtl(['start', name], 15_000);
    if (!started.ok) {
      dockerStopAndRemove(name);
      recycled = true;
    } else {
      dockerContainerStates.set(group.folder, {
        name,
        groupFolder: group.folder,
        createdAt: now,
        lastUsedAt: now,
        runs: existingState?.runs || 0,
        mountSignature: signature,
      });
      return { ok: true, name, recycled };
    }
  }

  const created = createReusableContainer({
    name,
    groupFolder: group.folder,
    mounts,
  });
  if (!created.ok) {
    return { ok: false, name, recycled, error: created.error };
  }

  dockerContainerStates.set(group.folder, {
    name,
    groupFolder: group.folder,
    createdAt: now,
    lastUsedAt: now,
    runs: 0,
    mountSignature: signature,
  });
  return { ok: true, name, recycled };
}

function markReusableContainerRun(groupFolder: string): void {
  const state = dockerContainerStates.get(groupFolder);
  if (!state) return;
  state.runs += 1;
  state.lastUsedAt = Date.now();
}

function tryParseContainerOutput(stdout: string): ContainerOutput | null {
  try {
    const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
    const endIdx = stdout.indexOf(OUTPUT_END_MARKER);

    let jsonLine: string;
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      jsonLine = stdout
        .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
        .trim();
    } else {
      const lines = stdout.trim().split('\n').filter(Boolean);
      if (lines.length === 0) return null;
      jsonLine = lines[lines.length - 1];
    }
    if (!jsonLine) return null;
    const parsed = JSON.parse(jsonLine) as ContainerOutput;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.status !== 'success' && parsed.status !== 'error') return null;
    return parsed;
  } catch {
    return null;
  }
}

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

  // Farm profile state ledger (read-only when enabled)
  if (FEATURE_FARM && FARM_STATE_ENABLED && fs.existsSync(FARM_STATE_DIR)) {
    mounts.push({
      hostPath: FARM_STATE_DIR,
      containerPath: '/workspace/farm-state',
      readonly: true,
    });
  }

  // Dashboard workspace (read-write in main only when farm profile is enabled)
  if (FEATURE_FARM && FARM_STATE_ENABLED && isMain && FFT_DASHBOARD_REPO_PATH) {
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

function collectRuntimeSecrets(params: {
  projectRoot: string;
  runtime: ContainerRuntime;
  hostPaths?: {
    projectDir: string;
    groupDir: string;
    globalDir: string;
    ipcDir: string;
    piHomeDir: string;
  };
}): Record<string, string> {
  const { projectRoot, runtime, hostPaths } = params;
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
    // Prompt bootstrap injection caps (consumed by container system prompt builder)
    'FFT_NANO_PROMPT_FILE_MAX_CHARS',
    'FFT_NANO_PROMPT_TOTAL_MAX_CHARS',
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

  // Keep runtime env stable without mounting env files.
  merged.TZ = TIMEZONE;
  merged.FFT_NANO_PROMPT_FILE_MAX_CHARS = String(PARITY_CONFIG.workspace.bootstrapMaxChars);
  merged.FFT_NANO_PROMPT_TOTAL_MAX_CHARS = String(
    PARITY_CONFIG.workspace.bootstrapTotalMaxChars,
  );

  if (runtime === 'docker') {
    merged.HOME = '/home/node';
    merged.PI_CODING_AGENT_DIR = '/home/node/.pi/agent-openclaw';
  } else if (hostPaths) {
    const hostHome = path.join(
      DATA_DIR,
      'host-home',
      path.basename(path.dirname(hostPaths.piHomeDir)),
    );
    fs.mkdirSync(hostHome, { recursive: true });
    const hostRunnerBin = path.join(
      projectRoot,
      'container',
      'agent-runner',
      'node_modules',
      '.bin',
    );

    merged.HOME = hostHome;
    merged.PATH = `${hostRunnerBin}:${process.env.PATH || ''}`;
    merged.PI_CODING_AGENT_DIR = path.join(hostPaths.piHomeDir, 'agent-openclaw');
    merged.FFT_AGENT_WORKSPACE_ROOT_DIR = projectRoot;
    merged.FFT_AGENT_WORKSPACE_PROJECT_DIR = hostPaths.projectDir;
    merged.FFT_AGENT_WORKSPACE_GROUP_DIR = hostPaths.groupDir;
    merged.FFT_AGENT_WORKSPACE_GLOBAL_DIR = hostPaths.globalDir;
    merged.FFT_AGENT_WORKSPACE_IPC_DIR = hostPaths.ipcDir;
    merged.FFT_AGENT_PI_HOME_DIR = hostPaths.piHomeDir;
    merged.FFT_AGENT_PI_AGENT_DIR = path.join(hostPaths.piHomeDir, 'agent-openclaw');
    merged.FFT_AGENT_CODER_AGENT_DIR = path.join(hostPaths.piHomeDir, 'agent-coder');
    merged.FFT_AGENT_PI_ON_PI_EXTENSION_PATH = path.join(
      projectRoot,
      'container',
      'agent-runner',
      'dist',
      'extensions',
      'pi-on-pi.js',
    );
  }
  return merged;
}

function buildContainerArgs(
  runtime: ContainerRuntime,
  mounts: VolumeMount[],
  containerName: string,
): string[] {
  if (runtime !== 'docker') {
    throw new Error(`buildContainerArgs does not support runtime: ${runtime}`);
  }
  const args: string[] = ['run', '-i', '--rm', '--name', containerName];

  for (const mount of mounts) {
    const roSuffix = mount.readonly ? ':ro' : '';
    args.push('-v', `${mount.hostPath}:${mount.containerPath}${roSuffix}`);
  }

  args.push(CONTAINER_IMAGE);

  return args;
}

function resolveMountedHostPath(
  mounts: VolumeMount[],
  containerPath: string,
  fallback = '',
): string {
  const direct = mounts.find((mount) => mount.containerPath === containerPath);
  if (direct) return direct.hostPath;
  return fallback;
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
      const memory = getMemoryBackend().buildContext({
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
  const ephemeralRuntimeName = `nanoclaw-${safeName}-${Date.now()}`;
  let runtimeName = ephemeralRuntimeName;
  const runtimeCmd =
    runtime === 'docker' ? 'docker' : process.execPath;
  let runtimeArgs: string[] =
    runtime === 'docker'
      ? buildContainerArgs(runtime, mounts, runtimeName)
      : [path.join(projectRoot, 'container', 'agent-runner', 'dist', 'index.js')];

  if (runtime === 'docker' && DOCKER_REUSE_ENABLED) {
    const ensured = ensureReusableDockerContainer({ group, mounts });
    if (!ensured.ok) {
      return {
        status: 'error',
        result: null,
        error: `Failed to prepare reusable container: ${ensured.error || 'unknown error'}`,
      };
    }
    runtimeName = ensured.name;
    runtimeArgs = ['exec', '-i', runtimeName, '/app/entrypoint.sh'];
    if (ensured.recycled) {
      logger.info(
        { group: group.name, runtimeName },
        'Recycled reusable container before run',
      );
    }
  }

  logger.debug(
    {
      group: group.name,
      mounts: mounts.map(
        (m) =>
          `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
      ),
      runtimeArgs: runtimeArgs.join(' '),
      runtimeName,
      runtime,
    },
    'Agent runtime mount configuration',
  );

  logger.info(
    {
      group: group.name,
      runtimeName,
      mountCount: mounts.length,
      isMain: input.isMain,
      runtime,
      reuse: runtime === 'docker' ? DOCKER_REUSE_ENABLED : false,
    },
    'Spawning agent runtime',
  );

  const logsDir = path.join(groupDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  if (runtime === 'host') {
    const hostRunnerPath = runtimeArgs[0];
    if (!hostRunnerPath || !fs.existsSync(hostRunnerPath)) {
      return {
        status: 'error',
        result: null,
        error: `Host runtime runner not found at ${path.join(projectRoot, 'container', 'agent-runner', 'dist', 'index.js')}. Run setup or build container/agent-runner.`,
      };
    }
  }

  const hostProjectDir = resolveMountedHostPath(mounts, '/workspace/project', projectRoot);
  const hostGroupDir = resolveMountedHostPath(mounts, '/workspace/group', groupDir);
  const hostGlobalDir = resolveMountedHostPath(
    mounts,
    '/workspace/global',
    path.join(GROUPS_DIR, 'global'),
  );
  const hostIpcDir = resolveMountedHostPath(
    mounts,
    '/workspace/ipc',
    resolveGroupIpcPath(group.folder),
  );
  const hostPiHomeDir = resolveMountedHostPath(
    mounts,
    '/home/node/.pi',
    path.join(DATA_DIR, 'pi', group.folder, '.pi'),
  );

  const runtimeSecrets = collectRuntimeSecrets({
    projectRoot,
    runtime,
    hostPaths:
      runtime === 'host'
        ? {
            projectDir: hostProjectDir,
            groupDir: hostGroupDir,
            globalDir: hostGlobalDir,
            ipcDir: hostIpcDir,
            piHomeDir: hostPiHomeDir,
          }
        : undefined,
  });

  return new Promise((resolve) => {
    const runtimeProc = spawn(runtimeCmd, runtimeArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: runtime === 'host' ? projectRoot : undefined,
      // Host runner loads workspace paths at process startup; inject now.
      env: runtime === 'host' ? { ...process.env, ...runtimeSecrets } : process.env,
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
      secrets: runtimeSecrets,
    };
    runtimeProc.stdin.write(JSON.stringify(payloadWithSecrets));
    runtimeProc.stdin.end();

    runtimeProc.stdout.on('data', (data) => {
      if (stdoutTruncated) return;
      const chunk = data.toString();
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
      if (chunk.length > remaining) {
        stdout += chunk.slice(0, remaining);
        stdoutTruncated = true;
        logger.warn(
          { group: group.name, size: stdout.length },
          'Runtime stdout truncated due to size limit',
        );
      } else {
        stdout += chunk;
      }
    });

    runtimeProc.stderr.on('data', (data) => {
      const chunk = data.toString();
      const lines = chunk.trim().split('\n');
      for (const line of lines) {
        if (line) logger.debug({ runtimeGroup: group.folder, runtime }, line);
      }
      if (stderrTruncated) return;
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
      if (chunk.length > remaining) {
        stderr += chunk.slice(0, remaining);
        stderrTruncated = true;
        logger.warn(
          { group: group.name, size: stderr.length },
          'Runtime stderr truncated due to size limit',
        );
      } else {
        stderr += chunk;
      }
    });

    const groupTimeout =
      typeof group.containerConfig?.timeout === 'number' &&
      Number.isFinite(group.containerConfig.timeout) &&
      group.containerConfig.timeout > 0
        ? Math.floor(group.containerConfig.timeout)
        : 0;
    // Prevent stale/low per-group settings from undercutting the global baseline.
    const configuredTimeout = Math.max(groupTimeout, CONTAINER_TIMEOUT);
    const timeoutMs = Math.max(configuredTimeout, IDLE_TIMEOUT + 30_000);
    const timeout = setTimeout(() => {
      timedOut = true;
      logger.error(
        { group: group.name, runtimeName, runtime, timeoutMs },
        'Agent runtime timeout, stopping gracefully',
      );
      if (runtime === 'docker') {
        if (DOCKER_REUSE_ENABLED) {
          logger.warn(
            { group: group.name, runtimeName },
            'Run timed out in reusable container; recycling container',
          );
          dockerStopAndRemove(runtimeName);
          dockerContainerStates.delete(group.folder);
          runtimeProc.kill('SIGKILL');
        } else {
          exec(`${runtimeCmd} stop ${runtimeName}`, { timeout: 15000 }, (err) => {
            if (!err) return;
            logger.warn(
              { group: group.name, runtimeName, runtime, err },
              'Graceful runtime stop failed; escalating to SIGKILL',
            );
            runtimeProc.kill('SIGKILL');
          });
        }
      } else {
        runtimeProc.kill('SIGTERM');
        setTimeout(() => {
          if (!exited) runtimeProc.kill('SIGKILL');
        }, 750);
      }
    }, timeoutMs);

    runtimeProc.once('exit', () => {
      exited = true;
      if (abortEscalationTimer) {
        clearTimeout(abortEscalationTimer);
        abortEscalationTimer = null;
      }
    });

    onAbort = () => {
      logger.info({ group: group.name, runtime }, 'Agent runtime run aborted by signal');
      if (!exited) {
        runtimeProc.kill('SIGTERM');
      }
      abortEscalationTimer = setTimeout(() => {
        if (exited) return;
        logger.warn(
          { group: group.name, runtime },
          'Agent runtime did not exit after SIGTERM; escalating to SIGKILL',
        );
        runtimeProc.kill('SIGKILL');
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

    runtimeProc.on('close', (code) => {
      if (settled) return;
      clearTimeout(timeout);
      const duration = Date.now() - startTime;
      if (runtime === 'docker' && DOCKER_REUSE_ENABLED) {
        markReusableContainerRun(group.folder);
      }

      if (timedOut) {
        const parsedAfterTimeout = tryParseContainerOutput(stdout);
        if (parsedAfterTimeout?.status === 'success') {
          logger.info(
            { group: group.name, runtimeName, runtime, duration },
            'Agent runtime timed out after output was emitted; treating as success',
          );
          finish(parsedAfterTimeout);
          return;
        }
        finish({
          status: 'error',
          result: null,
          error: `Agent runtime timed out after ${timeoutMs}ms (configured=${configuredTimeout}ms, idle_guard=${IDLE_TIMEOUT + 30_000}ms)`,
        });
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = path.join(logsDir, `runtime-${timestamp}.log`);
      const isVerbose =
        process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace';

      const logLines = [
        `=== Runtime Run Log ===`,
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
            `=== Runtime Args ===`,
            runtimeArgs.join(' '),
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
        const parsed = tryParseContainerOutput(stdout);
        if (parsed?.status === 'error' && parsed.error) {
          parsedError = parsed.error;
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
          'Agent runtime exited with error',
        );

        finish({
          status: 'error',
          result: null,
          error:
            parsedError ||
            `Agent runtime exited with code ${code}: ${stderr.slice(-200)}`,
        });
        return;
      }

      try {
        const output = tryParseContainerOutput(stdout);
        if (!output) throw new Error('No structured output found');

        logger.info(
          {
            group: group.name,
            duration,
            status: output.status,
            hasResult: !!output.result,
          },
          'Agent runtime completed',
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
          'Failed to parse runtime output',
        );

        finish({
          status: 'error',
          result: null,
          error: `Failed to parse runtime output: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    runtimeProc.on('error', (err) => {
      if (settled) return;
      clearTimeout(timeout);
      logger.error({ group: group.name, runtime, error: err }, 'Agent runtime spawn error');
      finish({
        status: 'error',
        result: null,
        error: `Agent runtime spawn error: ${err.message}`,
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
 * Write available groups snapshot for the agent runtime to read.
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
