import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildTelegramSetupProviderPanel } from '../src/telegram-settings.js';

function findButton(keyboard: unknown[], text: string): unknown {
  for (const row of keyboard) {
    if (!Array.isArray(row)) continue;
    for (const btn of row) {
      if (btn && typeof btn === 'object' && 'text' in btn && (btn as { text: string }).text === text) {
        return btn;
      }
    }
  }
  return undefined;
}

function findAllButtons(keyboard: unknown[]): Array<{ text: string; callbackData: string }> {
  const out: Array<{ text: string; callbackData: string }> = [];
  for (const row of keyboard) {
    if (!Array.isArray(row)) continue;
    for (const btn of row) {
      if (btn && typeof btn === 'object' && 'text' in btn && 'callbackData' in btn) {
        out.push(btn as { text: string; callbackData: string });
      }
    }
  }
  return out;
}

test('buildTelegramSetupProviderPanel shows "Set ... key" buttons for providers without keys', () => {
  // Use a tmpdir so no real .env is touched.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-setup-panel-'));
  const envFile = path.join(tmp, '.env');
  // Empty .env so no provider is configured.
  fs.writeFileSync(envFile, 'PI_API=openrouter\nPI_MODEL=cohere/north-mini-code:free\n');

  // Pass an explicit empty env so we don't depend on the host shell.
  const emptyEnv: Record<string, string | undefined> = {
    PI_API: 'openrouter',
    PI_MODEL: 'cohere/north-mini-code:free',
  };

  // We can't easily inject env into the panel without monkey-patching; the
  // panel builder reads from getRuntimeConfigEnv() which reads process.env.
  // Override the relevant keys.
  const prev = { ...process.env };
  try {
    for (const k of Object.keys(emptyEnv)) {
      process.env[k] = emptyEnv[k];
    }
    // Wipe all known provider key envs to force "key missing" state.
    for (const k of [
      'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
      'OPENROUTER_API_KEY', 'OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY',
      'ZAI_API_KEY', 'MINIMAX_API_KEY', 'MINIMAX_CN_API_KEY',
      'STEPFUN_API_KEY', 'KIMI_API_KEY', 'MOONSHOT_API_KEY',
    ]) {
      delete process.env[k];
    }
    delete process.env.PI_API_KEY;

    const panel = buildTelegramSetupProviderPanel('telegram:test');
    const buttons = findAllButtons(panel.keyboard);
    const setKeyButtons = buttons.filter((b) => b.text.startsWith('Set ') && b.text.endsWith(' key'));
    const providerButtons = buttons.filter((b) => /StepFun|Anthropic|OpenAI|Gemini|MiniMax|ZAI|OpenRouter|OpenCode|Kimi|Ollama|LM Studio/.test(b.text));

    // There must be at least one "Set ... key" button per unconfigured provider.
    assert.ok(setKeyButtons.length >= 5, `expected >=5 set-key buttons, got ${setKeyButtons.length}: ${setKeyButtons.map((b) => b.text).join(', ')}`);

    // Provider buttons should mark unconfigured ones with "- set key".
    const stepfun = providerButtons.find((b) => /StepFun/.test(b.text));
    assert.ok(stepfun, 'expected a StepFun provider button');
    assert.ok(
      /set key/.test(stepfun!.text),
      `expected StepFun button to mark "set key", got: ${stepfun!.text}`,
    );
  } finally {
    process.env = prev;
  }
});

test('buildTelegramSetupProviderPanel omits set-key buttons for already-configured providers', () => {
  const prev = { ...process.env };
  try {
    process.env.PI_API = 'stepfun';
    process.env.PI_MODEL = 'step-3.7-flash';
    process.env.STEPFUN_API_KEY = 'sk-test';
    for (const k of [
      'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
      'OPENROUTER_API_KEY', 'OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY',
      'ZAI_API_KEY', 'MINIMAX_API_KEY', 'MINIMAX_CN_API_KEY',
      'KIMI_API_KEY', 'MOONSHOT_API_KEY',
    ]) {
      delete process.env[k];
    }
    delete process.env.PI_API_KEY;

    const panel = buildTelegramSetupProviderPanel('telegram:test');
    const buttons = findAllButtons(panel.keyboard);
    const setStepfunKey = buttons.find((b) => b.text === 'Set StepFun Step Plan key');
    assert.equal(
      setStepfunKey,
      undefined,
      'expected no Set StepFun key button when STEPFUN_API_KEY is set',
    );
    // And the provider button itself should be marked "(key set)".
    const stepfun = buttons.find((b) => /StepFun/.test(b.text));
    assert.ok(stepfun, 'expected a StepFun provider button');
    assert.ok(
      /key set/.test(stepfun!.text),
      `expected StepFun button to mark "key set", got: ${stepfun!.text}`,
    );
  } finally {
    process.env = prev;
  }
});
