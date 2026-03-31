import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  getSubagentType,
  SUBAGENT_TYPE_REGISTRY,
  listSubagentTypeNames,
} from '../src/subagent-types.js';
import { loadSubagentPrompt } from '../src/subagent-prompts.js';

// ---------------------------------------------------------------------------
// Phase 1: subagent-types.ts
// ---------------------------------------------------------------------------

describe('subagent-types', () => {
  describe('SUBAGENT_TYPE_REGISTRY', () => {
    it('has exactly 7 registered types', () => {
      assert.equal(SUBAGENT_TYPE_REGISTRY.size, 7);
    });

    it('has all expected type names', () => {
      const names = [...SUBAGENT_TYPE_REGISTRY.keys()];
      assert.ok(names.includes('eval'));
      assert.ok(names.includes('nightly-analyst'));
      assert.ok(names.includes('photo-analyst'));
      assert.ok(names.includes('researcher'));
      assert.ok(names.includes('compliance-auditor'));
      assert.ok(names.includes('data-sync'));
      assert.ok(names.includes('general'));
    });

    it('each type has required fields', () => {
      for (const [name, type] of SUBAGENT_TYPE_REGISTRY) {
        assert.ok(type.name, `type missing name`);
        assert.ok(type.label, `${name} missing label`);
        assert.ok(type.description, `${name} missing description`);
        assert.ok(Array.isArray(type.tools), `${name} missing tools`);
        assert.ok(type.tools.length > 0, `${name} has empty tools`);
        assert.ok(
          ['worktree', 'path', 'none'].includes(type.workspaceMode),
          `${name} has invalid workspaceMode: ${type.workspaceMode}`,
        );
        assert.ok(
          typeof type.timeoutMs === 'number' && type.timeoutMs > 0,
          `${name} has invalid timeoutMs: ${type.timeoutMs}`,
        );
        assert.ok(
          typeof type.blocking === 'boolean',
          `${name} missing blocking flag`,
        );
        assert.ok(
          typeof type.agentCanSpawn === 'boolean',
          `${name} missing agentCanSpawn flag`,
        );
        assert.ok(
          typeof type.promptTemplate === 'string',
          `${name} missing promptTemplate`,
        );
      }
    });

    it('general type has all tools', () => {
      const general = getSubagentType('general');
      assert.ok(general);
      assert.ok(general!.tools.length >= 6, 'general should have at least 6 tools');
      assert.ok(general!.tools.includes('bash'), 'general should include bash');
      assert.ok(general!.tools.includes('edit'), 'general should include edit');
      assert.ok(general!.tools.includes('write'), 'general should include write');
    });

    it('eval type has read-only tools', () => {
      const evalType = getSubagentType('eval');
      assert.ok(evalType);
      assert.ok(!evalType!.tools.includes('bash'), 'eval should not include bash');
      assert.ok(!evalType!.tools.includes('edit'), 'eval should not include edit');
      assert.ok(!evalType!.tools.includes('write'), 'eval should not include write');
    });

    it('nightly-analyst is fire-and-forget', () => {
      const analyst = getSubagentType('nightly-analyst');
      assert.ok(analyst);
      assert.equal(analyst!.blocking, false);
    });

    it('eval is blocking', () => {
      const evalType = getSubagentType('eval');
      assert.ok(evalType);
      assert.equal(evalType!.blocking, true);
    });
  });

  describe('getSubagentType', () => {
    it('returns type config for known types', () => {
      const evalType = getSubagentType('eval');
      assert.ok(evalType);
      assert.equal(evalType!.name, 'eval');
    });

    it('returns undefined for unknown types', () => {
      const unknown = getSubagentType('nonexistent');
      assert.equal(unknown, null);
    });

    it('is case-sensitive', () => {
      const upper = getSubagentType('EVAL');
      assert.equal(upper, null);
    });
  });

  describe('listSubagentTypeNames', () => {
    it('returns all type names', () => {
      const names = listSubagentTypeNames();
      assert.equal(names.length, 7);
      assert.ok(names.includes('eval'));
      assert.ok(names.includes('general'));
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 2: subagent-prompts.ts
// ---------------------------------------------------------------------------

describe('subagent-prompts', () => {
  const promptsDir = path.resolve('config/subagent-prompts');

  it('prompts directory exists', () => {
    assert.ok(fs.existsSync(promptsDir));
  });

  it('has a prompt file for each registered type', () => {
    for (const [name, type] of SUBAGENT_TYPE_REGISTRY) {
      const filePath = path.join(promptsDir, `${type.promptTemplate}.md`);
      assert.ok(fs.existsSync(filePath), `Missing prompt file: ${filePath}`);
    }
  });

  it('loadSubagentPrompt returns content for valid template', () => {
    const content = loadSubagentPrompt('eval');
    assert.ok(typeof content === 'string');
    assert.ok(content.length > 50, 'eval prompt should be substantial');
    assert.ok(content.includes('evaluat'), 'eval prompt should mention evaluation');
  });

  it('loadSubagentPrompt returns fallback for missing template', () => {
    const content = loadSubagentPrompt('nonexistent-template');
    assert.ok(typeof content === 'string');
    assert.ok(content.includes('nonexistent-template'), 'fallback should include type name');
  });

  it('each prompt file is non-empty', () => {
    for (const [name, type] of SUBAGENT_TYPE_REGISTRY) {
      const filePath = path.join(promptsDir, `${type.promptTemplate}.md`);
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.ok(content.trim().length > 0, `${name} prompt is empty`);
    }
  });

  it('each prompt mentions its purpose', () => {
    const purposeKeywords: Record<string, string[]> = {
      eval: ['skill', 'test', 'evaluat'],
      'nightly-analyst': ['farm', 'data', 'analy', 'brief'],
      'photo-analyst': ['photo', 'image', 'identif', 'pest', 'disease'],
      researcher: ['research', 'search', 'find', 'inform'],
      'compliance-auditor': ['compliance', 'audit', 'spray', 'record'],
      'data-sync': ['data', 'fetch', 'sync', 'api', 'weather'],
      general: ['task', 'general', 'tool'],
    };

    for (const [name, type] of SUBAGENT_TYPE_REGISTRY) {
      const content = loadSubagentPrompt(type.promptTemplate).toLowerCase();
      const keywords = purposeKeywords[name] ?? [];
      const hasKeyword = keywords.some((kw) => content.includes(kw));
      assert.ok(hasKeyword, `${name} prompt should mention its purpose (checked: ${keywords.join(', ')})`);
    }
  });
});
