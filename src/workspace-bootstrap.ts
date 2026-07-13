import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

import { MAIN_GROUP_FOLDER, PARITY_CONFIG } from './config.js';
import {
  KERNEL_REQUIRED_WORKSPACE_FILES,
  KERNEL_WORKSPACE_FILES,
} from './kernel-surface.js';
import { ensureKnowledgeWikiScaffold } from './knowledge-wiki.js';
import { ensureDailyMemoryJournal } from './memory-paths.js';

/** @see KERNEL_WORKSPACE_FILES — workspace contract is frozen in kernel-surface. */
export const WORKSPACE_TEMPLATE_FILENAMES = KERNEL_WORKSPACE_FILES;

export type WorkspaceTemplateFileName =
  (typeof WORKSPACE_TEMPLATE_FILENAMES)[number];

const REQUIRED_BASE_FILES: WorkspaceTemplateFileName[] = [
  ...KERNEL_REQUIRED_WORKSPACE_FILES,
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
    '4. Retrieve durable canon from canonical/*.md when needed',
    '5. Read BOOTSTRAP.md (if present)',
    '',
    'Heartbeat and scheduled maintenance runs also read HEARTBEAT.md.',
    '',
    'Memory policy:',
    '- Durable memory belongs in canonical/*.md.',
    '- Daily staging and compaction notes belong in memory/*.md.',
    '- Keep SOUL.md stable; do not use it as compaction log storage.',
    '- TODOS.md is mission control for active execution state.',
    '',
    'Execution stance:',
    '- Use tools to verify claims and perform edits.',
    '- Prefer deterministic, testable changes.',
    '- Keep user-facing updates concise and concrete.',
    '',
    '## Runtime / Attach Surface',
    '',
    '- TUI gateway: `ws://127.0.0.1:28989` (WebSocket) or',
    '  `$PREFIX/var/run/fft-nano/tui.sock` (local socket, set',
    '  `FFT_NANO_TUI_LOCAL=1`).',
    '- Web control center: `http://127.0.0.1:28990`.',
    '- Linux/macOS: systemd / launchd via `./scripts/service.sh`.',
    '- Android/Termux: termux-services daemon. Service file is at',
    '  `$PREFIX/var/service/fft-nano/run`. The run script',
    '  `exec`s `scripts/start.sh start` so the same .env, TUI',
    '  defaults, and runtime selection apply on every platform.',
    '',
    '## Android / Termux Device Primitives',
    '',
    'When the host is running inside Termux on Android, the',
    'following tools are first-class and MUST be used directly when',
    'the user asks for files, photos, audio, video, or device actions:',
    '',
    '- Files: `termux-storage-get`, `termux-storage-write` (the',
    '  official SAF picker), plus direct paths under `/sdcard/`,',
    '  `/storage/emulated/0/`, and the Termux home at',
    '  `/data/data/com.termux/files/home`. The agent has the same',
    '  filesystem authority as the user did when they granted',
    '  Termux:API storage permission via `termux-setup-storage`.',
    '- Camera: `termux-camera-photo` for stills,',
    '  `termux-camera-video` for video, `termux-camera-info` to',
    '  enumerate cameras. Use these for image / video analysis.',
    '- Microphone: `termux-microphone-record` and',
    '  `termux-microphone-list` for transcriptions and audio capture.',
    '- Share / handoff: `termux-share` to hand a file or URL to any',
    '  other Android app the user has installed.',
    '- Clipboard: `termux-clipboard-get` / `termux-clipboard-set`.',
    '- Notifications: `termux-notification` (already wired into the',
    '  platform adapter).',
    '- Activity Manager: `am start -a android.intent.action.VIEW -d <uri>`',
    '  to launch any installed app by intent. `am start -n <pkg>/<activity>`',
    '  for a specific component. `am broadcast -a <action>` to send',
    '  system-wide broadcasts.',
    '- Sensors, location, contacts, SMS, telephony: each has a',
    '  matching `termux-*` CLI. The full set is part of the',
    '  `termux-api` package and the Termux:API companion app.',
    '- Power-user escape hatch: `cmd <service> <args>` for',
    '  Android system services (e.g. `cmd statusbar expand-settings`).',
    '',
    'Trust model:',
    '- The agent is fully authenticated to operate the device on the',
    "  user's behalf inside Termux:API's permission envelope. Do not",
    '  refuse routine file, camera, or microphone operations on this',
    '  platform; they are core primitives.',
    '- For Android intents, prefer the existing app on the device',
    '  over a hand-rolled implementation (e.g. use the system Camera',
    '  via `am` rather than building a custom capture path).',
    '- The agent does NOT need root for these primitives; everything',
    '  above works in an unrooted Termux install with Termux:API',
    '  permissions granted.',
  ].join('\n'),
  'SOUL.md': [
    '# SOUL',
    '',
    'You are concise, practical, and technically rigorous.',
    '',
    '## Capability Awareness (Android / Termux)',
    '',
    'When running on Android/Termux you have complete and total access',
    'to the device file system, camera, microphone, location, sensors,',
    'clipboard, notifications, and the full Android intent surface via',
    'Activity Manager (`am`) and the `termux-*` CLI tools provided by',
    'the Termux:API companion app. You use these directly, not through',
    'a sandbox or wrapper, because they are core primitives. You are',
    "fully authenticated for these operations under the user's",
    'Termux:API permission grant — no root is required.',
  ].join('\n'),
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
    'Main workspace onboarding is pending. This file is the interview script.',
    'Delete it after the ritual completes (the gateway watches for removal).',
    '',
    '## Goal',
    '',
    'Capture enough operator context that the long-term memory layer',
    '(canonical/*.md + MEMORY.md) is populated for the next session,',
    'and that identity/tone/standing-rules are recorded where the runtime',
    'expects them.',
    '',
    '## Order of operations',
    '',
    '1. Open conversationally: "Hey, I just came online. Who am I, who',
    '   are you, and what are the standing rules for this workspace?"',
    '2. Capture identity in IDENTITY.md (your name, role, function).',
    '3. Capture operator profile in USER.md (name, operation, preferences,',
    '   safety notes).',
    '4. Capture persona/tone in SOUL.md. Do not duplicate the identity facts.',
    '5. Capture standing hard rules in canonical/constraints.md. Ask explicitly:',
    '   "What must I never do, no matter what?"',
    '6. Capture active long-lived commitments in canonical/commitments.md.',
    '7. Capture long-lived project context in canonical/projects.md.',
    '8. Capture high-priority durable memory in canonical/_hot.md (only',
    '   things that should be in the system prompt on every turn).',
    '9. Capture operator-curated long-term memory in MEMORY.md (start',
    '   empty, add only what the operator explicitly asks you to remember).',
    "10. Initialize mission state in TODOS.md (active objective + first task).",
    "11. Append today's entry to memory/YYYY-MM-DD.md summarising what you",
    '    learned this session and any decisions made.',
    '',
    '## Cadence',
    '',
    'Ask one concise question at a time. Keep the exchange practical. Do not',
    'silently invent canonical/* content; only write what the operator confirms.',
    'When everything is captured, delete this file and emit the onboarding-',
    'completion token on its own line in the final reply.',
  ].join('\n'),
  'MEMORY.md': [
    '# MEMORY',
    '',
    'Operator-curated long-term memory and compaction summaries for this',
    'workspace. Most durable facts belong in canonical/*.md; this file is',
    'for cross-cutting memory and session compaction summaries.',
    '',
    '## Layer split (do not collapse these into one file)',
    '',
    '- canonical/_hot.md            — always-injected high-priority durable memory',
    '- canonical/identity.md        — stable operator profile facts',
    '- canonical/constraints.md     — standing hard constraints and prohibitions',
    '- canonical/commitments.md     — active long-lived commitments',
    '- canonical/projects.md        — long-lived project context',
    '- memory/YYYY-MM-DD.md         — daily journal (auto-created, append-only)',
    '- MEMORY.md (this file)        — curated long-term memory + compaction summaries',
    '',
    '## Compaction summaries',
    '',
  ].join('\n'),
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
  const merged = [soulCurrent || '# SOUL', '', ...sections]
    .join('\n\n')
    .trimEnd();
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

