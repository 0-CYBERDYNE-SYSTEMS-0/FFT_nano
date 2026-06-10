import fs from 'fs';
import path from 'path';

import { resolveGroupFolderPath } from './group-folder.js';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Task audit log
//
// One JSONL line per task state transition (create, approve, reject, cancel,
// delete_after_run), written to the group's log dir so the full lifecycle
// survives delete_after_run. Mirrors the recordSelfImproveEvent pattern.
// ---------------------------------------------------------------------------

export type TaskAuditKind =
  | 'create'
  | 'approve'
  | 'reject'
  | 'cancel'
  | 'delete'
  | 'delete_after_run'
  | 'approve_denied'
  | 'reject_denied';

export interface TaskAuditEvent {
  taskId: string;
  // groupId is optional because recordTaskAuditEvent adds group_id automatically
  groupId?: string;
  authorityId?: string;
  // For approve/reject: the JID of the operator who took action
  operatorJid?: string;
  // For denied attempts: the JID that attempted the action
  attemptedByJid?: string;
  priorStatus?: string;
  newStatus?: string | null;
  kind: TaskAuditKind;
  // Human-readable preview of the task prompt
  promptPreview?: string;
  // Task metadata useful for forensic review
  scheduleType?: string;
  scheduleValue?: string;
  deliveryTo?: string | null;
  deliveryMode?: string | null;
  deleteAfterRun?: boolean;
  createdBy?: 'operator' | 'agent';
  // senderRole is filled by WS3; VAL-XARE-008 requires it in the audit line
  senderRole?: 'operator' | 'member' | 'unknown';
}

function taskAuditLogPath(groupFolder: string): string {
  return path.join(
    resolveGroupFolderPath(groupFolder),
    'logs',
    'task-audit.jsonl',
  );
}

export function recordTaskAuditEvent(
  groupFolder: string,
  event: TaskAuditEvent,
): void {
  try {
    const filePath = taskAuditLogPath(groupFolder);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      group_id: groupFolder,
      ...event,
    });
    fs.appendFileSync(filePath, `${line}\n`);
  } catch (err) {
    logger.warn(
      { err, groupFolder, taskId: event.taskId, kind: event.kind },
      'Failed to record task audit event',
    );
  }
}
