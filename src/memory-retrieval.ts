import fs from 'fs';
import path from 'path';

import {
  GROUPS_DIR,
  MEMORY_CONTEXT_CHAR_BUDGET,
  MEMORY_RETRIEVAL_GATE_ENABLED,
  MEMORY_TOP_K,
} from './config.js';

type MemorySource = 'group' | 'global';

interface MemoryChunk {
  source: MemorySource;
  index: number;
  text: string;
}

interface ChunkCacheEntry {
  mtimeMs: number;
  chunks: string[];
}

export interface BuildMemoryContextInput {
  groupFolder: string;
  prompt: string;
}

export interface MemoryContextBuildResult {
  context: string;
  chunksTotal: number;
  selectedK: number;
  contextChars: number;
  queryChars: number;
}

const MAX_CHUNK_CHARS = 800;
const CHUNK_CACHE = new Map<string, ChunkCacheEntry>();

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'we',
  'with',
  'you',
  'your',
]);

function readFileIfExists(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function getChunkedFile(filePath: string): string[] {
  let statMtime = 0;
  try {
    const stat = fs.statSync(filePath);
    statMtime = stat.mtimeMs;
  } catch {
    return [];
  }

  const cached = CHUNK_CACHE.get(filePath);
  if (cached && cached.mtimeMs === statMtime) {
    return cached.chunks;
  }

  const content = readFileIfExists(filePath);
  if (!content) {
    CHUNK_CACHE.delete(filePath);
    return [];
  }

  const chunks = chunkMemoryText(content);
  CHUNK_CACHE.set(filePath, { mtimeMs: statMtime, chunks });
  return chunks;
}

function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g);
  if (!matches) return [];
  return matches.filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function splitLongSegment(segment: string): string[] {
  const lines = segment.split('\n').map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  let buffer = '';

  const pushBuffer = () => {
    const trimmed = buffer.trim();
    if (trimmed) out.push(trimmed);
    buffer = '';
  };

  for (const line of lines) {
    if (line.length <= MAX_CHUNK_CHARS) {
      if (!buffer) {
        buffer = line;
      } else if (buffer.length + 1 + line.length <= MAX_CHUNK_CHARS) {
        buffer += `\n${line}`;
      } else {
        pushBuffer();
        buffer = line;
      }
      continue;
    }

    pushBuffer();
    const sentences = line
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (sentences.length === 0) {
      for (let i = 0; i < line.length; i += MAX_CHUNK_CHARS) {
        out.push(line.slice(i, i + MAX_CHUNK_CHARS).trim());
      }
      continue;
    }

    let sentenceBuffer = '';
    for (const sentence of sentences) {
      if (!sentenceBuffer) {
        sentenceBuffer = sentence;
      } else if (
        sentenceBuffer.length + 1 + sentence.length <= MAX_CHUNK_CHARS
      ) {
        sentenceBuffer += ` ${sentence}`;
      } else {
        out.push(sentenceBuffer.trim());
        sentenceBuffer = sentence;
      }
    }
    if (sentenceBuffer) out.push(sentenceBuffer.trim());
  }

  pushBuffer();
  return out;
}

function chunkMemoryText(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let buffer = '';

  const pushBuffer = () => {
    const trimmed = buffer.trim();
    if (trimmed) chunks.push(trimmed);
    buffer = '';
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_CHUNK_CHARS) {
      pushBuffer();
      for (const part of splitLongSegment(paragraph)) {
        if (part) chunks.push(part);
      }
      continue;
    }

    if (!buffer) {
      buffer = paragraph;
    } else if (buffer.length + 2 + paragraph.length <= MAX_CHUNK_CHARS) {
      buffer += `\n\n${paragraph}`;
    } else {
      pushBuffer();
      buffer = paragraph;
    }
  }

  pushBuffer();
  return chunks;
}

function extractQueryText(prompt: string): string {
  const lines = prompt
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const tail = lines.slice(-6).map((line) => {
    // Strip "[timestamp] sender:" prefix from chat-log lines.
    const stripped = line.replace(/^\[[^\]]+\]\s*[^:]{1,80}:\s*/, '');
    return stripped
      .replace(/^\[[A-Z _-]+\]\s*/, '')
      .replace(/^FarmFriend:\s*/i, '');
  });

  const query = tail.join(' ').trim();
  if (query.length <= 300) return query;
  return query.slice(query.length - 300);
}

