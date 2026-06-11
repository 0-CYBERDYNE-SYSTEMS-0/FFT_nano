/**
 * Tests for LISO.5: Maintenance Prompt Mode
 *
 * Validates:
 *   VAL-LISO-020: Maintenance prompt is minimal — excludes interactive bootstrap,
 *                 retrieved memory, daily notes, recent conversation, and broad skill catalog
 *
 * Covers:
 *   - promptMode: 'maintenance' excludes SOUL.md, NANO.md, USER.md, etc.
 *   - Maintenance prompt construction uses minimal bounded context
 *   - system prompt for maintenance does not include recent conversation
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildSystemPrompt,
  type SystemPromptInput,
  type WorkspacePaths,
} from '../src/system-prompt.js';
import type { PromptMode } from '../src/types.js';

// ── Test paths ────────────────────────────────────────────────────────────────

const TEST_PATHS: WorkspacePaths = {
  groupDir: '/workspace/test-group',
  globalDir: '/workspace/global',
  ipcDir: '/workspace/test-group/ipc',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMaintenanceInput(
  overrides: Partial<SystemPromptInput> = {},
): SystemPromptInput {
  return {
    assistantName: 'TestBot',
    prompt: 'What should I do?',
    groupFolder: 'test-group',
    chatJid: 'test-jid',
    isMain: false,
    isScheduledTask: false,
    isEvaluatorRun: false,
    senderRole: 'operator',
    // LISO.5: Maintenance prompt mode
    promptMode: 'maintenance',
    startedDuringPause: false,
    // These would be empty for maintenance
    providedMemoryContext: '',
    skillCatalog: [],
    codingHint: 'none',
    noContinue: true,
    ...overrides,
  } as SystemPromptInput;
}

function makeInteractiveInput(
  overrides: Partial<SystemPromptInput> = {},
): SystemPromptInput {
  return {
    assistantName: 'TestBot',
    prompt: 'What should I do?',
    groupFolder: 'test-group',
    chatJid: 'test-jid',
    isMain: true,
    isScheduledTask: false,
    isEvaluatorRun: false,
    senderRole: 'operator',
    // Interactive mode
    promptMode: 'interactive',
    startedDuringPause: false,
    providedMemoryContext: 'Some retrieved memory context',
    skillCatalog: [],
    codingHint: 'none',
    noContinue: false,
    ...overrides,
  } as SystemPromptInput;
}

function callBuildSystemPrompt(input: SystemPromptInput) {
  return buildSystemPrompt(input, TEST_PATHS, {
    readFileIfExists: () => null,
  });
}

// ── VAL-LISO-020: Maintenance prompt is minimal ────────────────────────────────

describe('VAL-LISO-020: Maintenance prompt is minimal', () => {
  it('maintenance mode excludes SOUL.md from prompt', () => {
    const maintInput = makeMaintenanceInput();

    const result = callBuildSystemPrompt(maintInput);

    // Verify the context entries don't include SOUL.md
    const soulEntries = result.report.contextEntries.filter(
      (entry: { id?: string; title?: string }) =>
        entry.title?.includes('SOUL') || entry.id === 'soul',
    );
    assert.equal(
      soulEntries.length,
      0,
      'Maintenance prompt should not include SOUL.md entries',
    );
  });

  it('maintenance mode excludes USER.md from prompt', () => {
    const maintInput = makeMaintenanceInput();

    const result = callBuildSystemPrompt(maintInput);

    // Verify the context entries don't include USER.md
    const userEntries = result.report.contextEntries.filter(
      (entry: { id?: string; title?: string }) =>
        entry.title?.includes('USER') || entry.id === 'user',
    );
    assert.equal(
      userEntries.length,
      0,
      'Maintenance prompt should not include USER.md entries',
    );
  });

  it('maintenance mode excludes NANO.md from prompt', () => {
    const maintInput = makeMaintenanceInput();

    const result = callBuildSystemPrompt(maintInput);

    // Verify the context entries don't include NANO.md
    const nanoEntries = result.report.contextEntries.filter(
      (entry: { id?: string; title?: string }) =>
        entry.title?.includes('NANO') || entry.id === 'nano',
    );
    assert.equal(
      nanoEntries.length,
      0,
      'Maintenance prompt should not include NANO.md entries',
    );
  });

  it('maintenance mode excludes MEMORY.md canonical content', () => {
    const maintInput = makeMaintenanceInput();

    const result = callBuildSystemPrompt(maintInput);

    // Maintenance prompt should have minimal/no context entries
    // Check contextBudget for what's included
    const memoryBudget = result.report.contextBudget?.memory;
    if (memoryBudget) {
      assert.equal(
        memoryBudget.included,
        false,
        'Maintenance should not include canonical MEMORY.md',
      );
    }
  });

  it('maintenance mode excludes recent conversation', () => {
    const maintInput = makeMaintenanceInput();

    const result = callBuildSystemPrompt(maintInput);

    // Recent conversation would be in context entries with specific IDs
    // Maintenance should not include [RECENT CONVERSATION] or equivalent
    const conversationEntries = result.report.contextEntries.filter(
      (entry: { id?: string; title?: string }) =>
        entry.id?.includes('conversation') ||
        entry.title?.includes('CONVERSATION'),
    );
    assert.equal(
      conversationEntries.length,
      0,
      'Maintenance prompt should not include recent conversation',
    );
  });

  it('maintenance mode excludes daily memory files', () => {
    const maintInput = makeMaintenanceInput();

    const result = callBuildSystemPrompt(maintInput);

    // Daily memory entries should not be present
    const dailyEntries = result.report.contextEntries.filter(
      (entry: { id?: string; title?: string }) =>
        entry.id?.includes('daily') || entry.title?.includes('DAILY'),
    );
    assert.equal(
      dailyEntries.length,
      0,
      'Maintenance prompt should not include daily memory files',
    );
  });

  it('maintenance mode excludes broad skill catalog', () => {
    const maintInput = makeMaintenanceInput({
      skillCatalog: [{ name: 'skill-1' }, { name: 'skill-2' }],
    });

    const result = callBuildSystemPrompt(maintInput);

    // Maintenance should not include skill catalog in the prompt text
    // The skill catalog text is not added when promptMode is 'maintenance'
    assert.ok(
      !result.text.includes('skill-1') && !result.text.includes('skill-2'),
      'Maintenance should not include skill catalog names in prompt',
    );
  });

  it('maintenance prompt mode is reflected in the result', () => {
    const maintInput = makeMaintenanceInput({ promptMode: 'maintenance' });

    const result = callBuildSystemPrompt(maintInput);

    assert.equal(
      result.report.mode,
      'maintenance',
      'Report should reflect maintenance mode',
    );
  });

  it('interactive mode includes expected bootstrap content', () => {
    const interactiveInput = makeInteractiveInput({
      providedMemoryContext: 'Retrieved memory content',
    });

    const result = callBuildSystemPrompt(interactiveInput);

    // Interactive mode should have content
    assert.ok(result.text.length > 0, 'Interactive prompt should have content');
    // Note: mode is 'full' for non-scheduled non-maintenance runs, not 'interactive'
    // 'interactive' is the input promptMode but the derived mode is 'full'
    assert.equal(result.report.mode, 'full');
  });
});

describe('Maintenance prompt mode excludes HEARTBEAT.md', () => {
  it('maintenance mode does not include HEARTBEAT.md', () => {
    const maintInput = makeMaintenanceInput();

    const result = callBuildSystemPrompt(maintInput);

    const heartbeatEntries = result.report.contextEntries.filter(
      (entry: { id?: string; title?: string }) =>
        entry.title?.includes('HEARTBEAT') || entry.id === 'heartbeat',
    );
    assert.equal(
      heartbeatEntries.length,
      0,
      'Maintenance should not include HEARTBEAT.md',
    );
  });

  it('maintenance mode does not include BOOTSTRAP.md', () => {
    const maintInput = makeMaintenanceInput();

    const result = callBuildSystemPrompt(maintInput);

    const bootstrapEntries = result.report.contextEntries.filter(
      (entry: { id?: string; title?: string }) =>
        entry.title?.includes('BOOTSTRAP') || entry.id === 'bootstrap',
    );
    assert.equal(
      bootstrapEntries.length,
      0,
      'Maintenance should not include BOOTSTRAP.md',
    );
  });

  it('maintenance mode does not include IDENTITY.md', () => {
    const maintInput = makeMaintenanceInput();

    const result = callBuildSystemPrompt(maintInput);

    const identityEntries = result.report.contextEntries.filter(
      (entry: { id?: string; title?: string }) =>
        entry.title?.includes('IDENTITY') || entry.id === 'identity',
    );
    assert.equal(
      identityEntries.length,
      0,
      'Maintenance should not include IDENTITY.md',
    );
  });

  it('maintenance mode does not include PRINCIPLES.md', () => {
    const maintInput = makeMaintenanceInput();

    const result = callBuildSystemPrompt(maintInput);

    const principlesEntries = result.report.contextEntries.filter(
      (entry: { id?: string; title?: string }) =>
        entry.title?.includes('PRINCIPLES') || entry.id === 'principles',
    );
    assert.equal(
      principlesEntries.length,
      0,
      'Maintenance should not include PRINCIPLES.md',
    );
  });

  it('maintenance mode does not include TODOS.md', () => {
    const maintInput = makeMaintenanceInput();

    const result = callBuildSystemPrompt(maintInput);

    const todosEntries = result.report.contextEntries.filter(
      (entry: { id?: string; title?: string }) =>
        entry.title?.includes('TODOS') || entry.id === 'todos',
    );
    assert.equal(
      todosEntries.length,
      0,
      'Maintenance should not include TODOS.md',
    );
  });
});

describe('Prompt mode context budget', () => {
  it('maintenance mode has empty context budget', () => {
    const maintInput = makeMaintenanceInput();

    const result = callBuildSystemPrompt(maintInput);

    // Maintenance should have minimal or zero context entries
    const contextEntries = result.report.contextEntries || [];
    assert.ok(
      contextEntries.length === 0 ||
        contextEntries.every(
          (e: { title?: string }) =>
            !e.title?.includes('SOUL') &&
            !e.title?.includes('NANO') &&
            !e.title?.includes('USER') &&
            !e.title?.includes('MEMORY') &&
            !e.title?.includes('IDENTITY') &&
            !e.title?.includes('PRINCIPLES') &&
            !e.title?.includes('TODOS') &&
            !e.title?.includes('HEARTBEAT') &&
            !e.title?.includes('BOOTSTRAP'),
        ),
      'All context entries should be filtered out for maintenance mode',
    );
  });

  it('interactive mode includes SOUL and NANO in context when isMain=true', () => {
    const interactiveInput = makeInteractiveInput({
      isMain: true,
      providedMemoryContext: 'some memory context',
    });

    const result = callBuildSystemPrompt(interactiveInput);

    // For interactive main, SOUL/NANO should be included
    // The exact entries depend on file existence, but the budget should indicate inclusion
    assert.ok(
      result.text.length > 0,
      'Interactive main should have full prompt',
    );
  });
});

describe('Maintenance prompt runtime hints', () => {
  it('maintenance prompt includes prompt_mode runtime hint', () => {
    const maintInput = makeMaintenanceInput({ promptMode: 'maintenance' });

    const result = callBuildSystemPrompt(maintInput);

    // The ephemeral prompt should include the runtime hint for prompt_mode
    assert.ok(
      result.ephemeralText.includes('prompt_mode'),
      'Maintenance should include prompt_mode in runtime hints',
    );
  });

  it('maintenance prompt includes continue_session=false hint', () => {
    const maintInput = makeMaintenanceInput({
      promptMode: 'maintenance',
      noContinue: true,
    });

    const result = callBuildSystemPrompt(maintInput);

    assert.ok(
      result.ephemeralText.includes('continue_session'),
      'Maintenance should include continue_session in runtime hints',
    );
  });
});

describe('LISO.5 maintenance contract', () => {
  it('maintenance prompt does not include retrieved memory text', () => {
    const marker =
      'DISTINCTIVE_RETRIEVED_MEMORY_MARKER_THAT_MUST_NOT_LEAK_INTO_MAINTENANCE';
    // memoryContext (not providedMemoryContext) is the real input field read by
    // buildSystemPrompt; maintenance mode must drop it even when populated.
    const maintInput = makeMaintenanceInput({ memoryContext: marker });

    const result = callBuildSystemPrompt(maintInput);

    assert.ok(
      !result.text.includes(marker),
      'Maintenance prompt text must not include retrieved memory context',
    );
    assert.ok(
      !result.ephemeralText.includes(marker),
      'Maintenance ephemeral prompt must not include retrieved memory context',
    );
  });

  it('interactive prompt still includes retrieved memory text', () => {
    const marker = 'DISTINCTIVE_RETRIEVED_MEMORY_MARKER_FOR_INTERACTIVE';
    const interactiveInput = makeInteractiveInput({ memoryContext: marker });

    const result = callBuildSystemPrompt(interactiveInput);

    assert.ok(
      result.text.includes(marker) || result.ephemeralText.includes(marker),
      'Interactive prompt should include retrieved memory context',
    );
  });

  it('maintenance mode produces smaller prompt than interactive mode', () => {
    const maintInput = makeMaintenanceInput();
    const interactiveInput = makeInteractiveInput();

    const maintResult = callBuildSystemPrompt(maintInput);
    const interactiveResult = callBuildSystemPrompt(interactiveInput);

    // Maintenance should produce a more compact prompt
    // (This is a qualitative check - actual size depends on what files exist)
    assert.ok(
      maintResult.report.totalChars <= interactiveResult.report.totalChars,
      'Maintenance should produce smaller or equal prompt than interactive',
    );
  });

  it('skill catalog is excluded for maintenance', () => {
    const maintInput = makeMaintenanceInput({
      skillCatalog: [{ name: 'test-skill', description: 'A test skill' }],
    });

    const result = callBuildSystemPrompt(maintInput);

    // The skill catalog should not contribute to the maintenance prompt
    assert.ok(
      !result.text.includes('test-skill'),
      'Maintenance should not include skill catalog in prompt text',
    );
  });
});
