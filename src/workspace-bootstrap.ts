import fs from 'fs';
import path from 'path';

export const WORKSPACE_TEMPLATE_FILENAMES = [
  'AGENTS.md',
  'SOUL.md',
  'USER.md',
  'IDENTITY.md',
  'PRINCIPLES.md',
  'TOOLS.md',
  'HEARTBEAT.md',
  'BOOTSTRAP.md',
  'MEMORY.md',
] as const;

export type WorkspaceTemplateFileName = (typeof WORKSPACE_TEMPLATE_FILENAMES)[number];

const REQUIRED_BASE_FILES: WorkspaceTemplateFileName[] = [
  'AGENTS.md',
  'SOUL.md',
  'USER.md',
  'IDENTITY.md',
  'PRINCIPLES.md',
  'TOOLS.md',
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
}

const DEFAULT_TEMPLATE_BODIES: Record<WorkspaceTemplateFileName, string> = {
  'AGENTS.md': [
    '# FFT_nano Main Workspace',
    '',
    'Session start order:',
    '1. Read SOUL.md',
    '2. Read USER.md',
    '3. Read IDENTITY.md',
    '4. Read PRINCIPLES.md',
    '5. Read TOOLS.md',
    '6. Read HEARTBEAT.md',
    '7. Read BOOTSTRAP.md (if present)',
    '8. Read MEMORY.md',
    '',
    'Execution stance:',
    '- Use tools to verify claims and perform edits.',
    '- Prefer deterministic, testable changes.',
    '- Keep user-facing updates concise and concrete.',
  ].join('\n'),
  'SOUL.md': ['# SOUL', '', 'You are FarmFriend: concise, practical, and technically rigorous.'].join(
    '\n',
  ),
  'USER.md': ['# USER', '', 'Primary operator: [set during onboarding].'].join('\n'),
  'IDENTITY.md': [
    '# IDENTITY',
    '',
    'Name: FarmFriend',
    'Role: Main orchestrator + coding-capable assistant',
  ].join('\n'),
  'PRINCIPLES.md': [
    '# PRINCIPLES',
    '',
    '- Be truthful about tool usage and edits.',
    '- Prefer deterministic, testable changes.',
    '- Ask clarifying questions before high-impact external actions.',
  ].join('\n'),
  'TOOLS.md': ['# TOOLS', '', 'Local operator notes for tool conventions go here.'].join('\n'),
  'HEARTBEAT.md': [
    '# HEARTBEAT',
    '',
    '# Keep minimal. Add only periodic checks you actually want.',
  ].join('\n'),
  'BOOTSTRAP.md': [
    '# BOOTSTRAP',
    '',
    'On first run, ask onboarding questions to populate USER.md and IDENTITY.md.',
    'After onboarding is complete, either clear this file or mark it complete.',
  ].join('\n'),
  'MEMORY.md': ['# MEMORY', '', 'Durable facts, decisions, and compaction summaries belong here.'].join(
    '\n',
  ),
};

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

  const templates = loadTemplates(params.templateDir);

  for (const fileName of REQUIRED_BASE_FILES) {
    const filePath = path.join(workspaceDir, fileName);
    writeFileIfMissing(filePath, templates[fileName]);
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
    const userPath = path.join(workspaceDir, 'USER.md');
    const identityPath = path.join(workspaceDir, 'IDENTITY.md');
    const userCurrent = (readIfExists(userPath) || '').trimEnd();
    const identityCurrent = (readIfExists(identityPath) || '').trimEnd();
    const userTemplate = templates['USER.md'].trimEnd();
    const identityTemplate = templates['IDENTITY.md'].trimEnd();

    const onboardingAlreadyDone = userCurrent !== userTemplate || identityCurrent !== identityTemplate;
    if (onboardingAlreadyDone) {
      patchState({ onboardingCompletedAt: nowIso() });
    } else {
      writeFileIfMissing(bootstrapPath, templates['BOOTSTRAP.md']);
      bootstrapExists = fs.existsSync(bootstrapPath);
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
