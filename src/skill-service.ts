import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

import {
  ASSISTANT_NAME,
  MAIN_GROUP_FOLDER,
  MAIN_WORKSPACE_DIR,
  PARITY_CONFIG,
} from './config.js';
import { runContainerAgent } from './pi-runner.js';
import {
  applySkillManagerTransitions,
  executeSkillAction,
  formatSkillManagerStatus,
  loadSkillManagerState,
  resolveGroupSkillsDir,
  saveSkillManagerState,
  setSkillManagerPaused,
  shouldRunSkillManager,
  snapshotSkills,
  writeSkillManagerReport,
  type SkillManagerConfig,
} from './skill-lifecycle.js';
import { getSkillEfficacy, type SkillEfficacy } from './db.js';
import { resolveGroupIpcPath } from './group-folder.js';
import {
  captureKnowledgeRawNote,
  formatKnowledgeWikiStatusText,
  runKnowledgeWikiLint,
} from './knowledge-wiki.js';
import { ensureKnowledgeNightlyTask } from './knowledge-wiki-task.js';
import {
  state,
  activeCoderRuns,
  type ActiveCoderRun,
  type ChatRunPreferences,
} from './app-state.js';
import { logger } from './logger.js';
import type { RegisteredGroup } from './types.js';
import type { PiToolExecution } from './pi-json-parser.js';
import {
  extractLearningSignals,
  recordSelfImproveEvent,
  type SelfImprovePriority,
} from './self-improve-signals.js';
import { ensureKnowledgeRuntimeSetup } from './telegram-group-mgmt.js';

// ---------------------------------------------------------------------------
// Skill manager config
// ---------------------------------------------------------------------------

export function toSkillManagerConfig(): SkillManagerConfig {
  return {
    enabled: PARITY_CONFIG.skills.curator.enabled,
    intervalHours: PARITY_CONFIG.skills.curator.intervalHours,
    minIdleHours: PARITY_CONFIG.skills.curator.minIdleHours,
    staleAfterDays: PARITY_CONFIG.skills.curator.staleAfterDays,
    archiveAfterDays: PARITY_CONFIG.skills.curator.archiveAfterDays,
    backupEnabled: PARITY_CONFIG.skills.curator.backup.enabled,
    backupKeep: PARITY_CONFIG.skills.curator.backup.keep,
  };
}

// ---------------------------------------------------------------------------
// Skill self-improve state
// ---------------------------------------------------------------------------

export function skillSelfImproveStatePath(groupFolder: string): string {
  return path.join(
    resolveGroupSkillsDir(groupFolder),
    '.self_improve_state.json',
  );
}

interface SkillSelfImproveState {
  turnsSinceReview: number;
  toolsSinceReview: number;
  lastReviewAt: string | null;
}

