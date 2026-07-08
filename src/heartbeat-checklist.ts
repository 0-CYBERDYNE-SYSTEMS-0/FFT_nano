import fs from 'fs';
import path from 'path';

import { isHeartbeatFileEffectivelyEmpty } from './heartbeat-policy.js';
import { extractHeartbeatAlert } from './heartbeat-policy.js';
import { verifySkillCleanupMemoryClaim } from './memory-claim-verifier.js';
import {
  getLocalDateKey,
  getEffectiveTimezone,
} from './time-context.js';
import {
  isJournalScaffoldContent,
  recordJournalPristineObservation,
} from './memory-paths.js';

export interface HeartbeatChecklistInput {
  workspaceDir: string;
  requestId: string;
  reason: string;
  result: string | null;
  ok: boolean;
  currentTasksPath: string;
  runtimeLogPath: string;
  now?: Date;
  timezone?: string;
}

export interface HeartbeatChecklistResult {
  schema: 'fft_nano.heartbeat_check_result.v1';
  requestId: string;
  reason: string;
  createdAt: string;
  outcome: 'ok' | 'alert' | 'error' | 'empty';
  checks: {
    heartbeatFile: {
      path: string;
      exists: boolean;
      effectivelyEmpty: boolean;
    };
    currentTasks: {
      path: string;
      exists: boolean;
    };
    runtimeLog: {
      path: string;
      exists: boolean;
    };
    memoryToday: {
      path: string;
      exists: boolean;
      writtenToday: boolean;
      consecutivePristineDays: number;
      dateKey: string;
    };
    memoryClaims: ReturnType<typeof verifySkillCleanupMemoryClaim>;
  };
}

function classifyHeartbeatOutcome(
  ok: boolean,
  result: string | null,
): HeartbeatChecklistResult['outcome'] {
  if (!ok) return 'error';
  const trimmed = result?.trim() || '';
  if (!trimmed) return 'empty';
  if (extractHeartbeatAlert(trimmed).isAlert) return 'alert';
  return 'ok';
}

export function buildHeartbeatChecklist(
  input: HeartbeatChecklistInput,
): HeartbeatChecklistResult {
  const now = input.now ?? new Date();
  const timezone = input.timezone ?? getEffectiveTimezone();
  const localDateKey = getLocalDateKey(now, timezone);
  const heartbeatPath = path.join(input.workspaceDir, 'HEARTBEAT.md');
  const memoryTodayPath = path.join(
    input.workspaceDir,
    'memory',
    `${localDateKey}.md`,
  );
  const skillsDir = path.join(input.workspaceDir, 'skills');
  const memoryExists = fs.existsSync(memoryTodayPath);
  let writtenToday = false;
  if (memoryExists) {
    try {
      const journalContent = fs.readFileSync(memoryTodayPath, 'utf-8');
      writtenToday = !isJournalScaffoldContent(localDateKey, journalContent);
    } catch {
      writtenToday = false;
    }
  }
  const pristine = recordJournalPristineObservation(
    input.workspaceDir,
    localDateKey,
    writtenToday,
  );
  return {
    schema: 'fft_nano.heartbeat_check_result.v1',
    requestId: input.requestId,
    reason: input.reason,
    createdAt: now.toISOString(),
    outcome: classifyHeartbeatOutcome(input.ok, input.result),
    checks: {
      heartbeatFile: {
        path: heartbeatPath,
        exists: fs.existsSync(heartbeatPath),
        effectivelyEmpty: isHeartbeatFileEffectivelyEmpty(heartbeatPath),
      },
      currentTasks: {
        path: input.currentTasksPath,
        exists: fs.existsSync(input.currentTasksPath),
      },
      runtimeLog: {
        path: input.runtimeLogPath,
        exists: fs.existsSync(input.runtimeLogPath),
      },
      memoryToday: {
        path: memoryTodayPath,
        exists: memoryExists,
        writtenToday,
        consecutivePristineDays: pristine.consecutivePristineDays,
        dateKey: localDateKey,
      },
      memoryClaims: verifySkillCleanupMemoryClaim({
        memoryPath: memoryTodayPath,
        skillsDir,
      }),
    },
  };
}

export function writeHeartbeatChecklist(
  input: HeartbeatChecklistInput,
): string {
  const checklist = buildHeartbeatChecklist(input);
  const outDir = path.join(input.workspaceDir, 'heartbeat', 'checks');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${input.requestId}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(checklist, null, 2)}\n`, 'utf-8');
  return outPath;
}
