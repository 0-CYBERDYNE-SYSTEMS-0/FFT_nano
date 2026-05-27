import fs from 'fs';
import path from 'path';

import { isHeartbeatFileEffectivelyEmpty } from './heartbeat-policy.js';
import { stripHeartbeatToken } from './heartbeat-policy.js';
import { verifySkillCleanupMemoryClaim } from './memory-claim-verifier.js';

export interface HeartbeatChecklistInput {
  workspaceDir: string;
  requestId: string;
  reason: string;
  result: string | null;
  ok: boolean;
  currentTasksPath: string;
  runtimeLogPath: string;
  now?: Date;
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
  if (stripHeartbeatToken(trimmed, { mode: 'heartbeat' }).shouldSkip)
    return 'ok';
  return 'alert';
}

export function buildHeartbeatChecklist(
  input: HeartbeatChecklistInput,
): HeartbeatChecklistResult {
  const now = input.now ?? new Date();
  const heartbeatPath = path.join(input.workspaceDir, 'HEARTBEAT.md');
  const memoryTodayPath = path.join(
    input.workspaceDir,
    'memory',
    `${now.toISOString().slice(0, 10)}.md`,
  );
  const skillsDir = path.join(input.workspaceDir, 'skills');
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
        exists: fs.existsSync(memoryTodayPath),
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