export function readSkillSelfImproveState(
  groupFolder: string,
): SkillSelfImproveState {
  try {
    const filePath = skillSelfImproveStatePath(groupFolder);
    if (!fs.existsSync(filePath)) {
      return { turnsSinceReview: 0, toolsSinceReview: 0, lastReviewAt: null };
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return {
      turnsSinceReview: Number(parsed.turnsSinceReview) || 0,
      toolsSinceReview: Number(parsed.toolsSinceReview) || 0,
      lastReviewAt:
        typeof parsed.lastReviewAt === 'string' ? parsed.lastReviewAt : null,
    };
  } catch {
    return { turnsSinceReview: 0, toolsSinceReview: 0, lastReviewAt: null };
  }
}

export function writeSkillSelfImproveState(
  groupFolder: string,
  next: SkillSelfImproveState,
): void {
  const filePath = skillSelfImproveStatePath(groupFolder);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`);
}

export interface SkillSelfImproveDecision {
  due: boolean;
  triggerReason: string;
}

export function shouldTriggerSkillSelfImprove(params: {
  groupFolder: string;
  toolsInvoked: number;
  priority?: SelfImprovePriority;
  now?: number;
}): SkillSelfImproveDecision {
  if (!PARITY_CONFIG.skills.selfImprove.enabled) {
    return { due: false, triggerReason: 'disabled' };
  }
  // WS6.3: Global pause short-circuits before any other check. VAL-WS6-017
  if (state.learningPaused) {
    return { due: false, triggerReason: 'learning-paused' };
  }
  const now = params.now ?? Date.now();
  const current = readSkillSelfImproveState(params.groupFolder);
  const next: SkillSelfImproveState = {
    turnsSinceReview: current.turnsSinceReview + 1,
    toolsSinceReview: current.toolsSinceReview + params.toolsInvoked,
    lastReviewAt: current.lastReviewAt,
  };

  const intervalDue =
    next.turnsSinceReview >= PARITY_CONFIG.skills.selfImprove.turnInterval ||
    next.toolsSinceReview >= PARITY_CONFIG.skills.selfImprove.toolInterval;
  const signalDue = params.priority === 'full';

  if (!intervalDue && !signalDue) {
    writeSkillSelfImproveState(params.groupFolder, next);
    return { due: false, triggerReason: 'interval-not-reached' };
  }

  // Cost guard: never fire the quiet agent more than once per min-interval
  // window, regardless of signals. Keeps a correction-heavy conversation from
  // spawning a pi subprocess on every message. Counters are preserved (not
  // reset) so the review still fires on the next eligible turn after the window.
  const minIntervalMs =
    PARITY_CONFIG.skills.selfImprove.minIntervalMinutes * 60_000;
  const lastMs = current.lastReviewAt ? Date.parse(current.lastReviewAt) : NaN;
  if (
    minIntervalMs > 0 &&
    Number.isFinite(lastMs) &&
    now - lastMs < minIntervalMs
  ) {
    writeSkillSelfImproveState(params.groupFolder, next);
    return {
      due: false,
      triggerReason: signalDue ? 'signal-debounced' : 'interval-debounced',
    };
  }

  writeSkillSelfImproveState(params.groupFolder, {
    turnsSinceReview: 0,
    toolsSinceReview: 0,
    lastReviewAt: new Date(now).toISOString(),
  });
  return { due: true, triggerReason: signalDue ? 'signal' : 'interval' };
}

// ---------------------------------------------------------------------------
// Quiet skill agent
// ---------------------------------------------------------------------------

export function runQuietSkillAgent(params: {
  group: RegisteredGroup;
  chatJid: string;
  prompt: string;
  requestId: string;
  runtimePrefs: ChatRunPreferences;
}): void {
  const isMain = params.group.folder === MAIN_GROUP_FOLDER;
  const extraSystemPrompt = [
    '## Quiet Background Skill Maintenance',
    'This run is internal maintenance. Do not send chat messages unless explicitly asked.',
    'Use skill_action IPC for all skill reads and writes.',
    'Do not inspect or edit skill files directly. Use action_results as the durable source of truth.',
    'Keep skills organized for non-technical farm operators: clear names, valid frontmatter, class-level reusable workflows, and lean active catalog.',
    'You may only mutate host-allowed agent-created runtime skills. For source-owned skills, report issues instead of trying to modify them.',
  ].join('\n');
  const maintenanceChatJid = `maintenance:${params.group.folder}`;
  const maintenanceIpcDir = resolveGroupIpcPath(params.group.folder);

  void runContainerAgent(
    params.group,
    {
      prompt: params.prompt,
      groupFolder: params.group.folder,
      chatJid: maintenanceChatJid,
      isMain,
      assistantName: ASSISTANT_NAME,
      codingHint: 'none',
      requestId: params.requestId,
      isScheduledTask: false,
      isEvaluatorRun: true,
      extraSystemPrompt,
      provider: params.runtimePrefs.provider,
      model: params.runtimePrefs.model,
      thinkLevel: params.runtimePrefs.thinkLevel,
      reasoningLevel: params.runtimePrefs.reasoningLevel,
      toolMode: 'full',
      noContinue: true,
      suppressPreviewStreaming: true,
      sandboxAllowedPathsOverride: [maintenanceIpcDir],
      lifecyclePolicyOverride: {
        hardTimeoutMs: 10 * 60 * 1000,
        staleAfterMs: 3 * 60 * 1000,
        toolActiveStaleMs: 2 * 60 * 1000,
        waitStateStaleMs: 2 * 60 * 1000,
        allowFreshSessionFallback: false,
      },
    },
    undefined,
  ).catch((err) => {
    logger.warn(
      { err, groupFolder: params.group.folder, requestId: params.requestId },
      'Quiet skill maintenance run failed',
    );
  });
}

// ---------------------------------------------------------------------------
// Skill self-improvement
// ---------------------------------------------------------------------------

export function maybeRunSkillSelfImprovement(params: {
  group: RegisteredGroup;
  chatJid: string;
  originalTask: string;
  agentOutput: string;
  toolsInvoked: number;
  toolExecutions?: PiToolExecution[];
  runtimePrefs: ChatRunPreferences;
  requestId?: string;
  senderRole?: 'operator' | 'member' | 'unknown';
}): void {
  const runId = params.requestId || 'run';
  const senderRole = params.senderRole ?? 'unknown';
  const { signals, priority } = extractLearningSignals({
    userTask: params.originalTask,
    agentOutput: params.agentOutput,
    toolExecutions: params.toolExecutions,
    senderRole,
  });

  const decision = shouldTriggerSkillSelfImprove({
    groupFolder: params.group.folder,
    toolsInvoked: params.toolsInvoked,
    priority,
  });

  const triggerReason =
    decision.triggerReason === 'signal' && signals.length > 0
      ? `signal:${signals.join(',')}`
      : decision.triggerReason;

  // WS6.3: global pause short-circuits the self-improve trigger. VAL-WS6-017,
  // VAL-XARE-014. shouldTriggerSkillSelfImprove returns
  // { due: false, triggerReason: 'learning-paused' } when paused.
  if (decision.triggerReason === 'learning-paused') {
    recordSelfImproveEvent(params.group.folder, {
      run_id: runId,
      authorityId: runId,
      sender_role: senderRole,
      review_type: 'skill-self-improve',
      trigger_reason: triggerReason,
      signals_detected: signals,
      review_fired: false,
      noop_reason: 'learning-paused',
      success: true,
    });
    return;
  }

  if (!decision.due) {
    // WS3.5: detect downgrade — signals were found but priority was capped at
    // 'light' because the sender is not the operator. Record the downgrade reason
    // so the JSONL event is observable without requiring DB state.
    const wasDowngraded =
      signals.length > 0 && priority === 'light' && senderRole !== 'operator';
    recordSelfImproveEvent(params.group.folder, {
      run_id: runId,
      authorityId: runId, // INV.1: stamped for forensic traceability (VAL-XARE-009)
      sender_role: senderRole,
      review_type: 'skill-self-improve',
      trigger_reason: triggerReason,
      signals_detected: signals,
      review_fired: false,
      noop_reason: wasDowngraded
        ? 'non-operator-signal-downgraded'
        : decision.triggerReason.includes('debounced')
          ? 'min-interval debounce'
          : 'cadence threshold not reached',
      success: true,
    });
    return;
  }

  recordSelfImproveEvent(params.group.folder, {
    run_id: runId,
    authorityId: runId, // INV.1: stamped for forensic traceability (VAL-XARE-009)
    sender_role: senderRole,
    review_type: 'skill-self-improve',
    trigger_reason: triggerReason,
    signals_detected: signals,
    review_fired: true,
    success: true,
  });

  const signalLine =
    signals.length > 0
      ? `Host-detected learning signals for this run: ${signals.join(', ')}. Weigh these when deciding what is durable.`
      : 'No strong learning signals were detected; no-op unless you find genuinely reusable knowledge.';

  runQuietSkillAgent({
    group: params.group,
    chatJid: params.chatJid,
    runtimePrefs: params.runtimePrefs,
    requestId: `${runId}:skill-self-improve`,
    prompt: [
      'Review the completed conversation for reusable procedural knowledge.',
      signalLine,
      'Use skill_list first. Prefer patching an existing relevant agent-created skill over creating a near-duplicate. Create broad class-level skills with labeled sections, not narrow one-offs.',
      'Capture: reusable workflows, command/tool/API pitfalls with a reusable recovery, farm/device operating procedures, troubleshooting recipes, and user corrections that change how future work should be done.',
      'Do NOT create or patch skills for: one-off task narratives, raw transcripts, transient/environment outages without a reusable recovery, speculation, or anything whose only content is "remember that this happened".',
      'Never mutate source-owned project or personal skills — report those gaps in your summary instead. Keep frontmatter valid and descriptions practical. No-op when the lesson is not durable.',
      '',
      'Original task:',
      params.originalTask.slice(0, 3000),
      '',
      'Agent result:',
      params.agentOutput.slice(0, 5000),
    ].join('\n'),
  });
}

// ---------------------------------------------------------------------------
// Skill manager auto-run
// ---------------------------------------------------------------------------

/**
 * Read the provenance field from a skill's SKILL.md frontmatter.
 * Returns 'agent-inferred' as the conservative default when the field is absent
 * (e.g. legacy skills created before WS3.3).
 */
function readSkillProvenance(skillsDir: string, skillName: string): string {
  const skillPath = path.join(skillsDir, skillName, 'SKILL.md');
  if (!fs.existsSync(skillPath)) return 'agent-inferred';
  try {
    const content = fs.readFileSync(skillPath, 'utf-8');
    const normalized = content.replace(/\r\n/g, '\n');
    if (!normalized.startsWith('---\n')) return 'agent-inferred';
    const end = normalized.indexOf('\n---\n', 4);
    if (end === -1) return 'agent-inferred';
    const raw = normalized.slice(4, end);
    const parsed = YAML.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const frontmatter = parsed as Record<string, unknown>;
      if (typeof frontmatter.provenance === 'string') {
        return frontmatter.provenance;
      }
    }
  } catch {
    // Fall through to default
  }
  return 'agent-inferred';
}

/**
 * Build efficacy prompt lines for skills with efficacy data above the sample floor,
 * filtered to only include skills with provenance === 'agent-inferred'.
 *
 * Returns an array of prompt lines that are inserted before the
 * "Do not mutate source-owned project or personal skills." line.
 *
 * The function is read-only — it only reads DB efficacy data and skill frontmatter.
 */
export function buildSkillEfficacyPromptLines(
  groupFolder: string,
  skillsDir: string,
): string[] {
  const efficacyMap = getSkillEfficacy(groupFolder);
  if (efficacyMap.size === 0) {
    return ['Do not mutate source-owned project or personal skills.'];
  }

  const efficacyLines: string[] = [];
  for (const [skillName, efficacy] of efficacyMap) {
    const provenance = readSkillProvenance(skillsDir, skillName);
    if (provenance !== 'agent-inferred') continue;

    const passRatePct = (efficacy.passRateWith * 100).toFixed(2);
    const baselinePct = (efficacy.groupBaseline * 100).toFixed(2);
    efficacyLines.push(
      `${skillName}: injected ${efficacy.runsWith} times, pass rate with ${passRatePct}% vs baseline ${baselinePct}%`,
    );
  }

  // Sort for deterministic output
  efficacyLines.sort();

  efficacyLines.push('Do not mutate source-owned project or personal skills.');
  return efficacyLines;
}

export function maybeRunSkillManager(params: {
  group: RegisteredGroup;
  chatJid: string;
  runtimePrefs: ChatRunPreferences;
  requestId?: string;
}): void {
  const skillsDir = resolveGroupSkillsDir(params.group.folder);
  const config = toSkillManagerConfig();
  if (
    !shouldRunSkillManager(skillsDir, config, new Date(), state.lastInboundAt)
  )
    return;

  const started = Date.now();
  if (config.backupEnabled) {
    snapshotSkills({
      skillsDir,
      reason: 'automatic skill-manager run',
      keep: config.backupKeep,
    });
  }
  const transitions = applySkillManagerTransitions({ skillsDir, config });
  const summary = `automatic skill-manager run: checked=${transitions.checked} stale=${transitions.markedStale} archived=${transitions.archived} reactivated=${transitions.reactivated}`;
  const reportPath = writeSkillManagerReport({
    groupFolder: params.group.folder,
    skillsDir,
    dryRun: false,
    summary,
    transitions,
  });
  const smState = loadSkillManagerState(skillsDir);
  smState.lastRunAt = new Date().toISOString();
  smState.lastRunDurationSeconds = Math.round((Date.now() - started) / 1000);
  smState.lastRunSummary = summary;
  smState.lastReportPath = reportPath;
  smState.runCount += 1;
  saveSkillManagerState(skillsDir, smState);

  // WS5.4: build efficacy prompt lines for agent-inferred skills above the sample floor
  const efficacyLines = buildSkillEfficacyPromptLines(
    params.group.folder,
    skillsDir,
  );

  runQuietSkillAgent({
    group: params.group,
    chatJid: params.chatJid,
    runtimePrefs: params.runtimePrefs,
    requestId: `${params.requestId || 'run'}:skill-manager`,
    prompt: [
      'Run a bounded skill manager review.',
      'Use skill_status and skill_view to inspect the active library.',
      'Goal: keep farm/operator skills lean, organized, and valid. Clean frontmatter issues for agent-created skills by patching them. Report source-owned frontmatter issues in your final summary.',
      'Consolidate near-duplicate agent-created skills into class-level umbrella skills when useful. Archive only agent-created skills that are stale, duplicate, or fully absorbed.',
      ...efficacyLines, // WS5.4: efficacy lines (agent-inferred only, above sample floor) appear before the "Do not mutate" line
    ].join('\n'),
  });
}

// ---------------------------------------------------------------------------
// handleSkillManagerCommand
// ---------------------------------------------------------------------------

export async function handleSkillManagerCommand(params: {
  action: string;
  input: string;
  chatJid: string;
}): Promise<string> {
  const groupFolder = MAIN_GROUP_FOLDER;
  const skillsDir = resolveGroupSkillsDir(groupFolder);
  const action = params.action || 'status';
  if (action === 'status') {
    return formatSkillManagerStatus(groupFolder);
  }
  if (action === 'pause' || action === 'resume') {
    setSkillManagerPaused(groupFolder, action === 'pause');
    return `skill-manager: ${action === 'pause' ? 'paused' : 'resumed'}`;
  }
  if (action === 'run' || action === 'dry-run') {
    const config = toSkillManagerConfig();
    const dryRun = action === 'dry-run';
    if (!dryRun && config.backupEnabled) {
      snapshotSkills({
        skillsDir,
        reason: 'telegram skill-manager run',
        keep: config.backupKeep,
      });
    }
    const transitions = applySkillManagerTransitions({
      skillsDir,
      config,
      dryRun,
    });
    const summary = `${dryRun ? 'dry-run' : 'telegram'} skill-manager run: checked=${transitions.checked} stale=${transitions.markedStale} archived=${transitions.archived} reactivated=${transitions.reactivated}`;
    const reportPath = writeSkillManagerReport({
      groupFolder,
      skillsDir,
      dryRun,
      summary,
      transitions,
    });
    if (!dryRun) {
      const skillManagerState = loadSkillManagerState(skillsDir);
      skillManagerState.lastRunAt = new Date().toISOString();
      skillManagerState.lastRunSummary = summary;
      skillManagerState.lastReportPath = reportPath;
      skillManagerState.runCount += 1;
      saveSkillManagerState(skillsDir, skillManagerState);
    }
    return `${summary}\nreport: ${reportPath}`;
  }
  if (action === 'backup') {
    const snap = snapshotSkills({
      skillsDir,
      reason: 'telegram backup',
      keep: PARITY_CONFIG.skills.curator.backup.keep,
    });
    return snap
      ? `skill-manager: backup created at ${snap}`
      : 'skill-manager: no skills directory to back up';
  }
  const skillName = params.input.trim().split(/\s+/)[0];
  if (!skillName) {
    return 'Usage: /skill-manager status|dry-run|run|pause|resume|pin <skill>|unpin <skill>|archive <skill>|restore <skill>|backup';
  }
  const actionMap: Record<
    string,
    'skill_pin' | 'skill_unpin' | 'skill_archive' | 'skill_restore'
  > = {
    pin: 'skill_pin',
    unpin: 'skill_unpin',
    archive: 'skill_archive',
    restore: 'skill_restore',
  };
  const skillAction = actionMap[action];
  if (!skillAction) {
    return 'Usage: /skill-manager status|dry-run|run|pause|resume|pin <skill>|unpin <skill>|archive <skill>|restore <skill>|backup';
  }
  const result = await executeSkillAction(
    {
      type: 'skill_action',
      action: skillAction,
      requestId: `skill-manager-telegram-${Date.now()}`,
      params: { name: skillName, groupFolder },
    },
    {
      sourceGroup: groupFolder,
      isMain: true,
      registeredGroups: state.registeredGroups,
    },
  );
  if (result.status === 'error') return `skill-manager: ${result.error}`;
  return `skill-manager: ${action} ${skillName}`;
}

// ---------------------------------------------------------------------------
// handleLibrarianCommand — deps injected to avoid circular import
// ---------------------------------------------------------------------------

export interface LibrarianDeps {
  resolveKnowledgeRuntimeSnapshot: () => {
    status: ReturnType<
      typeof import('./knowledge-wiki.js').readKnowledgeWikiStatus
    >;
    nightlyTaskStatus: string;
    nightlyTaskNextRun: string | null;
  };
  handleKnowledgeCommand: (params: {
    action: string;
    input: string;
    chatJid: string;
  }) => string;
}

export function handleLibrarianCommand(
  params: {
    action: string;
    input: string;
    chatJid: string;
  },
  deps: LibrarianDeps,
): string {
  const { resolveKnowledgeRuntimeSnapshot, handleKnowledgeCommand } = deps;
  const action = params.action.trim().toLowerCase();
  if (!action || action === 'status') {
    const snapshot = resolveKnowledgeRuntimeSnapshot();
    return formatKnowledgeWikiStatusText({
      status: snapshot.status,
      nightlyTaskStatus: snapshot.nightlyTaskStatus,
      nightlyTaskNextRun: snapshot.nightlyTaskNextRun,
    });
  }

  if (action === 'help') {
    return [
      'Usage: /librarian <status|init|task|lint|capture|run|dry-run|log|progress|help>',
      '',
      '- /librarian status       — show wiki status and nightly task info',
      '- /librarian init         — create wiki scaffold',
      '- /librarian task         — ensure nightly task is registered',
      '- /librarian lint         — run wiki lint and show report',
      '- /librarian capture <n>  — capture a raw note',
      '- /librarian run          — trigger manual wiki refinement (librarian review)',
      '- /librarian dry-run      — preview wiki refinement without changes',
      '- /librarian log          — show recent wiki activity log',
      '- /librarian progress     — show progress entries',
    ].join('\n');
  }

  if (action === 'init') {
    const setup = ensureKnowledgeRuntimeSetup(params.chatJid);
    const snapshot = resolveKnowledgeRuntimeSnapshot();
    const lines = [
      'Knowledge wiki initialized.',
      `- created_paths: ${setup.createdPaths.length}`,
      `- nightly_task: ${setup.nightlyTask.status}`,
      `- nightly_next_run: ${setup.nightlyTask.nextRun || 'n/a'}`,
    ];
    if (setup.createdPaths.length > 0) {
      lines.push(
        '',
        'Created paths:',
        ...setup.createdPaths.map((entry) => `- ${entry}`),
      );
    }
    if (setup.nightlyTask.skippedReason) {
      lines.push('', `Task setup skipped: ${setup.nightlyTask.skippedReason}`);
    }
    lines.push(
      '',
      formatKnowledgeWikiStatusText({
        status: snapshot.status,
        nightlyTaskStatus: snapshot.nightlyTaskStatus,
        nightlyTaskNextRun: snapshot.nightlyTaskNextRun,
      }),
    );
    return lines.join('\n');
  }

  if (action === 'task') {
    const result = ensureKnowledgeNightlyTask({ mainChatJid: params.chatJid });
    if (!result.ensured) {
      return `Knowledge nightly task not created: ${result.skippedReason || 'unknown reason'}`;
    }
    return [
      `Knowledge nightly task ${result.created ? 'created' : 'already present'}.`,
      `- task_id: ${result.taskId}`,
      `- status: ${result.status}`,
      `- schedule: ${result.schedule}`,
      `- next_run: ${result.nextRun || 'n/a'}`,
    ].join('\n');
  }

  if (action === 'lint') {
    const report = runKnowledgeWikiLint({ workspaceDir: MAIN_WORKSPACE_DIR });
    return [
      `Knowledge lint ${report.ok ? 'passed' : 'failed'}.`,
      `- report: ${report.reportRelativePath}`,
      `- errors: ${report.errors.length}`,
      `- warnings: ${report.warnings.length}`,
      '',
      report.text,
    ].join('\n');
  }

  if (action === 'ingest' || action === 'capture') {
    if (!params.input.trim()) {
      return 'Usage: /librarian capture <note text>';
    }
    const capture = captureKnowledgeRawNote({
      workspaceDir: MAIN_WORKSPACE_DIR,
      text: params.input,
      source: params.chatJid,
    });
    return [
      'Knowledge raw capture saved.',
      `- path: ${capture.relativePath}`,
      `- captured_at: ${capture.capturedAt}`,
    ].join('\n');
  }

  if (action === 'log') {
    const snapshot = resolveKnowledgeRuntimeSnapshot();
    const logPath = snapshot.status.paths.logPath;
    if (!fs.existsSync(logPath)) return 'librarian: no log file found';
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean).slice(-30);
    return [
      'librarian: recent log entries:',
      ...lines.map((l) => `  ${l}`),
    ].join('\n');
  }

  if (action === 'progress') {
    const snapshot = resolveKnowledgeRuntimeSnapshot();
    const progPath = snapshot.status.paths.progressPath;
    if (!fs.existsSync(progPath)) return 'librarian: no progress file found';
    const content = fs.readFileSync(progPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean).slice(-15);
    return [
      'librarian: recent progress entries:',
      ...lines.map((l) => `  ${l}`),
    ].join('\n');
  }

  if (action === 'run' || action === 'dry-run') {
    const knowledgeResult = handleKnowledgeCommand({
      action,
      input: params.input,
      chatJid: params.chatJid,
    });
    return typeof knowledgeResult === 'string'
      ? knowledgeResult
      : `librarian: ${action} completed`;
  }

  return handleLibrarianCommand({ ...params, action: 'help' }, deps);
}

// ---------------------------------------------------------------------------
// formatActiveSubagentsText
// ---------------------------------------------------------------------------

export function formatActiveSubagentsText(): string {
  const runs: string[] = [];
  const now = Date.now();
  for (const run of Array.from(activeCoderRuns.values()).sort(
    (a: ActiveCoderRun, b: ActiveCoderRun) => a.startedAt - b.startedAt,
  )) {
    const age = Math.max(0, Math.floor((now - run.startedAt) / 1000));
    runs.push(
      `- request=${run.requestId} mode=${run.mode} state=${run.state || 'running'} backend=${run.backend || 'pi'} age=${age}s chat=${run.chatJid}${run.parentRequestId ? ` parent=${run.parentRequestId}` : ''}${run.worktreePath ? ` worktree=${run.worktreePath}` : ''}`,
    );
  }
  if (runs.length === 0) return 'No active subagent runs.';
  return ['Active subagent runs:', ...runs].join('\n');
}
