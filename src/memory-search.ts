import fs from 'fs';
import path from 'path';

import {
  searchMessagesByFts,
  type TranscriptSearchRow,
} from './db.js';
import {
  isAllowedMemoryRelativePath,
  resolveAllowedMemoryFilePath,
  resolveGroupWorkspaceDir,
  resolveMemoryDir,
  resolveMemoryPath,
} from './memory-paths.js';

const MAX_CHUNK_CHARS = 800;
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

export type MemorySourceFilter = 'memory' | 'sessions' | 'all';

export interface MemorySearchHit {
  source: 'memory_doc' | 'session_transcript';
  score: number;
  groupFolder: string;
  title: string;
  snippet: string;
  path?: string;
  chatJid?: string;
  senderName?: string;
  timestamp?: string;
}

export interface MemoryDocument {
  groupFolder: string;
  path: string;
  content: string;
}

interface DocumentChunk {
  groupFolder: string;
  relPath: string;
  text: string;
}

function normalize(text: string): string {
  return text.replace(/\r\n?/g, '\n');
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
      if (!buffer) buffer = line;
      else if (buffer.length + 1 + line.length <= MAX_CHUNK_CHARS) buffer += `\n${line}`;
      else {
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
      if (!sentenceBuffer) sentenceBuffer = sentence;
      else if (sentenceBuffer.length + 1 + sentence.length <= MAX_CHUNK_CHARS) {
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
  const paragraphs = normalize(text)
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
      chunks.push(...splitLongSegment(paragraph));
      continue;
    }

    if (!buffer) buffer = paragraph;
    else if (buffer.length + 2 + paragraph.length <= MAX_CHUNK_CHARS) {
      buffer += `\n\n${paragraph}`;
    } else {
      pushBuffer();
      buffer = paragraph;
    }
  }

  pushBuffer();
  return chunks;
}

function lexicalScore(queryTokens: string[], queryText: string, chunkText: string): number {
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
    queryText.length >= 18 && chunkText.toLowerCase().includes(queryText.toLowerCase())
      ? 0.35
      : 0;
  return coverage * 2 + density + phraseBonus;
}

function listMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        out.push(full);
      }
    }
  }
  out.sort();
  return out;
}

function collectDocumentFiles(groupFolder: string): Array<{ abs: string; rel: string }> {
  const workspace = resolveGroupWorkspaceDir(groupFolder);
  const files = new Set<string>();
  const primaryMemoryPath = resolveMemoryPath(groupFolder);
  const legacyMemoryPath = path.join(workspace, 'memory.md');
  if (fs.existsSync(primaryMemoryPath) && fs.statSync(primaryMemoryPath).isFile()) {
    files.add(path.resolve(primaryMemoryPath));
  } else if (
    fs.existsSync(legacyMemoryPath) &&
    fs.statSync(legacyMemoryPath).isFile()
  ) {
    files.add(path.resolve(legacyMemoryPath));
  }
  for (const file of listMarkdownFiles(resolveMemoryDir(groupFolder))) {
    files.add(path.resolve(file));
  }
  return Array.from(files).map((abs) => ({
    abs,
    rel: path.relative(workspace, abs).replace(/\\/g, '/'),
  }));
}

function collectDocumentChunks(groupFolder: string): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  for (const file of collectDocumentFiles(groupFolder)) {
    let content = '';
    try {
      content = fs.readFileSync(file.abs, 'utf8');
    } catch {
      continue;
    }
    for (const chunk of chunkMemoryText(content)) {
      chunks.push({
        groupFolder,
        relPath: file.rel,
        text: chunk,
      });
    }
  }
  return chunks;
}

export function searchDocumentMemory(input: {
  groupFolder: string;
  query: string;
  topK?: number;
  includeGlobal?: boolean;
}): MemorySearchHit[] {
  const topK = Math.min(64, Math.max(1, input.topK ?? 8));
  const groupFolders = [input.groupFolder];
  if (input.includeGlobal !== false && input.groupFolder !== 'global') {
    groupFolders.push('global');
  }
  const queryText = input.query.trim();
  if (!queryText) return [];
  const queryTokens = tokenize(queryText);

  const scored: Array<{ chunk: DocumentChunk; score: number }> = [];
  for (const folder of groupFolders) {
    for (const chunk of collectDocumentChunks(folder)) {
      const score = lexicalScore(queryTokens, queryText, chunk.text);
      if (score <= 0) continue;
      // Prefer dedicated memory root files over memory/* notes.
      const pathBonus =
        chunk.relPath === 'MEMORY.md' || chunk.relPath === 'memory.md' ? 0.2 : 0;
      scored.push({ chunk, score: score + pathBonus });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(({ chunk, score }) => ({
    source: 'memory_doc',
    score,
    groupFolder: chunk.groupFolder,
    title: chunk.relPath,
    path: chunk.relPath,
    snippet: chunk.text.replace(/\n{3,}/g, '\n\n').trim(),
  }));
}

function toTranscriptHit(
  row: TranscriptSearchRow,
  groupFolder: string,
): MemorySearchHit {
  const rank = Number.isFinite(row.rank) ? row.rank : 0;
  const score = 1 / (1 + Math.abs(rank));
  return {
    source: 'session_transcript',
    score,
    groupFolder,
    title: `${row.sender_name || 'unknown'} @ ${row.timestamp}`,
    snippet: row.snippet || row.content,
    chatJid: row.chat_jid,
    senderName: row.sender_name,
    timestamp: row.timestamp,
  };
}

export function searchTranscriptMemory(input: {
  groupFolder: string;
  query: string;
  chatJids: string[];
  topK?: number;
}): MemorySearchHit[] {
  const topK = Math.min(64, Math.max(1, input.topK ?? 8));
  if (!input.query.trim()) return [];
  const rows = searchMessagesByFts(input.chatJids, input.query, topK);
  return rows.map((row) => toTranscriptHit(row, input.groupFolder));
}

export function mergeAndRankMemoryHits(
  hits: MemorySearchHit[],
  topK = 8,
): MemorySearchHit[] {
  return [...hits]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(64, Math.max(1, topK)));
}

export function getMemoryDocument(input: {
  groupFolder: string;
  relPath?: string;
}): MemoryDocument {
  const relPath = (input.relPath || 'MEMORY.md').trim();
  if (!isAllowedMemoryRelativePath(relPath)) {
    throw new Error(`Path "${relPath}" is not an allowed memory file`);
  }

  const absPath = resolveAllowedMemoryFilePath(input.groupFolder, relPath);
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    throw new Error(`Memory file not found: ${relPath}`);
  }

  const content = fs.readFileSync(absPath, 'utf8');
  return {
    groupFolder: input.groupFolder,
    path: relPath.replace(/\\/g, '/'),
    content,
  };
}
