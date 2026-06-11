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

test('registered Telegram menu commands use Bot API-safe command names', () => {
  const registered = [...TELEGRAM_COMMON_COMMANDS, ...TELEGRAM_ADMIN_COMMANDS];
  for (const command of registered) {
    assert.match(command.command, /^[a-z0-9_]{1,32}$/);
  }
});

test('Telegram command normalization accepts aliases and bot-suffixed forms', () => {
  assert.equal(normalizeTelegramCommandToken('/restart@TestBot'), '/restart');
  assert.equal(normalizeTelegramCommandToken('/gateway:restart'), '/gateway');
  assert.equal(
    normalizeTelegramCommandToken('/coder-plan@TestBot'),
    '/coder-plan',
  );
  assert.equal(
    normalizeTelegramCommandToken('/skill-manager@TestBot'),
    '/skill-manager',
  );
  assert.equal(
    normalizeTelegramCommandToken('/skill_manager@TestBot'),
    '/skill_manager',
  );
  assert.equal(normalizeTelegramCommandToken('/curator@TestBot'), '/curator');
  assert.equal(normalizeTelegramCommandToken('/coding@TestBot'), '/coding');
  assert.equal(normalizeTelegramCommandToken('/run@TestBot'), '/run');
  assert.equal(
    normalizeTelegramCommandToken('/run-status@TestBot'),
    '/run-status',
  );
  assert.equal(
    normalizeTelegramCommandToken('/cancel_run@TestBot'),
    '/cancel_run',
  );
  assert.equal(normalizeTelegramCommandToken('/delivery@TestBot'), '/delivery');
  assert.equal(
    normalizeTelegramCommandToken('/text_delivery@TestBot'),
    '/text_delivery',
  );
  assert.equal(normalizeTelegramCommandToken('/t'), '/t');
  assert.equal(normalizeTelegramCommandToken('/reason'), '/reason');
});

test('main chat help includes admin restart alias and non-main help does not', () => {
  const mainHelp = formatHelpText(true);
  const nonMainHelp = formatHelpText(false);

  assert.match(mainHelp, /\/delivery \[stream\|append\|off\|draft\]/);
  assert.match(nonMainHelp, /\/delivery \[stream\|append\|off\|draft\]/);
  assert.match(
    mainHelp,
    /\/knowledge \[status\|init\|task\|ingest\|lint\|run\|dry-run\|log\|progress\] - knowledge wiki controls/,
  );
  assert.doesNotMatch(nonMainHelp, /\/knowledge \[/);
  assert.match(mainHelp, /\/restart - alias for \/gateway restart/);
  assert.match(
    mainHelp,
    /\/run <task> - start a durable long normal-agent run/,
  );
  assert.match(mainHelp, /\/run_status <id> - show long run status/);
  assert.match(
    mainHelp,
    /\/setup \[cancel\] - runtime setup wizard for provider\/model\/key/,
  );
  assert.doesNotMatch(nonMainHelp, /\/restart - alias for \/gateway restart/);
  assert.match(
    nonMainHelp,
    /Admin commands are only available in the main chat/,
  );
});

test('/reflect is a registered, normalizable, main-only command', () => {
  assert.equal(normalizeTelegramCommandToken('/reflect'), '/reflect');
  assert.equal(normalizeTelegramCommandToken('/reflect@TestBot'), '/reflect');

  const mainHelp = formatHelpText(true);
  const nonMainHelp = formatHelpText(false);
  assert.match(mainHelp, /\/reflect \[dry-run\] \[focus\]/);
  assert.doesNotMatch(nonMainHelp, /\/reflect \[dry-run\]/);
});

test('VAL-WS6-007: /learning is registered in TELEGRAM_ADMIN_COMMANDS and normalizes correctly', () => {
  // Check catalog entry
  const learningEntries = TELEGRAM_ADMIN_COMMANDS.filter(
    (c) => c.command === 'learning',
  );
  assert.equal(
    learningEntries.length,
    1,
    'learning should be in TELEGRAM_ADMIN_COMMANDS',
  );
  assert.match(
    learningEntries[0].description,
    /learning/i,
    'learning command description should mention learning',
  );

  // Check normalization
  assert.equal(
    normalizeTelegramCommandToken('/learning'),
    '/learning',
    '/learning should normalize to /learning',
  );
  assert.equal(
    normalizeTelegramCommandToken('/learning@TestBot'),
    '/learning',
    '/learning@TestBot should normalize to /learning',
  );

  // Check /help text includes /learning
  const mainHelp = formatHelpText(true);
  assert.match(
    mainHelp,
    /\/learning/,
    '/learning should appear in main chat help',
  );
});
