import { logger } from './logger.js';
import { getMemoryBackend } from './memory-backend.js';
import type { MemorySourceFilter } from './memory-search.js';
import type {
  MemoryActionRequest,
  MemoryActionResult,
  RegisteredGroup,
} from './types.js';
import {
  memoryActionSchema,
  resolveAuthorizedGroupFolder,
  validateMemoryWriteIntent,
} from './memory-action-validation.js';
import {
  applyBootstrapComplete,
  applyMemoryMutation,
  applyNanoPatch,
  applySoulPatch,
  applyTodoMutation,
} from './memory-action-io.js';

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
  const intent = validateMemoryWriteIntent(input.params.intent);
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
