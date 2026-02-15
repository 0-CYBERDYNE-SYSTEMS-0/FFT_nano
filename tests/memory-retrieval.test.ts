import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import { buildMemoryContext } from '../src/memory-retrieval.js';

test('memory retrieval does not duplicate MEMORY.md via memory.md alias', () => {
  const folder = `test-memory-retrieval-${Date.now()}`;
  const groupRoot = path.join(process.cwd(), 'groups', folder);
  try {
    fs.mkdirSync(groupRoot, { recursive: true });
    fs.writeFileSync(
      path.join(groupRoot, 'MEMORY.md'),
      '# MEMORY\n\nUNIQ_MEMORY_ALIAS_TOKEN_2026\n',
    );

    const result = buildMemoryContext({
      groupFolder: folder,
      prompt: 'tell me about UNIQ_MEMORY_ALIAS_TOKEN_2026',
    });

    const matches =
      result.context.match(/UNIQ_MEMORY_ALIAS_TOKEN_2026/g)?.length || 0;
    assert.equal(matches, 1);
  } finally {
    fs.rmSync(groupRoot, { recursive: true, force: true });
  }
});
