import fs from 'fs';
import path from 'path';

import { defaultBackupPath, writeTextFileAtomic } from './atomic-write.js';
import {
  isAllowedMemoryRelativePath,
  resolveAllowedMemoryFilePath,
  resolveGroupWorkspaceDir,
  resolveTodosPath,
  resolveMemoryPath,
  resolveSoulPath,
  resolveNanoPath,
} from './memory-paths.js';
import type { MemoryActionRequest } from './types.js';
import { completeMainWorkspaceOnboarding } from './workspace-bootstrap.js';
import {
  assertDurableMemoryPath,
  cleanupNoneMarkers,
  extractEntryId,
  extractTodoTaskText,
  slugId,
  taskLineFromPayload,
} from './memory-action-validation.js';
import { snapshotMemoryFile } from './memory-history.js';
import { PARITY_CONFIG } from './config.js';

const TODO_SECTION_OBJECTIVE = '## 🚀 ACTIVE OBJECTIVE';
const TODO_SECTION_TASKS = '## 📋 TASK BOARD';
const TODO_SECTION_SUBAGENTS = '## 🤖 SUB-AGENTS & PROCESSES';
const TODO_SECTION_BLOCKED = '## ⏳ BLOCKED / WAITING';
const TODO_SECTION_LOG = '## 📝 MISSION LOG';

const DEFAULT_TODOS_MD = [
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
].join('\n');

