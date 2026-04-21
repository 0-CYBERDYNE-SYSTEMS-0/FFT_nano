import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parsePiListModelsResult,
  parsePiModelListOutput,
} from '../src/pi-models.js';

test('parsePiModelListOutput parses provider/model table rows', () => {
  const output = [
    'provider     model                                         context',
    'zai          glm-4.7                                       204.8K',
    'openrouter   openai/gpt-5.4                                1.1M',
    '',
  ].join('\n');

  assert.deepEqual(parsePiModelListOutput(output), [
    { provider: 'zai', model: 'glm-4.7' },
    { provider: 'openrouter', model: 'openai/gpt-5.4' },
  ]);
});

test('parsePiListModelsResult falls back to stderr when stdout is empty and exit is zero', () => {
  const stderr = [
    'provider     model                                         context',
    'minimax      MiniMax-M2.1                                  196.6K',
    '',
  ].join('\n');

  assert.deepEqual(
    parsePiListModelsResult({ status: 0, stdout: '', stderr }),
    [{ provider: 'minimax', model: 'MiniMax-M2.1' }],
  );
});

test('parsePiListModelsResult returns empty for non-zero exit error output', () => {
  const stderr = 'Unknown provider "kimi". Use --list-models to see available providers/models.';

  assert.deepEqual(
    parsePiListModelsResult({ status: 1, stdout: '', stderr }),
    [],
  );
});

test('parsePiListModelsResult returns empty when both streams contain no table rows', () => {
  assert.deepEqual(
    parsePiListModelsResult({ status: 0, stdout: '', stderr: '' }),
    [],
  );
});

