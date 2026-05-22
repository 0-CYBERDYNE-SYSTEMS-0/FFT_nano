import { MAIN_GROUP_FOLDER } from './config.js';
import { PARITY_CONFIG } from './parity-config.js';
import {
  applySkillManagerTransitions,
  executeSkillAction,
  formatSkillManagerStatus,
  loadSkillManagerState,
  resolveGroupSkillsDir,
  saveSkillManagerState,
  setSkillManagerPaused,
  snapshotSkills,
  writeSkillManagerReport,
  type SkillManagerConfig,
} from './skill-lifecycle.js';
import type { SkillActionRequest } from './types.js';

function usage(): string {
  return [
    'Usage: fft skill-manager <status|run|dry-run|pause|resume|backup|pin|unpin|archive|restore> [skill]',
    '',
    'Options:',
    '  --group <folder>   Target group folder (default: main)',
    '',
    'Legacy alias: fft curator still works (deprecated)',
  ].join('\n');
}

function parseArgs(argv: string[]): {
  command: string;
  rest: string[];
  group: string;
} {
  const rest: string[] = [];
  let group = MAIN_GROUP_FOLDER;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--group') {
      const next = argv[i + 1];
      if (!next) throw new Error('Missing value for --group');
      group = next;
      i += 1;
      continue;
    }
    rest.push(token);
  }
  const [command = 'status', ...tail] = rest;
  return { command, rest: tail, group };
}

function curatorConfig(): SkillManagerConfig {
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

async function runSkillAction(
  group: string,
  action: SkillActionRequest['action'],
  name?: string,
): Promise<void> {
  const request: SkillActionRequest = {
    type: 'skill_action',
    action,
    requestId: `skill-manager-cli-${Date.now()}`,
    params: {
      ...(name ? { name } : {}),
      includeArchived: true,
      groupFolder: group,
    },
  };
  const result = await executeSkillAction(request, {
    sourceGroup: group,
    isMain: true,
    registeredGroups: {},
  });
  if (result.status === 'error') {
    console.error(`skill-manager: ${result.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(result.result, null, 2));
}

function runManager(group: string, dryRun: boolean): void {
  const skillsDir = resolveGroupSkillsDir(group);
  const config = curatorConfig();
  if (!dryRun && config.backupEnabled) {
    snapshotSkills({
      skillsDir,
      reason: 'manual skill-manager run',
      keep: config.backupKeep,
    });
  }
  const transitions = applySkillManagerTransitions({
    skillsDir,
    config,
    dryRun,
  });
  const summary = `${dryRun ? 'dry-run' : 'manual'} skill-manager run: checked=${transitions.checked} stale=${transitions.markedStale} archived=${transitions.archived} reactivated=${transitions.reactivated}`;
  const reportPath = writeSkillManagerReport({
    groupFolder: group,
    skillsDir,
    dryRun,
    summary,
    transitions,
  });
  if (!dryRun) {
    const state = loadSkillManagerState(skillsDir);
    state.lastRunAt = new Date().toISOString();
    state.lastRunSummary = summary;
    state.lastReportPath = reportPath;
    state.runCount += 1;
    saveSkillManagerState(skillsDir, state);
  }
  console.log(summary);
  console.log(`report: ${reportPath}`);
}

function runBackup(group: string): void {
  const skillsDir = resolveGroupSkillsDir(group);
  const snap = snapshotSkills({
    skillsDir,
    reason: 'manual backup',
    keep: curatorConfig().backupKeep,
  });
  console.log(
    snap
      ? `skill-manager: backup created at ${snap}`
      : 'skill-manager: no skills directory to back up',
  );
}

async function main(): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(usage());
    process.exit(2);
  }

  const { command, rest, group } = parsed;

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(usage());
    return;
  }

  if (command === 'status') {
    console.log(formatSkillManagerStatus(group));
    return;
  }

  if (command === 'run') {
    runManager(group, false);
    return;
  }

  if (command === 'dry-run') {
    runManager(group, true);
    return;
  }

  if (command === 'pause' || command === 'resume') {
    setSkillManagerPaused(group, command === 'pause');
    console.log(`skill-manager: ${command === 'pause' ? 'paused' : 'resumed'}`);
    return;
  }

  if (command === 'backup') {
    runBackup(group);
    return;
  }

  const skill = rest[0];
  if (!skill) {
    console.error(`skill-manager: ${command} requires a skill name`);
    process.exit(2);
    return;
  }

  if (command === 'pin') return runSkillAction(group, 'skill_pin', skill);
  if (command === 'unpin') return runSkillAction(group, 'skill_unpin', skill);
  if (command === 'archive')
    return runSkillAction(group, 'skill_archive', skill);
  if (command === 'restore')
    return runSkillAction(group, 'skill_restore', skill);

  console.error(`Unknown skill-manager command: ${command}`);
  console.error(usage());
  process.exit(2);
}

// Legacy alias — print deprecation warning then run the new command
async function legacyCuratorMain(): Promise<void> {
  console.error(
    'WARNING: "fft curator" is deprecated. Use "fft skill-manager" instead.',
  );
  console.error(
    'The /curator Telegram command is also deprecated. Use /skill-manager.\n',
  );
  await main();
}

const isLegacy = process.argv[1] === 'curator';
if (isLegacy) {
  void legacyCuratorMain().catch((err) => {
    console.error(
      err instanceof Error ? err.stack || err.message : String(err),
    );
    process.exit(1);
  });
} else {
  main().catch((err) => {
    console.error(
      err instanceof Error ? err.stack || err.message : String(err),
    );
    process.exit(1);
  });
}
