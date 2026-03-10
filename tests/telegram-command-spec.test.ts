import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatHelpText,
  normalizeTelegramCommandToken,
  TELEGRAM_ADMIN_COMMANDS,
  TELEGRAM_COMMON_COMMANDS,
} from '../src/telegram-command-spec.js';

test('every registered Telegram menu command normalizes from slash syntax', () => {
  const registered = [...TELEGRAM_COMMON_COMMANDS, ...TELEGRAM_ADMIN_COMMANDS];
  for (const command of registered) {
    const token = `/${command.command}`;
    assert.equal(normalizeTelegramCommandToken(token), token);
  }
});

test('Telegram command normalization accepts aliases and bot-suffixed forms', () => {
  assert.equal(normalizeTelegramCommandToken('/restart@TestBot'), '/restart');
  assert.equal(normalizeTelegramCommandToken('/gateway:restart'), '/gateway');
  assert.equal(normalizeTelegramCommandToken('/coder-plan@TestBot'), '/coder-plan');
  assert.equal(normalizeTelegramCommandToken('/t'), '/t');
  assert.equal(normalizeTelegramCommandToken('/reason'), '/reason');
});

test('main chat help includes admin restart alias and non-main help does not', () => {
  const mainHelp = formatHelpText(true);
  const nonMainHelp = formatHelpText(false);

  assert.match(mainHelp, /\/restart - alias for \/gateway restart/);
  assert.match(mainHelp, /\/setup \[cancel\] - runtime setup wizard for provider\/model\/key/);
  assert.doesNotMatch(nonMainHelp, /\/restart - alias for \/gateway restart/);
  assert.match(nonMainHelp, /Admin commands are only available in the main chat/);
});
