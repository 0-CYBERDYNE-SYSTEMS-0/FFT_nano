import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTelegramSetupModelPanel } from '../src/telegram-settings.js';

test('StepFun setup model panel keeps API key and custom model controls available when model discovery is unavailable', () => {
  const previousPiPath = process.env.PI_PATH;
  process.env.PI_PATH = '/not-a-real-pi-executable';
  try {
    const panel = buildTelegramSetupModelPanel('telegram:stepfun-test', 'stepfun');
    const buttons = panel.keyboard.flat().map((button) => button.text);

    assert.match(panel.text, /Model picker error/);
    assert.ok(buttons.includes('API Key'));
    assert.ok(buttons.includes('Add Model ID'));
  } finally {
    if (previousPiPath === undefined) delete process.env.PI_PATH;
    else process.env.PI_PATH = previousPiPath;
  }
});