function lexicalScore(
  queryTokens: string[],
  queryText: string,
  chunkText: string,
): number {
  if (queryTokens.length === 0) return 0;

  const querySet = new Set(queryTokens);
  const chunkTokens = tokenize(chunkText);
  const chunkSet = new Set(chunkTokens);

  let overlap = 0;
  for (const token of querySet) {
    if (chunkSet.has(token)) overlap += 1;
  }
  if (overlap === 0) return 0;

  const coverage = overlap / querySet.size;
  const density = overlap / Math.max(chunkSet.size, 1);
  const phraseBonus =
    queryText.length >= 18 && chunkText.toLowerCase().includes(queryText)
      ? 0.35
      : 0;

  return coverage * 2 + density + phraseBonus;
}

function formatSnippet(rank: number, chunk: MemoryChunk): string {
  const snippet = chunk.text.replace(/\n{3,}/g, '\n\n').trim();
  return `[${rank}] (${chunk.source}) ${snippet}`;
}

function getPreferredMemoryChunks(baseDir: string): string[] {
  // SOUL.md is canonical; CLAUDE.md remains supported for backwards compatibility.
  const soulChunks = getChunkedFile(path.join(baseDir, 'SOUL.md'));
  if (soulChunks.length > 0) return soulChunks;
  return getChunkedFile(path.join(baseDir, 'CLAUDE.md'));
}

export function buildMemoryContext(
  input: BuildMemoryContextInput,
): MemoryContextBuildResult {
  if (!MEMORY_RETRIEVAL_GATE_ENABLED) {
    return {
      context: '',
      chunksTotal: 0,
      selectedK: 0,
      contextChars: 0,
      queryChars: 0,
    };
  }

  const allChunks: MemoryChunk[] = [];

  const groupChunks = getPreferredMemoryChunks(
    path.join(GROUPS_DIR, input.groupFolder),
  );
  for (let i = 0; i < groupChunks.length; i += 1) {
    allChunks.push({ source: 'group', index: i, text: groupChunks[i] });
  }

  const globalChunks = getPreferredMemoryChunks(path.join(GROUPS_DIR, 'global'));
  for (let i = 0; i < globalChunks.length; i += 1) {
    allChunks.push({ source: 'global', index: i, text: globalChunks[i] });
  }

  if (allChunks.length === 0) {
    return {
      context: '',
      chunksTotal: 0,
      selectedK: 0,
      contextChars: 0,
      queryChars: 0,
    };
  }

  const queryText = extractQueryText(input.prompt).toLowerCase();
  const queryTokens = tokenize(queryText);

  const scored = allChunks.map((chunk) => {
    const lexical = lexicalScore(queryTokens, queryText, chunk.text);
    const sourceBonus = chunk.source === 'group' ? 0.05 : 0;
    const tieBreaker = 1 / (chunk.index + 1) / 1000;
    const score = lexical + sourceBonus + tieBreaker;
    return { chunk, score, lexical };
  });

  const hasLexicalMatch = scored.some((s) => s.lexical > 0);
  scored.sort((a, b) => {
    if (hasLexicalMatch) return b.score - a.score;
    if (a.chunk.source !== b.chunk.source) {
      return a.chunk.source === 'group' ? -1 : 1;
    }
    return a.chunk.index - b.chunk.index;
  });

  const header = 'Relevant memory snippets:\n';
  const budgetForSnippets = Math.max(0, MEMORY_CONTEXT_CHAR_BUDGET - header.length);
  const selected: string[] = [];
  let usedChars = 0;

  for (let i = 0; i < scored.length; i += 1) {
    if (selected.length >= MEMORY_TOP_K) break;

    const nextRank = selected.length + 1;
    const formatted = formatSnippet(nextRank, scored[i].chunk);
    const separator = selected.length === 0 ? 0 : 2;
    const projected = usedChars + separator + formatted.length;

    if (projected <= budgetForSnippets) {
      if (separator) usedChars += separator;
      selected.push(formatted);
      usedChars += formatted.length;
      continue;
    }

    if (selected.length === 0) {
      const reserve = `[${nextRank}] (${scored[i].chunk.source}) `.length;
      const remaining = budgetForSnippets - reserve;
      if (remaining > 40) {
        const snippet = scored[i].chunk.text.slice(0, remaining - 3).trim();
        const clipped = `[${nextRank}] (${scored[i].chunk.source}) ${snippet}...`;
        selected.push(clipped);
        usedChars = clipped.length;
      }
    }
    break;
  }

  const context = selected.length > 0 ? `${header}${selected.join('\n\n')}` : '';

  return {
    context,
    chunksTotal: allChunks.length,
    selectedK: selected.length,
    contextChars: context.length,
    queryChars: queryText.length,
  };
}
