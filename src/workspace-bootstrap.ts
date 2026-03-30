import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

import { PARITY_CONFIG } from './config.js';

export const WORKSPACE_TEMPLATE_FILENAMES = [
  'NANO.md',
  'SOUL.md',
  'TODOS.md',
  'HEARTBEAT.md',
  'BOOT.md',
  'BOOTSTRAP.md',
  'MEMORY.md',
] as const;

export type WorkspaceTemplateFileName = (typeof WORKSPACE_TEMPLATE_FILENAMES)[number];

const REQUIRED_BASE_FILES: WorkspaceTemplateFileName[] = [
  'NANO.md',
  'SOUL.md',
  'TODOS.md',
  'HEARTBEAT.md',
  'MEMORY.md',
];

const WORKSPACE_STATE_DIRNAME = '.fft_nano';
const WORKSPACE_STATE_FILENAME = 'workspace-state.json';
const WORKSPACE_STATE_VERSION = 1;

export interface WorkspaceOnboardingState {
  version: number;
  bootstrapSeededAt?: string;
  onboardingCompletedAt?: string;
  bootstrapGateEligibleAt?: string;
  bootExecutedAt?: string;
  bootHash?: string;
}

const DEFAULT_TEMPLATE_BODIES: Record<WorkspaceTemplateFileName, string> = {
  'NANO.md': [
    '# NANO',
    '',
    'Nano Core runtime contract.',
    '',
    'Session context order:',
    '1. Read NANO.md',
    '2. Read SOUL.md',
    '3. Read TODOS.md',
    '4. Read BOOTSTRAP.md (if present)',
    '5. Read MEMORY.md',
    '',
    'Heartbeat and scheduled maintenance runs also read HEARTBEAT.md.',
    '',
    'Memory policy:',
    '- Durable memory belongs in MEMORY.md and memory/*.md.',
    '- Keep SOUL.md stable; do not use it as compaction log storage.',
    '- TODOS.md is mission control for active execution state.',
    '',
    'Execution stance:',
    '- Use tools to verify claims and perform edits.',
    '- Prefer deterministic, testable changes.',
    '- Keep user-facing updates concise and concrete.',
  ].join('\n'),
  'SOUL.md': ['# SOUL', '', 'You are concise, practical, and technically rigorous.'].join('\n'),
  'TODOS.md': [
    '# TODOS.md = MISSION CONTROL: Initial Mission',
    '',
    '## 🚀 ACTIVE OBJECTIVE',
    '> Ship the next validated increment safely.',
    '',
    '## 📋 TASK BOARD',
    '- [ ] Define first active task <!-- id:T1 status:PENDING -->',
    '',
    '## 🤖 SUB-AGENTS & PROCESSES',
    '- [None]',
    '',
    '## ⏳ BLOCKED / WAITING',
    '- [None]',
    '',
    '## 📝 MISSION LOG',
    '- [00:00] - Mission control initialized.',
  ].join('\n'),
  'HEARTBEAT.md': [
    '# HEARTBEAT',
    '',
    '# Keep minimal. Add only periodic checks you actually want.',
  ].join('\n'),
  'BOOT.md': [
    '# BOOT',
    '',
    'Optional startup checklist.',
    '- Keep this short.',
    '- Use only tasks that are safe to run on every gateway restart.',
  ].join('\n'),
  'BOOTSTRAP.md': [
    '# BOOTSTRAP',
    '',
    'You just came online in a fresh workspace.',
    '',
    'First-run ritual:',
    '- Start conversationally: "Hey, I just came online. Who am I? Who are you?"',
    '- Capture operational guidance in NANO.md and durable identity guidance in SOUL.md.',
    '- Initialize mission state in TODOS.md.',
    '- Promote durable facts/decisions into MEMORY.md.',
    '- Keep the flow practical and concise.',
    '- Delete this file after the ritual is complete.',
  ].join('\n'),
  'MEMORY.md': ['# MEMORY', '', 'Durable facts, decisions, and compaction summaries belong here.'].join(
    '\n',
  ),
};

