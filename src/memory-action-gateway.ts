import { z } from 'zod';

import { logger } from './logger.js';
import {
  getMemoryDocument,
  mergeAndRankMemoryHits,
  searchDocumentMemory,
  searchTranscriptMemory,
  type MemorySourceFilter,
} from './memory-search.js';
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

function getChatJidsForGroup(
  registeredGroups: Record<string, RegisteredGroup>,
  groupFolder: string,
): string[] {
  return Object.entries(registeredGroups)
    .filter(([, group]) => group.folder === groupFolder)
    .map(([jid]) => jid);
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
    const parsed = memoryActionSchema.parse(request);
    const targetGroupFolder = resolveAuthorizedGroupFolder({
      sourceGroup: context.sourceGroup,
      isMain: context.isMain,
      requestedGroupFolder: parsed.params.groupFolder,
    });

    if (parsed.action === 'memory_get') {
      const doc = getMemoryDocument({
        groupFolder: targetGroupFolder,
        relPath: parsed.params.path || 'MEMORY.md',
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
    const hits = [];

    if (sources === 'memory' || sources === 'all') {
      hits.push(
        ...searchDocumentMemory({
          groupFolder: targetGroupFolder,
          query: parsed.params.query,
          topK,
          includeGlobal: true,
        }),
      );
    }

    if (sources === 'sessions' || sources === 'all') {
      const chatJids = getChatJidsForGroup(
        context.registeredGroups,
        targetGroupFolder,
      );
      hits.push(
        ...searchTranscriptMemory({
          groupFolder: targetGroupFolder,
          query: parsed.params.query,
          chatJids,
          topK,
        }),
      );
    }

    return {
      requestId: parsed.requestId,
      status: 'success',
      result: {
        hits: mergeAndRankMemoryHits(hits, topK),
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
