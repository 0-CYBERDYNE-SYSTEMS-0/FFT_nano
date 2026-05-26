import { z } from 'zod';

import type { MemoryActionRequest } from './types.js';

export const memoryActionSchema = z.object({
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

export type ParsedMemoryAction = z.infer<typeof memoryActionSchema>;

export function resolveAuthorizedGroupFolder(input: {
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

export function assertDurableMemoryPath(relPath: string): void {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\/+/, '');
  const lower = normalized.toLowerCase();
  const isMemoryRoot = lower === 'memory.md';
  const isTodosRoot = lower === 'todos.md';
  const isMemoryNote = /^memory\/[^/].*\.md$/i.test(normalized);
  const isCanonicalNote = /^canonical\/[^/].*\.md$/i.test(normalized);
  if (!isMemoryRoot && !isTodosRoot && !isMemoryNote && !isCanonicalNote) {
    throw new Error(`Path "${relPath}" is not a writable durable memory file`);
  }
}

export function slugId(input: string, fallback = 'entry'): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return normalized ? `T-${normalized}` : `T-${fallback}`;
}

export function extractEntryId(line: string): string | null {
  const match = line.match(/id:([A-Za-z0-9_-]+)/);
  return match?.[1] || null;
}

export function stripTodoMetadata(line: string): string {
  return line.replace(/\s*<!--.*$/, '').trim();
}

export function extractTodoTaskText(line: string): string {
  const normalized = stripTodoMetadata(line);
  const taskBoardMatch = normalized.match(/^- \[[ xX]\]\s+(.*)$/);
  if (taskBoardMatch) return taskBoardMatch[1].trim();
  const blockedMatch = normalized.match(/^- \[(.*?)\]\s*-\s*\[(.*?)\]\s*$/);
  if (blockedMatch) return blockedMatch[1].trim();
  return normalized.replace(/^- /, '').trim();
}

export function taskLineFromPayload(payload: Record<string, unknown>): {
  line: string;
  entryId: string;
} {
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

export function cleanupNoneMarkers(lines: string[]): string[] {
  const filtered = lines.filter((line) => line.trim() !== '- [None]');
  return filtered.length > 0 ? filtered : ['- [None]'];
}

export function validateMemoryWriteIntent(
  intent: MemoryActionRequest['params']['intent'] | undefined,
): NonNullable<MemoryActionRequest['params']['intent']> {
  if (!intent) throw new Error('memory_write requires params.intent');
  return intent;
}