const LEGACY_WORKSPACE_FILES = [
  'AGENTS.md',
  'USER.md',
  'IDENTITY.md',
  'PRINCIPLES.md',
  'TOOLS.md',
] as const;

function stripFrontMatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const endIdx = content.indexOf('\n---', 3);
  if (endIdx === -1) return content;
  return content.slice(endIdx + '\n---'.length).replace(/^\s+/, '');
}

function readIfExists(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function mergeLegacyIntoSoul(params: {
  workspaceDir: string;
  soulPath: string;
  soulTemplate: string;
}): void {
  const soulCurrent = (readIfExists(params.soulPath) || '').trimEnd();
  // Do not merge legacy files into customized SOUL profiles.
  if (soulCurrent && soulCurrent !== params.soulTemplate.trimEnd()) return;
  const sections: string[] = [];
  for (const fileName of LEGACY_WORKSPACE_FILES) {
    const raw = readIfExists(path.join(params.workspaceDir, fileName));
    if (!raw || !raw.trim()) continue;
    sections.push(`## Legacy ${fileName}\n${raw.trim()}`);
  }
  if (sections.length === 0) return;
  if (soulCurrent.includes('## Legacy AGENTS.md')) return;
  const merged = [soulCurrent || '# SOUL', '', ...sections].join('\n\n').trimEnd();
  fs.writeFileSync(params.soulPath, `${merged}\n`, 'utf-8');
}

function migrateLegacyWorkspaceFiles(params: {
  workspaceDir: string;
  templates: Record<WorkspaceTemplateFileName, string>;
}): void {
  const nanoPath = path.join(params.workspaceDir, 'NANO.md');
  const agentsPath = path.join(params.workspaceDir, 'AGENTS.md');
  if (!fs.existsSync(nanoPath) && fs.existsSync(agentsPath)) {
    const legacy = (readIfExists(agentsPath) || '').trim();
    const next = [
      params.templates['NANO.md'].trimEnd(),
      '',
      '## Legacy AGENTS.md Snapshot',
      legacy || '[empty]',
    ].join('\n');
    fs.writeFileSync(nanoPath, `${next}\n`, 'utf-8');
  }

  mergeLegacyIntoSoul({
    workspaceDir: params.workspaceDir,
    soulPath: path.join(params.workspaceDir, 'SOUL.md'),
    soulTemplate: params.templates['SOUL.md'],
  });
}

function resolveWorkspaceTemplateDir(explicitTemplateDir?: string): string | null {
  const envTemplateDir = process.env.FFT_NANO_WORKSPACE_TEMPLATE_DIR?.trim();
  const candidates = [
    explicitTemplateDir?.trim(),
    envTemplateDir,
    path.join(process.cwd(), 'docs', 'reference', 'templates'),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function loadTemplates(explicitTemplateDir?: string): Record<WorkspaceTemplateFileName, string> {
  const templateDir = resolveWorkspaceTemplateDir(explicitTemplateDir);
  const out = { ...DEFAULT_TEMPLATE_BODIES };
  if (!templateDir) return out;

  for (const fileName of WORKSPACE_TEMPLATE_FILENAMES) {
    const templatePath = path.join(templateDir, fileName);
    const raw = readIfExists(templatePath);
    if (!raw) continue;
    out[fileName] = stripFrontMatter(raw).trimEnd();
  }
  return out;
}

function resolveWorkspaceStatePath(workspaceDir: string): string {
  return path.join(workspaceDir, WORKSPACE_STATE_DIRNAME, WORKSPACE_STATE_FILENAME);
}

function readWorkspaceState(workspaceDir: string): WorkspaceOnboardingState {
  const statePath = resolveWorkspaceStatePath(workspaceDir);
  const raw = readIfExists(statePath);
  if (!raw) return { version: WORKSPACE_STATE_VERSION };
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceOnboardingState>;
    return {
      version: WORKSPACE_STATE_VERSION,
      bootstrapSeededAt:
        typeof parsed.bootstrapSeededAt === 'string' ? parsed.bootstrapSeededAt : undefined,
      onboardingCompletedAt:
        typeof parsed.onboardingCompletedAt === 'string'
          ? parsed.onboardingCompletedAt
          : undefined,
      bootstrapGateEligibleAt:
        typeof parsed.bootstrapGateEligibleAt === 'string'
          ? parsed.bootstrapGateEligibleAt
          : undefined,
      bootExecutedAt:
        typeof parsed.bootExecutedAt === 'string'
          ? parsed.bootExecutedAt
          : undefined,
      bootHash:
        typeof parsed.bootHash === 'string'
          ? parsed.bootHash
          : undefined,
    };
  } catch {
    return { version: WORKSPACE_STATE_VERSION };
  }
}

function writeWorkspaceState(workspaceDir: string, state: WorkspaceOnboardingState): void {
  const statePath = resolveWorkspaceStatePath(workspaceDir);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmpPath = `${statePath}.tmp-${process.pid}-${Date.now().toString(36)}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmpPath, statePath);
}

export function readMainWorkspaceState(workspaceDir: string): WorkspaceOnboardingState {
  return readWorkspaceState(workspaceDir);
}

export function writeMainWorkspaceState(
  workspaceDir: string,
  state: WorkspaceOnboardingState,
): void {
  writeWorkspaceState(workspaceDir, state);
}

export interface MainWorkspaceOnboardingStatus {
  state: WorkspaceOnboardingState;
  bootstrapExists: boolean;
  pending: boolean;
  gateEligible: boolean;
}

export function getMainWorkspaceOnboardingStatus(workspaceDir: string): MainWorkspaceOnboardingStatus {
  const state = readWorkspaceState(workspaceDir);
  const bootstrapPath = path.join(workspaceDir, 'BOOTSTRAP.md');
  const bootstrapExists = fs.existsSync(bootstrapPath);
  const pending = bootstrapExists || (!!state.bootstrapSeededAt && !state.onboardingCompletedAt);
  return {
    state,
    bootstrapExists,
    pending,
    gateEligible: !!state.bootstrapGateEligibleAt,
  };
}

export function isMainWorkspaceOnboardingPending(workspaceDir: string): boolean {
  return getMainWorkspaceOnboardingStatus(workspaceDir).pending;
}

export function computeBootFileHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function writeFileIfMissing(filePath: string, body: string): boolean {
  if (fs.existsSync(filePath)) return false;
  fs.writeFileSync(filePath, `${body.trimEnd()}\n`, { encoding: 'utf-8', flag: 'wx' });
  return true;
}

export function ensureMainWorkspaceBootstrap(params: {
  workspaceDir: string;
  templateDir?: string;
  now?: () => Date;
}): WorkspaceOnboardingState {
  const workspaceDir = params.workspaceDir;
  const nowIso = () => (params.now ? params.now() : new Date()).toISOString();
  fs.mkdirSync(workspaceDir, { recursive: true });
  if (PARITY_CONFIG.workspace.skipBootstrap) {
    const state = readWorkspaceState(workspaceDir);
    if (state.version !== WORKSPACE_STATE_VERSION) {
      writeWorkspaceState(workspaceDir, {
        ...state,
        version: WORKSPACE_STATE_VERSION,
      });
      return {
        ...state,
        version: WORKSPACE_STATE_VERSION,
      };
    }
    return state;
  }

  const templates = loadTemplates(params.templateDir);
  migrateLegacyWorkspaceFiles({ workspaceDir, templates });

  for (const fileName of REQUIRED_BASE_FILES) {
    const filePath = path.join(workspaceDir, fileName);
    writeFileIfMissing(filePath, templates[fileName]);
  }
  if (PARITY_CONFIG.workspace.enableBootMd) {
    writeFileIfMissing(path.join(workspaceDir, 'BOOT.md'), templates['BOOT.md']);
  }

  let state = readWorkspaceState(workspaceDir);
  let dirty = false;
  const patchState = (updates: Partial<WorkspaceOnboardingState>) => {
    state = { ...state, ...updates, version: WORKSPACE_STATE_VERSION };
    dirty = true;
  };

  const bootstrapPath = path.join(workspaceDir, 'BOOTSTRAP.md');
  let bootstrapExists = fs.existsSync(bootstrapPath);

  if (!state.bootstrapSeededAt && bootstrapExists) {
    patchState({ bootstrapSeededAt: nowIso() });
  }

  if (!state.onboardingCompletedAt && state.bootstrapSeededAt && !bootstrapExists) {
    patchState({ onboardingCompletedAt: nowIso() });
  }

  if (!state.bootstrapSeededAt && !state.onboardingCompletedAt && !bootstrapExists) {
    const soulPath = path.join(workspaceDir, 'SOUL.md');
    const todosPath = path.join(workspaceDir, 'TODOS.md');
    const soulCurrent = (readIfExists(soulPath) || '').trimEnd();
    const todosCurrent = (readIfExists(todosPath) || '').trimEnd();
    const soulTemplate = templates['SOUL.md'].trimEnd();
    const todosTemplate = templates['TODOS.md'].trimEnd();
    const onboardingAlreadyDone = soulCurrent !== soulTemplate || todosCurrent !== todosTemplate;
    if (onboardingAlreadyDone) {
      patchState({ onboardingCompletedAt: nowIso() });
    } else {
      const createdBootstrap = writeFileIfMissing(bootstrapPath, templates['BOOTSTRAP.md']);
      bootstrapExists = fs.existsSync(bootstrapPath);
      if (createdBootstrap && !state.bootstrapGateEligibleAt) {
        patchState({ bootstrapGateEligibleAt: nowIso() });
      }
      if (bootstrapExists && !state.bootstrapSeededAt) {
        patchState({ bootstrapSeededAt: nowIso() });
      }
    }
  }

  if (dirty) {
    writeWorkspaceState(workspaceDir, state);
  }

  return state;
}

export interface CompleteMainWorkspaceOnboardingParams {
  workspaceDir: string;
  now?: () => Date;
  removeBootstrapFile?: boolean;
}

export function completeMainWorkspaceOnboarding(
  params: CompleteMainWorkspaceOnboardingParams,
): WorkspaceOnboardingState {
  const workspaceDir = params.workspaceDir;
  const nowIso = () => (params.now ? params.now() : new Date()).toISOString();
  fs.mkdirSync(workspaceDir, { recursive: true });

  const bootstrapPath = path.join(workspaceDir, 'BOOTSTRAP.md');
  const state = readWorkspaceState(workspaceDir);
  const next: WorkspaceOnboardingState = { ...state, version: WORKSPACE_STATE_VERSION };
  const bootstrapExists = fs.existsSync(bootstrapPath);

  if (params.removeBootstrapFile !== false && bootstrapExists) {
    try {
      fs.unlinkSync(bootstrapPath);
    } catch {
      /* ignore */
    }
  }

  if (!next.bootstrapSeededAt && bootstrapExists) {
    next.bootstrapSeededAt = nowIso();
  }
  if (!next.onboardingCompletedAt) {
    next.onboardingCompletedAt = nowIso();
  }

  writeWorkspaceState(workspaceDir, next);
  return next;
}

export function markMainWorkspaceBootExecuted(params: {
  workspaceDir: string;
  bootHash: string;
  executedAt?: string;
}): WorkspaceOnboardingState {
  const state = readWorkspaceState(params.workspaceDir);
  const next: WorkspaceOnboardingState = {
    ...state,
    version: WORKSPACE_STATE_VERSION,
    bootExecutedAt: params.executedAt || new Date().toISOString(),
    bootHash: params.bootHash,
  };
  writeWorkspaceState(params.workspaceDir, next);
  return next;
}