export function readTextFile(filePath: string, fallback = ''): string {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

export function writeTextFile(filePath: string, content: string): void {
  const next = content.trimEnd();
  writeTextFileAtomic(filePath, `${next}\n`, {
    backupPath: defaultBackupPath(filePath),
  });
}

export function ensureTodosFile(groupFolder: string): string {
  const todosPath = resolveAllowedMemoryFilePath(groupFolder, 'TODOS.md');
  if (!fs.existsSync(todosPath)) {
    writeTextFile(todosPath, DEFAULT_TODOS_MD);
  }
  return todosPath;
}

export function normalizeLines(content: string): string[] {
  return content.replace(/\r\n?/g, '\n').split('\n');
}

export function findSectionRange(
  lines: string[],
  heading: string,
): { start: number; end: number } {
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return { start: -1, end: -1 };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  return { start, end };
}

export function replaceSectionBody(
  lines: string[],
  heading: string,
  bodyLines: string[],
): string[] {
  const range = findSectionRange(lines, heading);
  if (range.start === -1) {
    const next = [...lines];
    if (next.length > 0 && next[next.length - 1].trim() !== '') next.push('');
    next.push(heading, ...bodyLines);
    return next;
  }
  const next = [...lines];
  const replacement = [heading, ...bodyLines];
  next.splice(range.start, range.end - range.start, ...replacement);
  return next;
}

export function applySectionAppend(
  content: string,
  section: string,
  body: string,
): string {
  if (!section.trim()) {
    return `${content.trimEnd()}\n\n${body}\n`;
  }
  const heading = `## ${section.trim()}`;
  const lines = normalizeLines(content);
  const range = findSectionRange(lines, heading);
  const line = body.includes('\n') ? body : `- ${body}`;
  if (range.start === -1) {
    const next = [...lines];
    if (next.length > 0 && next[next.length - 1].trim() !== '') next.push('');
    next.push(heading, line);
    return `${next.join('\n').trimEnd()}\n`;
  }
  const sectionBody = lines.slice(range.start + 1, range.end);
  sectionBody.push(line);
  const next = replaceSectionBody(lines, heading, sectionBody);
  return `${next.join('\n').trimEnd()}\n`;
}

export function applyTodoMutation(input: {
  groupFolder: string;
  intent: NonNullable<MemoryActionRequest['params']['intent']>;
  payload: Record<string, unknown>;
  recordedAt: string;
  attribution?: {
    authorityId: string;
    senderRole: string;
    jid?: string;
  };
}): {
  targetPath: string;
  operation: string;
  message: string;
  entryId?: string;
} {
  const todosPath = ensureTodosFile(input.groupFolder);
  // WS6 mutation-budget: snapshot before write so memory is reversible
  snapshotMemoryFile(
    todosPath,
    input.attribution,
    PARITY_CONFIG.skills.historyRetentionDays,
  );
  const lines = normalizeLines(readTextFile(todosPath, DEFAULT_TODOS_MD));

  if (input.intent === 'todo_set_objective') {
    const objective = String(input.payload.objective || '').trim();
    if (!objective)
      throw new Error('todo_set_objective requires payload.objective');
    const next = replaceSectionBody(lines, TODO_SECTION_OBJECTIVE, [
      `> ${objective}`,
    ]);
    writeTextFile(todosPath, next.join('\n'));
    return {
      targetPath: 'TODOS.md',
      operation: input.intent,
      message: 'Active objective updated',
    };
  }

  if (input.intent === 'todo_upsert_task') {
    const { line, entryId } = taskLineFromPayload(input.payload);
    const range = findSectionRange(lines, TODO_SECTION_TASKS);
    const body =
      range.start === -1 ? [] : lines.slice(range.start + 1, range.end);
    const nextBody = body.length === 0 ? ['- [None]'] : body;
    const index = nextBody.findIndex(
      (entry) => extractEntryId(entry) === entryId,
    );
    if (index >= 0) nextBody[index] = line;
    else nextBody.push(line);
    const next = replaceSectionBody(
      lines,
      TODO_SECTION_TASKS,
      cleanupNoneMarkers(nextBody),
    );
    writeTextFile(todosPath, next.join('\n'));
    return {
      targetPath: 'TODOS.md',
      operation: input.intent,
      message: 'Task upserted',
      entryId,
    };
  }

  if (input.intent === 'todo_move_task') {
    const entryId = String(input.payload.entryId || '').trim();
    const to = String(input.payload.to || '')
      .trim()
      .toLowerCase();
    if (!entryId) throw new Error('todo_move_task requires payload.entryId');
    if (to !== 'task_board' && to !== 'blocked') {
      throw new Error(
        'todo_move_task requires payload.to of task_board or blocked',
      );
    }
    const taskRange = findSectionRange(lines, TODO_SECTION_TASKS);
    const blockedRange = findSectionRange(lines, TODO_SECTION_BLOCKED);
    const taskBody =
      taskRange.start === -1
        ? ['- [None]']
        : lines.slice(taskRange.start + 1, taskRange.end);
    const blockedBody =
      blockedRange.start === -1
        ? ['- [None]']
        : lines.slice(blockedRange.start + 1, blockedRange.end);
    const taskIdx = taskBody.findIndex(
      (line) => extractEntryId(line) === entryId,
    );
    const blockedIdx = blockedBody.findIndex(
      (line) => extractEntryId(line) === entryId,
    );
    if (taskIdx === -1 && blockedIdx === -1) {
      throw new Error(`todo_move_task could not find entryId=${entryId}`);
    }
    let taskLine =
      taskIdx >= 0
        ? taskBody.splice(taskIdx, 1)[0]
        : blockedBody.splice(blockedIdx, 1)[0];
    if (to === 'blocked') {
      const text = extractTodoTaskText(taskLine);
      const reason = String(input.payload.reason || 'waiting').trim();
      taskLine = `- [${text}] - [${reason}] <!-- id:${entryId} -->`;
      blockedBody.push(taskLine);
    } else {
      const text = extractTodoTaskText(taskLine);
      const status = String(input.payload.status || 'PENDING').toUpperCase();
      const checked = status === 'DONE' ? 'x' : ' ';
      taskLine = `- [${checked}] ${text} <!-- id:${entryId} status:${status} -->`;
      taskBody.push(taskLine);
    }
    let next = replaceSectionBody(
      lines,
      TODO_SECTION_TASKS,
      cleanupNoneMarkers(taskBody),
    );
    next = replaceSectionBody(
      next,
      TODO_SECTION_BLOCKED,
      cleanupNoneMarkers(blockedBody),
    );
    writeTextFile(todosPath, next.join('\n'));
    return {
      targetPath: 'TODOS.md',
      operation: input.intent,
      message: `Task moved to ${to}`,
      entryId,
    };
  }

  if (input.intent === 'todo_set_blocked') {
    const text = String(input.payload.task || '').trim();
    const reason = String(input.payload.reason || '').trim();
    if (!text || !reason)
      throw new Error(
        'todo_set_blocked requires payload.task and payload.reason',
      );
    const entryId = String(input.payload.entryId || slugId(text, 'blocked'));
    const line = `- [${text}] - [${reason}] <!-- id:${entryId} -->`;
    const range = findSectionRange(lines, TODO_SECTION_BLOCKED);
    const body =
      range.start === -1
        ? ['- [None]']
        : lines.slice(range.start + 1, range.end);
    const idx = body.findIndex((entry) => extractEntryId(entry) === entryId);
    if (idx >= 0) body[idx] = line;
    else body.push(line);
    const next = replaceSectionBody(
      lines,
      TODO_SECTION_BLOCKED,
      cleanupNoneMarkers(body),
    );
    writeTextFile(todosPath, next.join('\n'));
    return {
      targetPath: 'TODOS.md',
      operation: input.intent,
      message: 'Blocked item updated',
      entryId,
    };
  }

  if (input.intent === 'todo_upsert_subagent') {
    const id = String(input.payload.id || '').trim();
    const task = String(input.payload.task || '').trim();
    const status = String(input.payload.status || '').trim();
    if (!id || !task || !status) {
      throw new Error(
        'todo_upsert_subagent requires payload.id, payload.task, payload.status',
      );
    }
    const line = `- [${id}] - ${task} - ${status}`;
    const range = findSectionRange(lines, TODO_SECTION_SUBAGENTS);
    const body =
      range.start === -1
        ? ['- [None]']
        : lines.slice(range.start + 1, range.end);
    const idx = body.findIndex((entry) => entry.includes(`[${id}]`));
    if (idx >= 0) body[idx] = line;
    else body.push(line);
    const next = replaceSectionBody(
      lines,
      TODO_SECTION_SUBAGENTS,
      cleanupNoneMarkers(body),
    );
    writeTextFile(todosPath, next.join('\n'));
    return {
      targetPath: 'TODOS.md',
      operation: input.intent,
      message: 'Sub-agent status updated',
      entryId: id,
    };
  }

  if (input.intent === 'todo_append_log') {
    const text = String(input.payload.text || '').trim();
    if (!text) throw new Error('todo_append_log requires payload.text');
    const hhmm =
      String(input.payload.time || '').trim() ||
      new Date(input.recordedAt).toTimeString().slice(0, 5);
    const line = `- [${hhmm}] - ${text}`;
    const range = findSectionRange(lines, TODO_SECTION_LOG);
    const body =
      range.start === -1 ? [] : lines.slice(range.start + 1, range.end);
    const nextBody = [
      ...body.filter((entry) => entry.trim() !== '- [None]'),
      line,
    ].slice(-40);
    const next = replaceSectionBody(lines, TODO_SECTION_LOG, nextBody);
    writeTextFile(todosPath, next.join('\n'));
    return {
      targetPath: 'TODOS.md',
      operation: input.intent,
      message: 'Mission log appended',
    };
  }

  throw new Error(`Unsupported todo intent: ${input.intent}`);
}

export function applyMemoryMutation(input: {
  groupFolder: string;
  intent: 'memory_append' | 'memory_promote';
  targetSection?: string;
  payload: Record<string, unknown>;
  attribution?: {
    authorityId: string;
    senderRole: string;
    jid?: string;
  };
}): { targetPath: string; operation: string; message: string } {
  const relPath =
    String(input.payload.path || 'MEMORY.md').trim() || 'MEMORY.md';
  if (!isAllowedMemoryRelativePath(relPath)) {
    throw new Error(`Path "${relPath}" is not an allowed memory file`);
  }
  assertDurableMemoryPath(relPath);
  const absPath = resolveAllowedMemoryFilePath(input.groupFolder, relPath);
  // WS6 mutation-budget: snapshot before write so memory is reversible
  snapshotMemoryFile(
    absPath,
    input.attribution,
    PARITY_CONFIG.skills.historyRetentionDays,
  );
  const current = readTextFile(
    absPath,
    relPath.toLowerCase().startsWith('memory/') ||
      relPath.toLowerCase().startsWith('canonical/')
      ? `# ${path.basename(relPath, '.md')}\n`
      : '# MEMORY\n',
  );
  const content = String(input.payload.content || '').trim();
  if (!content) throw new Error(`${input.intent} requires payload.content`);
  const next = applySectionAppend(current, input.targetSection || '', content);
  writeTextFile(absPath, next);
  return {
    targetPath: relPath.replace(/\\/g, '/'),
    operation: input.intent,
    message:
      input.intent === 'memory_promote' ? 'Memory promoted' : 'Memory appended',
  };
}

export function applySoulPatch(input: {
  groupFolder: string;
  targetSection?: string;
  payload: Record<string, unknown>;
  attribution?: {
    authorityId: string;
    senderRole: string;
    jid?: string;
  };
}): { targetPath: string; operation: string; message: string } {
  const absPath = resolveSoulPath(input.groupFolder);
  // WS6 mutation-budget: snapshot before write so memory is reversible
  snapshotMemoryFile(
    absPath,
    input.attribution,
    PARITY_CONFIG.skills.historyRetentionDays,
  );
  const current = readTextFile(absPath, '# SOUL\n');
  const content = String(input.payload.content || '').trim();
  if (!content) throw new Error('soul_patch requires payload.content');
  const section = input.targetSection?.trim() || 'Runtime Guidance';
  const next = applySectionAppend(current, section, content);
  writeTextFile(absPath, next);
  return {
    targetPath: 'SOUL.md',
    operation: 'soul_patch',
    message: `SOUL section "${section}" updated`,
  };
}

export function applyNanoPatch(input: {
  groupFolder: string;
  targetSection?: string;
  payload: Record<string, unknown>;
  attribution?: {
    authorityId: string;
    senderRole: string;
    jid?: string;
  };
}): { targetPath: string; operation: string; message: string } {
  const absPath = resolveNanoPath(input.groupFolder);
  // WS6 mutation-budget: snapshot before write so memory is reversible
  snapshotMemoryFile(
    absPath,
    input.attribution,
    PARITY_CONFIG.skills.historyRetentionDays,
  );
  const current = readTextFile(absPath, '# NANO\n');
  const content = String(input.payload.content || '').trim();
  if (!content) throw new Error('nano_patch requires payload.content');
  const section = input.targetSection?.trim() || 'Operational Guidance';
  const next = applySectionAppend(current, section, content);
  writeTextFile(absPath, next);
  return {
    targetPath: 'NANO.md',
    operation: 'nano_patch',
    message: `NANO section "${section}" updated`,
  };
}

export function applyBootstrapComplete(groupFolder: string): {
  targetPath: string;
  operation: string;
  message: string;
} {
  const workspaceDir = resolveGroupWorkspaceDir(groupFolder);
  completeMainWorkspaceOnboarding({ workspaceDir, removeBootstrapFile: true });
  return {
    targetPath: 'BOOTSTRAP.md',
    operation: 'bootstrap_complete',
    message: 'Bootstrap lifecycle completed',
  };
}
