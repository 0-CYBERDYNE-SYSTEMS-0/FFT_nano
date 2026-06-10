import fs from 'fs';
import path from 'path';

import { resolveGroupFolderPath } from './group-folder.js';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Mutation audit log
//
// One JSONL line per mutation event (success or rejection), written to the
// group's log dir. Mirrors the recordSelfImproveEvent / recordTaskAuditEvent
// pattern. Used by the /learning digest to show mutation activity.
// ---------------------------------------------------------------------------

export type MutationAuditKind =
  | 'mutation'
  | 'noop';

export interface MutationAuditEvent {
  // 'mutation' = successful mutation, 'noop' = rejected due to budget
  kind: MutationAuditKind;
  authorityId: string;
  senderRole: string;
  mutationType: 'skill' | 'memory' | 'task_creation';
  /** 'create' | 'patch' | 'write_file' for skill mutations; intent name for memory; 'schedule_task' for task creation */
  action: string;
  targetName?: string; // skill name, memory file path, or taskId
  groupId?: string;
  // For noop events: why the mutation was rejected
  noopReason?: string;
  success: boolean;
}

function mutationAuditLogPath(groupFolder: string): string {
  return path.join(
    resolveGroupFolderPath(groupFolder),
    'logs',
    'mutation-audit.jsonl',
  );
}

/**
 * Record a mutation event (success or rejection) to the group's mutation-audit.jsonl.
 *
 * - success=true + kind='mutation': the mutation was applied.
 * - success=false + kind='noop': the mutation was rejected; noopReason is set.
 *
 * Best-effort: failures are caught and logged but never throw.
 */
export function recordMutationAuditEvent(
  groupFolder: string,
  event: MutationAuditEvent,
): void {
  try {
    const filePath = mutationAuditLogPath(groupFolder);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      group_id: groupFolder,
      ...event,
    });
    fs.appendFileSync(filePath, `${line}\n`);
  } catch (err) {
    logger.warn(
      { err, groupFolder, event },
      'Failed to record mutation audit event',
    );
  }
}
