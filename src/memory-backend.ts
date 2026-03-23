import { PARITY_CONFIG } from './config.js';
import {
  getMemoryDocument,
  mergeAndRankMemoryHits,
  searchDocumentMemory,
  searchTranscriptMemory,
  type MemorySourceFilter,
} from './memory-search.js';
import {
  buildMemoryContext,
  type MemoryContextBuildResult,
} from './memory-retrieval.js';
import type { MemorySearchHit, RegisteredGroup } from './types.js';

export interface MemorySearchInput {
  sourceGroup: string;
  isMain: boolean;
  registeredGroups: Record<string, RegisteredGroup>;
  query: string;
  sources: MemorySourceFilter;
  topK: number;
  targetGroupFolder: string;
}

export interface MemoryDocumentInput {
  groupFolder: string;
  relPath?: string;
}

export interface MemoryBackend {
  kind: 'lexical';
  getDocument(input: MemoryDocumentInput): {
    groupFolder: string;
    path: string;
    content: string;
  };
  search(input: MemorySearchInput): MemorySearchHit[];
  buildContext(input: {
    groupFolder: string;
    prompt: string;
  }): MemoryContextBuildResult;
}

function getChatJidsForGroup(
  registeredGroups: Record<string, RegisteredGroup>,
  groupFolder: string,
): string[] {
  return Object.entries(registeredGroups)
    .filter(([, group]) => group.folder === groupFolder)
    .map(([jid]) => jid);
}

export class LexicalMemoryBackend implements MemoryBackend {
  public readonly kind = 'lexical' as const;

  getDocument(input: MemoryDocumentInput): {
    groupFolder: string;
    path: string;
    content: string;
  } {
    return getMemoryDocument({
      groupFolder: input.groupFolder,
      relPath: input.relPath,
      missingBehavior: PARITY_CONFIG.memory.missingFileBehavior,
    });
  }

  search(input: MemorySearchInput): MemorySearchHit[] {
    const hits = [];
    if (input.sources === 'memory' || input.sources === 'all') {
      hits.push(
        ...searchDocumentMemory({
          groupFolder: input.targetGroupFolder,
          query: input.query,
          topK: input.topK,
          includeGlobal: true,
        }),
      );
    }

    if (input.sources === 'sessions' || input.sources === 'all') {
      const chatJids = getChatJidsForGroup(
        input.registeredGroups,
        input.targetGroupFolder,
      );
      hits.push(
        ...searchTranscriptMemory({
          groupFolder: input.targetGroupFolder,
          query: input.query,
          chatJids,
          topK: input.topK,
        }),
      );
    }

    return mergeAndRankMemoryHits(hits, input.topK);
  }

  buildContext(input: {
    groupFolder: string;
    prompt: string;
  }): MemoryContextBuildResult {
    return buildMemoryContext(input);
  }
}

let backendSingleton: MemoryBackend | null = null;

export function getMemoryBackend(): MemoryBackend {
  if (backendSingleton) return backendSingleton;
  switch (PARITY_CONFIG.memory.backend) {
    case 'lexical':
    default:
      backendSingleton = new LexicalMemoryBackend();
      break;
  }
  return backendSingleton;
}
