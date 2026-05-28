import { spawnSync } from 'child_process';

import {
  MEMORY_SEMANTIC_CANDIDATES,
  MEMORY_SEMANTIC_ENABLED,
  MEMORY_SEMANTIC_MODEL,
  MEMORY_SEMANTIC_QUERY_BUDGET_MS,
  MEMORY_SEMANTIC_WEIGHT,
  OLLAMA_BASE_URL,
} from './config.js';
import { logger } from './logger.js';

export const SEMANTIC_CANDIDATE_LIMIT = MEMORY_SEMANTIC_CANDIDATES;

export function isSemanticMemoryEnabled(): boolean {
  return MEMORY_SEMANTIC_ENABLED;
}

/** Cosine similarity in [-1, 1]; 0 for mismatched/empty/degenerate vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Min-max normalize scores to [0, 1]; all-equal inputs map to 1. */
export function minMaxNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max === min) return values.map(() => 1);
  return values.map((v) => (v - min) / (max - min));
}

export interface SemanticCandidate<T> {
  item: T;
  lexicalScore: number;
  text: string;
}

export interface BlendedResult<T> {
  item: T;
  score: number;
}

/**
 * Re-rank lexical candidates by a blend of normalized lexical score and
 * embedding cosine similarity. Pure and embedder-injected so it is fully unit
 * testable. If `queryEmbedding` is null or every candidate fails to embed, the
 * blend collapses to the lexical order (semantic contributes nothing) — this is
 * the lexical fallback.
 */
export function blendSemanticScores<T>(params: {
  candidates: SemanticCandidate<T>[];
  queryEmbedding: number[] | null;
  embed: (text: string) => number[] | null;
  weight?: number;
}): BlendedResult<T>[] {
  const { candidates } = params;
  if (candidates.length === 0) return [];
  const weight = clampWeight(params.weight ?? MEMORY_SEMANTIC_WEIGHT);
  const normLexical = minMaxNormalize(candidates.map((c) => c.lexicalScore));

  if (!params.queryEmbedding) {
    return candidates
      .map((c, i) => ({ item: c.item, score: normLexical[i] }))
      .sort((a, b) => b.score - a.score);
  }

  const sims = candidates.map((c) => {
    const emb = params.embed(c.text);
    return emb ? cosineSimilarity(params.queryEmbedding!, emb) : null;
  });

  return candidates
    .map((c, i) => {
      const sim = sims[i];
      // A candidate we couldn't embed (budget spent or embedder down) keeps its
      // pure lexical rank — weight 0 for that item — so it is neither boosted
      // nor penalized relative to embedded candidates. Only embedded candidates
      // blend in semantic similarity (cosine [-1,1] mapped to [0,1]).
      if (sim === null) return { item: c.item, score: normLexical[i] };
      const semScore = (sim + 1) / 2;
      const score = (1 - weight) * normLexical[i] + weight * semScore;
      return { item: c.item, score };
    })
    .sort((a, b) => b.score - a.score);
}

function clampWeight(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

// ---------------------------------------------------------------------------
// Real local embedder (Ollama). No external API: talks only to a local Ollama
// the operator runs. Any failure returns null so callers fall back to lexical.
// ---------------------------------------------------------------------------

const embedCache = new Map<string, number[] | null>();
const MAX_CACHE_ENTRIES = 2000;
let embedderUnavailable = false;

function postEmbeddingSync(text: string): number[] | null {
  const payload = JSON.stringify({
    model: MEMORY_SEMANTIC_MODEL,
    prompt: text,
  });
  const result = spawnSync(
    'curl',
    [
      '-sf',
      '--max-time',
      '2',
      '-X',
      'POST',
      '-H',
      'content-type: application/json',
      '-d',
      payload,
      `${OLLAMA_BASE_URL.replace(/\/+$/, '')}/api/embeddings`,
    ],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout) as { embedding?: number[] };
    if (Array.isArray(parsed.embedding) && parsed.embedding.length > 0) {
      return parsed.embedding;
    }
  } catch {
    /* fall through to null */
  }
  return null;
}

/**
 * Embed text via the local Ollama model, cached by text. Returns null (and
 * latches off for the process) the first time the embedder is unreachable, so a
 * missing Ollama never slows a query loop more than once.
 */
export function embedTextLocal(text: string): number[] | null {
  const key = text.trim();
  if (!key) return null;
  if (embedCache.has(key)) return embedCache.get(key) ?? null;
  if (embedderUnavailable) return null;
  const embedding = postEmbeddingSync(key);
  if (embedding === null) {
    embedderUnavailable = true;
    logger.debug(
      { model: MEMORY_SEMANTIC_MODEL },
      'Semantic memory embedder unavailable; falling back to lexical',
    );
    return null;
  }
  if (embedCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = embedCache.keys().next().value;
    if (oldest !== undefined) embedCache.delete(oldest);
  }
  embedCache.set(key, embedding);
  return embedding;
}

/**
 * Wrap an embedder with a per-query wall-clock budget. Once the cumulative time
 * spent in embed calls exceeds `budgetMs`, further calls short-circuit to null
 * (those candidates fall back to lexical-only scoring) — bounding how long a
 * single synchronous retrieval can block the host with a slow embedder. Cache
 * hits cost ~0ms, so the cache is still fully used within the budget.
 */
export function createBudgetedEmbedder(
  embed: (text: string) => number[] | null = embedTextLocal,
  budgetMs: number = MEMORY_SEMANTIC_QUERY_BUDGET_MS,
): (text: string) => number[] | null {
  let spent = 0;
  return (text: string) => {
    if (spent >= budgetMs) return null;
    const start = Date.now();
    const result = embed(text);
    spent += Date.now() - start;
    return result;
  };
}

/** Test seam: reset the in-process embedder cache and availability latch. */
export function _resetEmbedderStateForTests(): void {
  embedCache.clear();
  embedderUnavailable = false;
}
