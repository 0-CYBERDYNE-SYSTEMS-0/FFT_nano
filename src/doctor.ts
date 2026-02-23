import fs from 'fs';
import path from 'path';

import {
  DATA_DIR,
  MAIN_WORKSPACE_DIR,
  PARITY_CONFIG,
  PARITY_CONFIG_PATH,
  STORE_DIR,
} from './config.js';
import { closeDatabase, getAllTasks, initDatabaseAtPath } from './db.js';
import { parseHeartbeatActiveHours } from './heartbeat-policy.js';
import { readMainWorkspaceState } from './workspace-bootstrap.js';

type CheckLevel = 'pass' | 'warn' | 'fail';

interface CheckResult {
  id: string;
  level: CheckLevel;
  summary: string;
  detail?: string;
}

interface DoctorReport {
  status: CheckLevel;
  checks: CheckResult[];
  generatedAt: string;
  configPath: string;
}

const REQUIRED_WORKSPACE_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'USER.md',
  'IDENTITY.md',
  'PRINCIPLES.md',
  'TOOLS.md',
  'HEARTBEAT.md',
  'MEMORY.md',
] as const;

function levelWeight(level: CheckLevel): number {
  if (level === 'fail') return 2;
  if (level === 'warn') return 1;
  return 0;
}

function summarizeStatus(checks: CheckResult[]): CheckLevel {
  let score = 0;
  for (const check of checks) {
    score = Math.max(score, levelWeight(check.level));
  }
  if (score >= 2) return 'fail';
  if (score >= 1) return 'warn';
  return 'pass';
}

function formatReportText(report: DoctorReport): string {
  const lines = [
    `FFT_nano doctor: ${report.status.toUpperCase()}`,
    `generated_at: ${report.generatedAt}`,
    `parity_config: ${report.configPath}`,
    '',
  ];
  for (const check of report.checks) {
    lines.push(`[${check.level.toUpperCase()}] ${check.id}: ${check.summary}`);
    if (check.detail) lines.push(`  ${check.detail}`);
  }
  return lines.join('\n');
}

function checkWorkspaceFiles(): CheckResult {
  const missing = REQUIRED_WORKSPACE_FILES.filter(
    (file) => !fs.existsSync(path.join(MAIN_WORKSPACE_DIR, file)),
  );
  if (missing.length > 0) {
    return {
      id: 'workspace.files',
      level: 'fail',
      summary: 'Missing required workspace files',
      detail: missing.join(', '),
    };
  }
  return {
    id: 'workspace.files',
    level: 'pass',
    summary: 'Required workspace files are present',
  };
}

function checkWorkspaceBootstrapCaps(): CheckResult {
  const fileCap = PARITY_CONFIG.workspace.bootstrapMaxChars;
  const totalCap = PARITY_CONFIG.workspace.bootstrapTotalMaxChars;
  if (fileCap <= 0 || totalCap <= 0 || totalCap < fileCap) {
    return {
      id: 'workspace.bootstrap_caps',
      level: 'fail',
      summary: 'Bootstrap prompt caps are invalid',
      detail: `file_cap=${fileCap} total_cap=${totalCap}`,
    };
  }
  if (fileCap > 80_000 || totalCap > 300_000) {
    return {
      id: 'workspace.bootstrap_caps',
      level: 'warn',
      summary: 'Bootstrap caps are very high and may cause token bloat',
      detail: `file_cap=${fileCap} total_cap=${totalCap}`,
    };
  }
  return {
    id: 'workspace.bootstrap_caps',
    level: 'pass',
    summary: 'Bootstrap prompt caps look healthy',
    detail: `file_cap=${fileCap} total_cap=${totalCap}`,
  };
}

function checkWorkspaceBootState(): CheckResult {
  if (!PARITY_CONFIG.workspace.enableBootMd) {
    return {
      id: 'workspace.boot',
      level: 'pass',
      summary: 'BOOT.md startup run disabled',
    };
  }
  const bootPath = path.join(MAIN_WORKSPACE_DIR, 'BOOT.md');
  if (!fs.existsSync(bootPath)) {
    return {
      id: 'workspace.boot',
      level: 'warn',
      summary: 'BOOT.md is enabled but file is missing',
    };
  }
  const state = readMainWorkspaceState(MAIN_WORKSPACE_DIR);
  return {
    id: 'workspace.boot',
    level: state.bootExecutedAt ? 'pass' : 'warn',
    summary: state.bootExecutedAt
      ? `BOOT.md executed at ${state.bootExecutedAt}`
      : 'BOOT.md present but not yet executed',
  };
}

