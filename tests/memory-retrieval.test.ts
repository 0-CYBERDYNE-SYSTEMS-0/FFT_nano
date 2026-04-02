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

test('memory retrieval prefers canonical hot memory over legacy memory root', () => {
  const folder = `test-memory-retrieval-canon-${Date.now()}`;
  const groupRoot = path.join(process.cwd(), 'groups', folder);
  try {
    fs.mkdirSync(path.join(groupRoot, 'canonical'), { recursive: true });
    fs.writeFileSync(
      path.join(groupRoot, 'canonical', '_hot.md'),
      '# _hot\n\nHOT_CANON_TOKEN_2026\n',
    );
    fs.writeFileSync(
      path.join(groupRoot, 'MEMORY.md'),
      '# MEMORY\n\nLEGACY_MEMORY_TOKEN_2026\n',
    );

    const result = buildMemoryContext({
      groupFolder: folder,
      prompt: 'tell me about HOT_CANON_TOKEN_2026',
    });

    assert.match(result.context, /canonical\/_hot\.md/);
    assert.doesNotMatch(result.context, /LEGACY_MEMORY_TOKEN_2026/);
  } finally {
    fs.rmSync(groupRoot, { recursive: true, force: true });
  }
});

test('memory retrieval preserves legacy MEMORY.md when canonical files are only scaffold stubs', () => {
  const folder = `test-memory-retrieval-legacy-fallback-${Date.now()}`;
  const groupRoot = path.join(process.cwd(), 'groups', folder);
  try {
    fs.mkdirSync(path.join(groupRoot, 'canonical'), { recursive: true });
    fs.writeFileSync(
      path.join(groupRoot, 'canonical', '_hot.md'),
      '# _hot\n\nHigh-priority durable memory retrieved before all other canon.\n',
    );
    fs.writeFileSync(
      path.join(groupRoot, 'canonical', 'identity.md'),
      '# identity\n\nStable user preferences and profile facts.\n',
    );
    fs.writeFileSync(
      path.join(groupRoot, 'canonical', 'constraints.md'),
      '# constraints\n\nStanding hard constraints and prohibitions.\n',
    );
    fs.writeFileSync(
      path.join(groupRoot, 'canonical', 'commitments.md'),
      '# commitments\n\nActive long-lived commitments and obligations.\n',
    );
    fs.writeFileSync(
      path.join(groupRoot, 'canonical', 'projects.md'),
      '# projects\n\nLong-lived project context and architecture notes.\n',
    );
    fs.writeFileSync(
      path.join(groupRoot, 'MEMORY.md'),
      '# MEMORY\n\nLEGACY_DURABLE_TOKEN_2026\n',
    );

    const result = buildMemoryContext({
      groupFolder: folder,
      prompt: 'tell me about LEGACY_DURABLE_TOKEN_2026',
    });

    assert.match(result.context, /LEGACY_DURABLE_TOKEN_2026/);
  } finally {
    fs.rmSync(groupRoot, { recursive: true, force: true });
  }
});

test('memory retrieval preserves legacy MEMORY.md during partial canonical migration', () => {
  const folder = `test-memory-retrieval-partial-canon-${Date.now()}`;
  const groupRoot = path.join(process.cwd(), 'groups', folder);
  try {
    fs.mkdirSync(path.join(groupRoot, 'canonical'), { recursive: true });
    fs.writeFileSync(
      path.join(groupRoot, 'canonical', 'projects.md'),
      '# projects\n\nNEW_CANON_TOKEN_2026\n',
    );
    fs.writeFileSync(
      path.join(groupRoot, 'MEMORY.md'),
      '# MEMORY\n\nLEGACY_DURABLE_PARTIAL_TOKEN_2026\n',
    );

    const result = buildMemoryContext({
      groupFolder: folder,
      prompt: 'tell me about LEGACY_DURABLE_PARTIAL_TOKEN_2026',
    });

    assert.match(result.context, /LEGACY_DURABLE_PARTIAL_TOKEN_2026/);
  } finally {
    fs.rmSync(groupRoot, { recursive: true, force: true });
  }
});
