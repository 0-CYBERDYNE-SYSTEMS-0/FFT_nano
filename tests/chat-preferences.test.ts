import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatRunPreferences, ChatUsageStats } from '../src/app-state.js';
import {
  formatUsageText,
  getEffectiveModelLabel,
  normalizeTelegramDeliveryMode,
  normalizeThinkLevel,
  parseQueueArgs,
  patchTuiSessionPrefs,
  updateChatRunPreferences,
  updateChatUsage,
} from '../src/chat-preferences.js';

function createRuntime() {
  const chatRunPreferences: Record<string, ChatRunPreferences> = {};
  const chatUsageStats: Record<string, ChatUsageStats> = {};
  let saves = 0;
  return {
    chatRunPreferences,
    chatUsageStats,
    saveState: () => {
      saves += 1;
    },
    getSaveCount: () => saves,
    defaultProvider: 'zai',
    defaultModel: 'glm-4.7',
  };
}

test('normalizeThinkLevel maps aliases', () => {
  assert.equal(normalizeThinkLevel('enabled'), 'low');
  assert.equal(normalizeThinkLevel('med'), 'medium');
  assert.equal(normalizeThinkLevel('x_high'), 'xhigh');
  assert.equal(normalizeThinkLevel(''), undefined);
});

test('normalizeTelegramDeliveryMode maps supported values', () => {
  assert.equal(normalizeTelegramDeliveryMode('off'), 'off');
  assert.equal(normalizeTelegramDeliveryMode('partial'), 'partial');
  assert.equal(normalizeTelegramDeliveryMode('block'), 'block');
  assert.equal(normalizeTelegramDeliveryMode('draft'), 'draft');
  assert.equal(normalizeTelegramDeliveryMode('native'), 'draft');
  assert.equal(normalizeTelegramDeliveryMode('progress'), 'partial');
  assert.equal(normalizeTelegramDeliveryMode('live'), 'partial');
  assert.equal(normalizeTelegramDeliveryMode('persistent'), 'persistent');
  assert.equal(normalizeTelegramDeliveryMode('final'), 'off');
  assert.equal(normalizeTelegramDeliveryMode(''), undefined);
});

test('parseQueueArgs parses explicit values and reset', () => {
  assert.deepEqual(parseQueueArgs('mode=followup debounce=2s cap=20 drop=summarize'), {
    mode: 'followup',
    debounceMs: 2000,
    cap: 20,
    drop: 'summarize',
    reset: false,
  });
  assert.deepEqual(parseQueueArgs('reset'), { reset: true });
});

test('updateChatRunPreferences compacts defaults and persists', () => {
  const runtime = createRuntime();

  const next = updateChatRunPreferences(runtime, 'telegram:1', (prefs) => {
    prefs.provider = ' openai ';
    prefs.model = ' gpt-5.4 ';
    prefs.telegramDeliveryMode = 'partial';
    return prefs;
  });

  assert.deepEqual(next, {
    provider: 'openai',
    model: 'gpt-5.4',
  });
  assert.equal(runtime.getSaveCount(), 1);

  const persisted = updateChatRunPreferences(runtime, 'telegram:1', (prefs) => {
    prefs.telegramDeliveryMode = 'persistent';
    prefs.queueMode = 'collect';
    prefs.queueDrop = 'old';
    prefs.nextRunNoContinue = true;
    return prefs;
  });

  assert.deepEqual(persisted, {
    provider: 'openai',
    model: 'gpt-5.4',
    telegramDeliveryMode: 'persistent',
    nextRunNoContinue: true,
  });
  assert.equal(runtime.getSaveCount(), 2);

  const offMode = updateChatRunPreferences(runtime, 'telegram:1', (prefs) => {
    prefs.telegramDeliveryMode = 'off';
    return prefs;
  });

  assert.equal(offMode.telegramDeliveryMode, 'off');
  assert.equal(runtime.getSaveCount(), 3);

  updateChatRunPreferences(runtime, 'telegram:1', (prefs) => {
    delete prefs.provider;
    delete prefs.model;
    delete prefs.telegramDeliveryMode;
    delete prefs.nextRunNoContinue;
    return prefs;
  });

  assert.equal(runtime.chatRunPreferences['telegram:1'], undefined);
  assert.equal(runtime.getSaveCount(), 4);
});

test('getEffectiveModelLabel falls back to configured defaults', () => {
  const runtime = createRuntime();
  runtime.chatRunPreferences['telegram:2'] = {
    provider: 'openai',
    model: 'gpt-5.5',
  };

  assert.equal(getEffectiveModelLabel(runtime, 'telegram:2'), 'openai/gpt-5.5');
  assert.equal(getEffectiveModelLabel(runtime, 'telegram:missing'), 'zai/glm-4.7');
});

test('updateChatUsage aggregates counts and formatUsageText reports totals', () => {
  const runtime = createRuntime();

  updateChatUsage(
    runtime,
    'telegram:1',
    {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      provider: 'zai',
      model: 'glm-4.7',
    },
    1_700_000_000_000,
  );

  updateChatUsage(runtime, 'telegram:1', undefined, 1_700_000_001_000);

  assert.match(formatUsageText(runtime, 'telegram:1'), /- runs: 2/);
  assert.match(formatUsageText(runtime, 'telegram:1'), /- total_tokens: 15/);
  assert.match(formatUsageText(runtime, 'telegram:1'), /- last_model: zai\/glm-4.7/);
  assert.match(formatUsageText(runtime, 'telegram:1', 'all'), /Usage \(all chats\):/);
});

test('patchTuiSessionPrefs keeps preview reasoning in sync with reasoningLevel', () => {
  const runtime = createRuntime();

  patchTuiSessionPrefs(runtime, 'telegram:1', { reasoningLevel: 'stream' });
  assert.equal(runtime.chatRunPreferences['telegram:1']?.reasoningLevel, 'stream');
  assert.equal(runtime.chatRunPreferences['telegram:1']?.showReasoning, true);

  patchTuiSessionPrefs(runtime, 'telegram:1', { reasoningLevel: 'on' });
  assert.equal(runtime.chatRunPreferences['telegram:1']?.reasoningLevel, 'on');
  assert.equal(runtime.chatRunPreferences['telegram:1']?.showReasoning, undefined);
});