function checkHeartbeatConfig(): CheckResult {
  const every = PARITY_CONFIG.heartbeat.every;
  const target = PARITY_CONFIG.heartbeat.target;
  const activeRaw =
    PARITY_CONFIG.heartbeat.activeHoursRaw ||
    (PARITY_CONFIG.heartbeat.activeHours
      ? `${PARITY_CONFIG.heartbeat.activeHours.start}-${PARITY_CONFIG.heartbeat.activeHours.end}@${PARITY_CONFIG.heartbeat.activeHours.timezone}`
      : '');
  if (activeRaw) {
    const parsed = parseHeartbeatActiveHours(activeRaw);
    if (!parsed) {
      return {
        id: 'heartbeat.config',
        level: 'fail',
        summary: 'Heartbeat active-hours format is invalid',
        detail: activeRaw,
      };
    }
  }
  if (!PARITY_CONFIG.heartbeat.visibility.showAlerts) {
    return {
      id: 'heartbeat.config',
      level: 'warn',
      summary: 'Heartbeat alerts are hidden by configuration',
      detail: `every=${every} target=${target}`,
    };
  }
  return {
    id: 'heartbeat.config',
    level: 'pass',
    summary: 'Heartbeat configuration parsed successfully',
    detail: `every=${every} target=${target}`,
  };
}

function checkCronHealth(): CheckResult {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  if (!fs.existsSync(dbPath)) {
    return {
      id: 'cron.health',
      level: 'warn',
      summary: 'Task database not found yet',
      detail: dbPath,
    };
  }

  initDatabaseAtPath(dbPath);
  const tasks = getAllTasks();
  closeDatabase();

  if (tasks.length === 0) {
    return {
      id: 'cron.health',
      level: 'pass',
      summary: 'No scheduled tasks found',
    };
  }

  const now = Date.now();
  const overdue = tasks.filter((task) => {
    if (task.status !== 'active' || !task.next_run) return false;
    const nextMs = new Date(task.next_run).getTime();
    return Number.isFinite(nextMs) && nextMs < now - 10 * 60_000;
  });
  const unhealthy = tasks.filter((task) => (task.consecutive_errors || 0) >= 3);

  if (overdue.length > 0 || unhealthy.length > 0) {
    return {
      id: 'cron.health',
      level: 'warn',
      summary: 'Cron has overdue or repeatedly failing tasks',
      detail: `overdue=${overdue.length} consecutive_errors>=3=${unhealthy.length}`,
    };
  }

  return {
    id: 'cron.health',
    level: 'pass',
    summary: 'Cron task health looks good',
    detail: `tasks=${tasks.length}`,
  };
}

function checkMemoryConfig(): CheckResult {
  const backend = PARITY_CONFIG.memory.backend;
  const missingBehavior = PARITY_CONFIG.memory.missingFileBehavior;
  if (backend !== 'lexical') {
    return {
      id: 'memory.backend',
      level: 'warn',
      summary: 'Unknown memory backend configured; lexical fallback expected',
      detail: backend,
    };
  }
  return {
    id: 'memory.backend',
    level: 'pass',
    summary: 'Memory backend configuration looks valid',
    detail: `backend=${backend} missing_file=${missingBehavior}`,
  };
}

function checkStateDirs(): CheckResult {
  const exists = fs.existsSync(DATA_DIR);
  return {
    id: 'runtime.state',
    level: exists ? 'pass' : 'warn',
    summary: exists ? 'Runtime state directory exists' : 'Runtime state directory missing',
    detail: DATA_DIR,
  };
}

function buildDoctorReport(): DoctorReport {
  const checks: CheckResult[] = [
    checkStateDirs(),
    checkWorkspaceFiles(),
    checkWorkspaceBootstrapCaps(),
    checkWorkspaceBootState(),
    checkHeartbeatConfig(),
    checkCronHealth(),
    checkMemoryConfig(),
  ];
  return {
    status: summarizeStatus(checks),
    checks,
    generatedAt: new Date().toISOString(),
    configPath: PARITY_CONFIG_PATH,
  };
}

function main(): void {
  const json = process.argv.includes('--json');
  const report = buildDoctorReport();
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatReportText(report)}\n`);
  }
  if (report.status === 'fail') process.exit(2);
  if (report.status === 'warn') process.exit(1);
}

main();

