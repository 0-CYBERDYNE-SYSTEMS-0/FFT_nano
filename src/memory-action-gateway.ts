import fs from 'fs';
import path from 'path';

import { z } from 'zod';

import { logger } from './logger.js';
import { getMemoryBackend } from './memory-backend.js';
import {
  isAllowedMemoryRelativePath,
  resolveAllowedMemoryFilePath,
  resolveGroupWorkspaceDir,
} from './memory-paths.js';
import type { MemorySourceFilter } from './memory-search.js';
import type {
  MemoryActionRequest,
  MemoryActionResult,
  RegisteredGroup,
} from './types.js';
import { completeMainWorkspaceOnboarding } from './workspace-bootstrap.js';

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

const memoryActionSchema = z.object({
  type: z.literal('memory_action'),
  requestId: z.string().min(1),
  action: z.enum(['memory_search', 'memory_get', 'memory_write']),
  params: z
    .object({
      query: z.string().optional(),
      path: z.string().optional(),
      topK: z.number().int().min(1).max(64).optional(),
      sources: z.enum(['memory', 'sessions', 'all']).optional(),
      groupFolder: z.string().min(1).optional(),
      intent: z
        .enum([
          'todo_set_objective',
          'todo_upsert_task',
          'todo_move_task',
          'todo_set_blocked',
          'todo_upsert_subagent',
          'todo_append_log',
          'memory_append',
          'memory_promote',
          'nano_patch',
          'soul_patch',
          'bootstrap_complete',
        ])
        .optional(),
      targetSection: z.string().optional(),
      payload: z.record(z.string(), z.unknown()).optional(),
      recordedAt: z.string().optional(),
      occurredAt: z.string().optional(),
      reason: z.string().optional(),
    })
    .default({}),
});

function resolveAuthorizedGroupFolder(input: {
  sourceGroup: string;
  isMain: boolean;
  requestedGroupFolder?: string;
}): string {
  const requested = input.requestedGroupFolder?.trim();
  if (!requested) return input.sourceGroup;
  if (!input.isMain && requested !== input.sourceGroup) {
    throw new Error(
      `Cross-group memory access denied for non-main group "${input.sourceGroup}"`,
    );
  }
  return requested;
}

function readTextFile(filePath: string, fallback = ''): string {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

function writeTextFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const next = content.trimEnd();
  fs.writeFileSync(filePath, `${next}\n`, 'utf8');
}

function ensureTodosFile(groupFolder: string): string {
  const todosPath = resolveAllowedMemoryFilePath(groupFolder, 'TODOS.md');
  if (!fs.existsSync(todosPath)) {
    writeTextFile(todosPath, DEFAULT_TODOS_MD);
  }
  return todosPath;
}

function normalizeLines(content: string): string[] {
  return content.replace(/\r\n?/g, '\n').split('\n');
}

