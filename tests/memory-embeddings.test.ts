import assert from 'node:assert/strict';
import test from 'node:test';

import {
  blendSemanticScores,
  cosineSimilarity,
  createBudgetedEmbedder,
  minMaxNormalize,
} from '../src/memory-embeddings.js';

test('cosineSimilarity handles identical, orthogonal, and degenerate vectors', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.ok(Math.abs(cosineSimilarity([1, 1], [1, 0]) - Math.SQRT1_2) < 1e-9);
  // Mismatched length and zero vectors are safe (no NaN).
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
});

test('minMaxNormalize maps to [0,1] and handles all-equal input', () => {
  assert.deepEqual(minMaxNormalize([0, 5, 10]), [0, 0.5, 1]);
  assert.deepEqual(minMaxNormalize([3, 3, 3]), [1, 1, 1]);
  assert.deepEqual(minMaxNormalize([]), []);
});

test('blend falls back to lexical order when no query embedding', () => {
  const candidates = [
    { item: 'a', lexicalScore: 3, text: 'alpha' },
    { item: 'b', lexicalScore: 1, text: 'bravo' },
    { item: 'c', lexicalScore: 2, text: 'charlie' },
  ];
  const ranked = blendSemanticScores({
    candidates,
    queryEmbedding: null,
    embed: () => null,
    weight: 0.5,
  });
  assert.deepEqual(
    ranked.map((r) => r.item),
    ['a', 'c', 'b'],
  );
});

test('blend falls back to lexical order when the embedder yields nothing', () => {
  const candidates = [
    { item: 'a', lexicalScore: 3, text: 'alpha' },
    { item: 'b', lexicalScore: 1, text: 'bravo' },
  ];
  const ranked = blendSemanticScores({
    candidates,
    queryEmbedding: [1, 0],
    embed: () => null, // embedder down for every chunk
    weight: 1,
  });
  assert.deepEqual(
    ranked.map((r) => r.item),
    ['a', 'b'],
  );
});

test('semantic similarity can override lexical when weighted fully', () => {
  // 'b' has weaker lexical overlap but is semantically aligned with the query.
  const queryEmbedding = [1, 0];
  const embeddings: Record<string, number[]> = {
    alpha: [0, 1], // orthogonal to query
    bravo: [1, 0], // identical to query
  };
  const candidates = [
    { item: 'a', lexicalScore: 3, text: 'alpha' },
    { item: 'b', lexicalScore: 1, text: 'bravo' },
  ];
  const ranked = blendSemanticScores({
    candidates,
    queryEmbedding,
    embed: (text) => embeddings[text] ?? null,
    weight: 1,
  });
  assert.deepEqual(
    ranked.map((r) => r.item),
    ['b', 'a'],
  );
});

test('a candidate skipped by the budget keeps its lexical rank, not a zero-similarity penalty', () => {
  // a + c embed; b is short-circuited (null). b must be scored on pure lexical
  // (0.5), so it stays ahead of the low-similarity embedded candidate c, rather
  // than being deflated to (1-weight)*lexical with an implicit zero semantic.
  const queryEmbedding = [1, 0];
  const embeddings: Record<string, number[] | null> = {
    alpha: [0, 1], // sim 0 -> sem 0.5
    bravo: null, // budget-skipped / embedder down
    charlie: [0, 1], // sim 0 -> sem 0.5
  };
  const candidates = [
    { item: 'a', lexicalScore: 4, text: 'alpha' }, // normLex 1
    { item: 'b', lexicalScore: 2, text: 'bravo' }, // normLex 0.5
    { item: 'c', lexicalScore: 0, text: 'charlie' }, // normLex 0
  ];
  const ranked = blendSemanticScores({
    candidates,
    queryEmbedding,
    embed: (text) => embeddings[text] ?? null,
    weight: 0.5,
  });
  assert.deepEqual(
    ranked.map((r) => r.item),
    ['a', 'b', 'c'],
  );
  const b = ranked.find((r) => r.item === 'b');
  assert.ok(Math.abs((b?.score ?? -1) - 0.5) < 1e-9); // pure lexical, not 0.25
});

test('budgeted embedder stops calling once the time budget is spent', () => {
  let calls = 0;
  const slowEmbed = (_text: string): number[] => {
    calls += 1;
    const end = Date.now() + 15; // busy-wait ~15ms (>> 5ms budget)
    while (Date.now() < end) {
      /* spin */
    }
    return [1, 0];
  };
  const budgeted = createBudgetedEmbedder(slowEmbed, 5);
  const first = budgeted('one'); // spent 0 < 5 -> runs, then spent ~15ms
  const second = budgeted('two'); // spent >= 5 -> short-circuits to null
  const third = budgeted('three');
  assert.deepEqual(first, [1, 0]);
  assert.equal(second, null);
  assert.equal(third, null);
  assert.equal(calls, 1); // only the first call actually invoked the embedder
});

test('blend mixes both signals at intermediate weight', () => {
  const queryEmbedding = [1, 0];
  const embeddings: Record<string, number[]> = {
    alpha: [0, 1],
    bravo: [1, 0],
  };
  const candidates = [
    { item: 'a', lexicalScore: 1, text: 'alpha' },
    { item: 'b', lexicalScore: 0, text: 'bravo' },
  ];
  // normLex: a=1, b=0. sem(mapped): a=0.5, b=1. weight 0.5 ->
  // a = .5*1 + .5*.5 = .75 ; b = .5*0 + .5*1 = .5 -> a wins.
  const ranked = blendSemanticScores({
    candidates,
    queryEmbedding,
    embed: (text) => embeddings[text] ?? null,
    weight: 0.5,
  });
  assert.equal(ranked[0].item, 'a');
  assert.ok(Math.abs(ranked[0].score - 0.75) < 1e-9);
  assert.ok(Math.abs(ranked[1].score - 0.5) < 1e-9);
});