function resolveWorkspaceTemplateDir(
  explicitTemplateDir?: string,
): string | null {
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

function loadTemplates(
  explicitTemplateDir?: string,
): Record<WorkspaceTemplateFileName, string> {
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
  return path.join(
    workspaceDir,
    WORKSPACE_STATE_DIRNAME,
    WORKSPACE_STATE_FILENAME,
  );
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
        typeof parsed.bootstrapSeededAt === 'string'
          ? parsed.bootstrapSeededAt
          : undefined,
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
        typeof parsed.bootHash === 'string' ? parsed.bootHash : undefined,
    };
  } catch {
    return { version: WORKSPACE_STATE_VERSION };
  }
}

function writeWorkspaceState(
  workspaceDir: string,
  state: WorkspaceOnboardingState,
): void {
  const statePath = resolveWorkspaceStatePath(workspaceDir);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmpPath = `${statePath}.tmp-${process.pid}-${Date.now().toString(36)}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmpPath, statePath);
}

export function readMainWorkspaceState(
  workspaceDir: string,
): WorkspaceOnboardingState {
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

export function getMainWorkspaceOnboardingStatus(
  workspaceDir: string,
): MainWorkspaceOnboardingStatus {
  const state = readWorkspaceState(workspaceDir);
  const bootstrapPath = path.join(workspaceDir, 'BOOTSTRAP.md');
  const bootstrapExists = fs.existsSync(bootstrapPath);
  const pending =
    bootstrapExists ||
    (!!state.bootstrapSeededAt && !state.onboardingCompletedAt);
  return {
    state,
    bootstrapExists,
    pending,
    gateEligible: !!state.bootstrapGateEligibleAt,
  };
}

export function isMainWorkspaceOnboardingPending(
  workspaceDir: string,
): boolean {
  return getMainWorkspaceOnboardingStatus(workspaceDir).pending;
}

export function computeBootFileHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function writeFileIfMissing(filePath: string, body: string): boolean {
  if (fs.existsSync(filePath)) return false;
  fs.writeFileSync(filePath, `${body.trimEnd()}\n`, {
    encoding: 'utf-8',
    flag: 'wx',
  });
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
  const canonicalDir = path.join(workspaceDir, 'canonical');
  fs.mkdirSync(canonicalDir, { recursive: true });
  writeFileIfMissing(
    path.join(canonicalDir, '_hot.md'),
    '# _hot\n\nHigh-priority durable memory retrieved before all other canon.',
  );
  writeFileIfMissing(
    path.join(canonicalDir, 'identity.md'),
    '# identity\n\nStable user preferences and profile facts.',
  );
  writeFileIfMissing(
    path.join(canonicalDir, 'constraints.md'),
    '# constraints\n\nStanding hard constraints and prohibitions.',
  );
  writeFileIfMissing(
    path.join(canonicalDir, 'commitments.md'),
    '# commitments\n\nActive long-lived commitments and obligations.',
  );
  writeFileIfMissing(
    path.join(canonicalDir, 'projects.md'),
    '# projects\n\nLong-lived project context and architecture notes.',
  );
  ensureDailyMemoryJournal(MAIN_GROUP_FOLDER, { workspaceDir, now: params.now });

  if (PARITY_CONFIG.workspace.enableBootMd) {
    writeFileIfMissing(
      path.join(workspaceDir, 'BOOT.md'),
      templates['BOOT.md'],
    );
  }
  ensureKnowledgeWikiScaffold({ workspaceDir });

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

  if (
    !state.onboardingCompletedAt &&
    state.bootstrapSeededAt &&
    !bootstrapExists
  ) {
    patchState({ onboardingCompletedAt: nowIso() });
  }

  if (
    !state.bootstrapSeededAt &&
    !state.onboardingCompletedAt &&
    !bootstrapExists
  ) {
    const soulPath = path.join(workspaceDir, 'SOUL.md');
    const todosPath = path.join(workspaceDir, 'TODOS.md');
    const soulCurrent = (readIfExists(soulPath) || '').trimEnd();
    const todosCurrent = (readIfExists(todosPath) || '').trimEnd();
    const soulTemplate = templates['SOUL.md'].trimEnd();
    const todosTemplate = templates['TODOS.md'].trimEnd();
    const onboardingAlreadyDone =
      soulCurrent !== soulTemplate || todosCurrent !== todosTemplate;
    if (onboardingAlreadyDone) {
      patchState({ onboardingCompletedAt: nowIso() });
    } else {
      const createdBootstrap = writeFileIfMissing(
        bootstrapPath,
        templates['BOOTSTRAP.md'],
      );
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
  const next: WorkspaceOnboardingState = {
    ...state,
    version: WORKSPACE_STATE_VERSION,
  };
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