function findSectionRange(lines: string[], heading: string): { start: number; end: number } {
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

function replaceSectionBody(lines: string[], heading: string, bodyLines: string[]): string[] {
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

function slugId(input: string, fallback = 'entry'): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return normalized ? `T-${normalized}` : `T-${fallback}`;
}

function extractEntryId(line: string): string | null {
  const match = line.match(/id:([A-Za-z0-9_-]+)/);
  return match?.[1] || null;
}

function stripTodoMetadata(line: string): string {
  return line.replace(/\s*<!--.*$/, '').trim();
}

function extractTodoTaskText(line: string): string {
  const normalized = stripTodoMetadata(line);
  const taskBoardMatch = normalized.match(/^- \[[ xX]\]\s+(.*)$/);
  if (taskBoardMatch) return taskBoardMatch[1].trim();
  const blockedMatch = normalized.match(/^- \[(.*?)\]\s*-\s*\[(.*?)\]\s*$/);
  if (blockedMatch) return blockedMatch[1].trim();
  return normalized.replace(/^- /, '').trim();
}

function taskLineFromPayload(payload: Record<string, unknown>): { line: string; entryId: string } {
  const text = String(payload.text || '').trim();
  if (!text) throw new Error('todo_upsert_task requires payload.text');
  const status = String(payload.status || 'PENDING').trim() || 'PENDING';
  const checked = status.toUpperCase() === 'DONE' ? 'x' : ' ';
  const entryId = String(payload.entryId || slugId(text));
  return {
    line: `- [${checked}] ${text} <!-- id:${entryId} status:${status.toUpperCase()} -->`,
    entryId,
  };
}

function cleanupNoneMarkers(lines: string[]): string[] {
  const filtered = lines.filter((line) => line.trim() !== '- [None]');
  return filtered.length > 0 ? filtered : ['- [None]'];
}

function applyTodoMutation(input: {
  groupFolder: string;
  intent: NonNullable<MemoryActionRequest['params']['intent']>;
  payload: Record<string, unknown>;
  recordedAt: string;
}): { targetPath: string; operation: string; message: string; entryId?: string } {
  const todosPath = ensureTodosFile(input.groupFolder);
  const lines = normalizeLines(readTextFile(todosPath, DEFAULT_TODOS_MD));

  if (input.intent === 'todo_set_objective') {
    const objective = String(input.payload.objective || '').trim();
    if (!objective) throw new Error('todo_set_objective requires payload.objective');
    const next = replaceSectionBody(lines, TODO_SECTION_OBJECTIVE, [`> ${objective}`]);
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
    const body = range.start === -1 ? [] : lines.slice(range.start + 1, range.end);
    const nextBody = body.length === 0 ? ['- [None]'] : body;
    const index = nextBody.findIndex((entry) => extractEntryId(entry) === entryId);
    if (index >= 0) nextBody[index] = line;
    else nextBody.push(line);
    const next = replaceSectionBody(lines, TODO_SECTION_TASKS, cleanupNoneMarkers(nextBody));
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
    const to = String(input.payload.to || '').trim().toLowerCase();
    if (!entryId) throw new Error('todo_move_task requires payload.entryId');
    if (to !== 'task_board' && to !== 'blocked') {
      throw new Error('todo_move_task requires payload.to of task_board or blocked');
    }
    const taskRange = findSectionRange(lines, TODO_SECTION_TASKS);
    const blockedRange = findSectionRange(lines, TODO_SECTION_BLOCKED);
    const taskBody = taskRange.start === -1 ? ['- [None]'] : lines.slice(taskRange.start + 1, taskRange.end);
    const blockedBody =
      blockedRange.start === -1 ? ['- [None]'] : lines.slice(blockedRange.start + 1, blockedRange.end);
    const taskIdx = taskBody.findIndex((line) => extractEntryId(line) === entryId);
    const blockedIdx = blockedBody.findIndex((line) => extractEntryId(line) === entryId);
    if (taskIdx === -1 && blockedIdx === -1) {
      throw new Error(`todo_move_task could not find entryId=${entryId}`);
    }
    let taskLine = taskIdx >= 0 ? taskBody.splice(taskIdx, 1)[0] : blockedBody.splice(blockedIdx, 1)[0];
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
    let next = replaceSectionBody(lines, TODO_SECTION_TASKS, cleanupNoneMarkers(taskBody));
    next = replaceSectionBody(next, TODO_SECTION_BLOCKED, cleanupNoneMarkers(blockedBody));
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
    if (!text || !reason) throw new Error('todo_set_blocked requires payload.task and payload.reason');
    const entryId = String(input.payload.entryId || slugId(text, 'blocked'));
    const line = `- [${text}] - [${reason}] <!-- id:${entryId} -->`;
    const range = findSectionRange(lines, TODO_SECTION_BLOCKED);
    const body = range.start === -1 ? ['- [None]'] : lines.slice(range.start + 1, range.end);
    const idx = body.findIndex((entry) => extractEntryId(entry) === entryId);
    if (idx >= 0) body[idx] = line;
    else body.push(line);
    const next = replaceSectionBody(lines, TODO_SECTION_BLOCKED, cleanupNoneMarkers(body));
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
      throw new Error('todo_upsert_subagent requires payload.id, payload.task, payload.status');
    }
    const line = `- [${id}] - ${task} - ${status}`;
    const range = findSectionRange(lines, TODO_SECTION_SUBAGENTS);
    const body = range.start === -1 ? ['- [None]'] : lines.slice(range.start + 1, range.end);
    const idx = body.findIndex((entry) => entry.includes(`[${id}]`));
    if (idx >= 0) body[idx] = line;
    else body.push(line);
    const next = replaceSectionBody(lines, TODO_SECTION_SUBAGENTS, cleanupNoneMarkers(body));
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
    const body = range.start === -1 ? [] : lines.slice(range.start + 1, range.end);
    const nextBody = [...body.filter((entry) => entry.trim() !== '- [None]'), line].slice(-40);
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

function assertDurableMemoryPath(relPath: string): void {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\/+/, '');
  const isMemoryRoot = normalized === 'MEMORY.md' || normalized === 'memory.md';
  const isMemoryNote = /^memory\/[^/].*\.md$/i.test(normalized);
  const isCanonicalNote = /^canonical\/[^/].*\.md$/i.test(normalized);
  if (!isMemoryRoot && !isMemoryNote && !isCanonicalNote) {
    throw new Error(`Path "${relPath}" is not a writable durable memory file`);
  }
}

function applySectionAppend(content: string, section: string, body: string): string {
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

function applyMemoryMutation(input: {
  groupFolder: string;
  intent: 'memory_append' | 'memory_promote';
  targetSection?: string;
  payload: Record<string, unknown>;
}): { targetPath: string; operation: string; message: string } {
  const relPath = String(input.payload.path || 'MEMORY.md').trim() || 'MEMORY.md';
  if (!isAllowedMemoryRelativePath(relPath)) {
    throw new Error(`Path "${relPath}" is not an allowed memory file`);
  }
  assertDurableMemoryPath(relPath);
  const absPath = resolveAllowedMemoryFilePath(input.groupFolder, relPath);
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
    message: input.intent === 'memory_promote' ? 'Memory promoted' : 'Memory appended',
  };
}

function applySoulPatch(input: {
  groupFolder: string;
  targetSection?: string;
  payload: Record<string, unknown>;
}): { targetPath: string; operation: string; message: string } {
  const absPath = resolveAllowedMemoryFilePath(input.groupFolder, 'SOUL.md');
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

function applyNanoPatch(input: {
  groupFolder: string;
  targetSection?: string;
  payload: Record<string, unknown>;
}): { targetPath: string; operation: string; message: string } {
  const absPath = resolveAllowedMemoryFilePath(input.groupFolder, 'NANO.md');
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

function applyBootstrapComplete(groupFolder: string): {
  targetPath: string;
  operation: string;
  message: string;
} {
  const workspaceDir = resolveGroupWorkspaceDir(groupFolder);
  completeMainWorkspaceOnboarding({
    workspaceDir,
    removeBootstrapFile: true,
  });
  return {
    targetPath: 'BOOTSTRAP.md',
    operation: 'bootstrap_complete',
    message: 'Bootstrap lifecycle completed',
  };
}

function applyMemoryWrite(input: {
  groupFolder: string;
  params: {
    intent?: MemoryActionRequest['params']['intent'];
    targetSection?: string;
    payload?: Record<string, unknown>;
    recordedAt?: string;
  };
}): {
  targetPath: string;
  operation: string;
  message: string;
  entryId?: string;
} {
  const intent = input.params.intent;
  if (!intent) throw new Error('memory_write requires params.intent');
  const payload = input.params.payload || {};
  const recordedAt = input.params.recordedAt || new Date().toISOString();

  if (
    intent === 'todo_set_objective' ||
    intent === 'todo_upsert_task' ||
    intent === 'todo_move_task' ||
    intent === 'todo_set_blocked' ||
    intent === 'todo_upsert_subagent' ||
    intent === 'todo_append_log'
  ) {
    return applyTodoMutation({
      groupFolder: input.groupFolder,
      intent,
      payload,
      recordedAt,
    });
  }

  if (intent === 'memory_append' || intent === 'memory_promote') {
    return applyMemoryMutation({
      groupFolder: input.groupFolder,
      intent,
      targetSection: input.params.targetSection,
      payload,
    });
  }

  if (intent === 'nano_patch') {
    return applyNanoPatch({
      groupFolder: input.groupFolder,
      targetSection: input.params.targetSection,
      payload,
    });
  }

  if (intent === 'soul_patch') {
    return applySoulPatch({
      groupFolder: input.groupFolder,
      targetSection: input.params.targetSection,
      payload,
    });
  }

  if (intent === 'bootstrap_complete') {
    return applyBootstrapComplete(input.groupFolder);
  }

  throw new Error(`Unsupported memory_write intent: ${intent}`);
}

export async function executeMemoryAction(
  request: MemoryActionRequest,
  context: {
    sourceGroup: string;
    isMain: boolean;
    registeredGroups: Record<string, RegisteredGroup>;
  },
): Promise<MemoryActionResult> {
  const executedAt = new Date().toISOString();
  try {
    const backend = getMemoryBackend();
    const parsed = memoryActionSchema.parse(request);
    const targetGroupFolder = resolveAuthorizedGroupFolder({
      sourceGroup: context.sourceGroup,
      isMain: context.isMain,
      requestedGroupFolder: parsed.params.groupFolder,
    });

    if (parsed.action === 'memory_get') {
      const doc = backend.getDocument({
        groupFolder: targetGroupFolder,
        relPath: parsed.params.path,
      });
      return {
        requestId: parsed.requestId,
        status: 'success',
        result: { document: doc },
        executedAt,
      };
    }

    if (parsed.action === 'memory_search') {
      if (!parsed.params.query || !parsed.params.query.trim()) {
        throw new Error('memory_search requires params.query');
      }

      const topK = Math.min(64, Math.max(1, parsed.params.topK ?? 8));
      const sources: MemorySourceFilter = parsed.params.sources || 'all';
      const hits = backend.search({
        sourceGroup: context.sourceGroup,
        isMain: context.isMain,
        registeredGroups: context.registeredGroups,
        query: parsed.params.query,
        sources,
        topK,
        targetGroupFolder,
      });
      return {
        requestId: parsed.requestId,
        status: 'success',
        result: { hits },
        executedAt,
      };
    }

    const mutation = applyMemoryWrite({
      groupFolder: targetGroupFolder,
      params: {
        intent: parsed.params.intent,
        targetSection: parsed.params.targetSection,
        payload: parsed.params.payload,
        recordedAt: parsed.params.recordedAt,
      },
    });
    return {
      requestId: parsed.requestId,
      status: 'success',
      result: {
        mutation: {
          targetPath: mutation.targetPath,
          operation: mutation.operation,
          status: 'applied',
          message: mutation.message,
          entryId: mutation.entryId,
        },
      },
      executedAt,
    };
  } catch (err) {
    const requestId =
      request && typeof request.requestId === 'string'
        ? request.requestId
        : 'unknown';
    logger.warn(
      {
        requestId,
        action: request?.action,
        sourceGroup: context.sourceGroup,
        err,
      },
      'Memory action execution failed',
    );
    return {
      requestId,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      executedAt,
    };
  }
}
