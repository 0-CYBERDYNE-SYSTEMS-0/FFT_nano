import { z } from 'zod';

import { logger } from './logger.js';
import { getMemoryBackend } from './memory-backend.js';
import type { MemorySourceFilter } from './memory-search.js';
import type {
  MemoryActionRequest,
  MemoryActionResult,
  RegisteredGroup,
} from './types.js';

const memoryActionSchema = z.object({
  type: z.literal('memory_action'),
  requestId: z.string().min(1),
  action: z.enum(['memory_search', 'memory_get']),
  params: z
    .object({
      query: z.string().optional(),
      path: z.string().optional(),
      topK: z.number().int().min(1).max(64).optional(),
      sources: z.enum(['memory', 'sessions', 'all']).optional(),
      groupFolder: z.string().min(1).optional(),
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
      result: {
        hits,
      },
      executedAt,
    };
  } catch (err) {
    const requestId =
      request && typeof request.requestId === 'string' ? request.requestId : 'unknown';
    logger.warn(
      { requestId, action: request?.action, sourceGroup: context.sourceGroup, err },
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
