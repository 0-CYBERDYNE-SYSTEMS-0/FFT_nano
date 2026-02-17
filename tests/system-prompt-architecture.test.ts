import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSystemPrompt,
  type SystemPromptInput,
} from '../container/agent-runner/src/system-prompt.ts';

function makeInput(overrides: Partial<SystemPromptInput> = {}): SystemPromptInput {
  return {
    groupFolder: 'main',
    chatJid: 'telegram:12345',
    isMain: true,
    codingHint: 'auto',
    ...overrides,
  };
}

test('buildSystemPrompt injects trusted metadata, overlay, and bootstrap context files for main runs', () => {
  const files = new Map<string, string>([
    ['/workspace/group/AGENTS.md', '# AGENTS\n'],
    ['/workspace/group/SOUL.md', '# SOUL\n'],
    ['/workspace/group/USER.md', '# USER\n'],
    ['/workspace/group/IDENTITY.md', '# IDENTITY\n'],
    ['/workspace/group/PRINCIPLES.md', '# PRINCIPLES\n'],
    ['/workspace/group/TOOLS.md', '# TOOLS\n'],
    ['/workspace/group/HEARTBEAT.md', '# HEARTBEAT\n'],
    ['/workspace/group/BOOTSTRAP.md', '# BOOTSTRAP\n'],
    ['/workspace/group/MEMORY.md', '# MEMORY\n'],
    ['/workspace/group/memory/2026-02-17.md', 'today memory'],
    ['/workspace/group/memory/2026-02-16.md', 'yesterday memory'],
  ]);

  const { text, report } = buildSystemPrompt(
    makeInput({
      requestId: 'req-123',
      extraSystemPrompt: 'Injected host overlay.',
    }),
    {
      delegationExtensionAvailable: true,
      now: () => new Date('2026-02-17T12:00:00.000Z'),
      readFileIfExists: (filePath) => files.get(filePath) ?? null,
    },
  );

  assert.equal(report.mode, 'full');
  assert.match(text, /## Inbound Context \(trusted metadata\)/);
  assert.match(text, /## Host Context Overlay/);
  assert.match(text, /## \/workspace\/group\/BOOTSTRAP\.md/);
  assert.ok(
    report.contextEntries.some(
      (entry) => entry.path === '/workspace/group/BOOTSTRAP.md' && !entry.missing,
    ),
  );
});

test('buildSystemPrompt enforces per-file and total prompt budgets', () => {
  const giant = 'A'.repeat(10_000);
  const { text, report } = buildSystemPrompt(makeInput(), {
    now: () => new Date('2026-02-17T00:00:00.000Z'),
    fileMaxChars: 256,
    totalMaxChars: 600,
    readFileIfExists: (filePath) => {
      if (filePath === '/workspace/group/AGENTS.md') return giant;
      if (filePath === '/workspace/group/MEMORY.md') return giant;
      return null;
    },
  });

  assert.ok(report.contextBudget.injectedTotalChars <= 600);
  assert.ok(report.contextEntries.some((entry) => entry.truncated));
  assert.match(text, /truncated to 256 chars/);
});

test('buildSystemPrompt uses minimal mode for scheduled runs and truncates retrieved memory context', () => {
  const { text, report } = buildSystemPrompt(
    makeInput({
      isScheduledTask: true,
      memoryContext: 'x'.repeat(30_000),
      codingHint: 'none',
    }),
    {
      readFileIfExists: () => null,
    },
  );

  assert.equal(report.mode, 'minimal');
  assert.match(text, /- prompt_mode: minimal/);
  assert.match(text, /retrieved memory context truncated to 20000 chars/);
});

test('buildSystemPrompt loads non-main SOUL and MEMORY fallbacks when retrieval context is absent', () => {
  const files = new Map<string, string>([
    ['/workspace/global/SOUL.md', 'global soul'],
    ['/workspace/group/SOUL.md', 'group soul'],
    ['/workspace/global/MEMORY.md', 'global memory'],
    ['/workspace/group/MEMORY.md', 'group memory'],
  ]);

  const { text, report } = buildSystemPrompt(
    makeInput({
      isMain: false,
      groupFolder: 'telegram-123',
      codingHint: 'none',
    }),
    {
      readFileIfExists: (filePath) => files.get(filePath) ?? null,
    },
  );

  assert.equal(report.mode, 'full');
  assert.match(text, /## \/workspace\/global\/SOUL\.md/);
  assert.match(text, /## \/workspace\/group\/SOUL\.md/);
  assert.match(text, /## \/workspace\/global\/MEMORY\.md/);
  assert.match(text, /## \/workspace\/group\/MEMORY\.md/);
});
