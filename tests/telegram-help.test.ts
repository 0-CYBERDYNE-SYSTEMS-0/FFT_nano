import { test } from 'node:test';
import * as assert from 'node:assert';
import { formatHelpText } from '../src/telegram-command-spec.js';

test('formatHelpText - default help (non-main group)', () => {
  const result = formatHelpText(false, 'default');
  assert.match(result, /Quick Start/);
  assert.match(result, /\/help all/);
  assert.match(result, /\/status/);
  assert.match(result, /\/settings/);
  assert.match(result, /\/title/);
  assert.match(result, /\/new/);
  assert.match(result, /\/stop/);
  assert.match(result, /\/model/);
  assert.match(result, /\/usage/);
  assert.match(result, /Admin commands are only available in the main chat/);
  assert.doesNotMatch(result, /worktree/);
  assert.doesNotMatch(result, /subagent/);
});

test('formatHelpText - default help (main group)', () => {
  const result = formatHelpText(true, 'default');
  assert.match(result, /Quick Start/);
  assert.match(result, /\/help all/);
  assert.match(result, /\/help admin/);
  assert.doesNotMatch(result, /worktree/);
  assert.doesNotMatch(result, /subagent/);
});

test('formatHelpText - all commands (non-main group)', () => {
  const result = formatHelpText(false, 'all');
  assert.match(result, /All Commands/);
  assert.match(result, /\/help/);
  assert.match(result, /\/status/);
  assert.match(result, /\/settings/);
  assert.match(result, /\/title/);
  assert.match(result, /\/new/);
  assert.match(result, /\/stop/);
  assert.match(result, /\/model/);
  assert.match(result, /\/usage/);
  assert.match(result, /\/id/);
  assert.match(result, /\/models/);
  assert.match(result, /\/think/);
  assert.match(result, /Admin commands are only available in the main chat/);
});

test('formatHelpText - all commands (main group)', () => {
  const result = formatHelpText(true, 'all');
  assert.match(result, /All Commands/);
  assert.match(result, /Admin Commands/);
  assert.match(result, /\/help/);
  assert.match(result, /\/status/);
  assert.match(result, /\/task/);
  assert.match(result, /\/coder/);
  assert.match(result, /For quick start/);
});

test('formatHelpText - admin commands (non-main group)', () => {
  const result = formatHelpText(false, 'admin');
  assert.match(result, /Admin commands are only available/);
});

test('formatHelpText - admin commands (main group)', () => {
  const result = formatHelpText(true, 'admin');
  assert.match(result, /Admin Commands/);
  assert.match(result, /\/main/);
  assert.match(result, /\/gateway/);
  assert.match(result, /\/setup/);
  assert.match(result, /\/tasks/);
  assert.match(result, /\/knowledge/);
  assert.match(result, /\/coder/);
  assert.match(result, /\/subagent/);
  assert.match(result, /\/run/);
  assert.match(result, /For basic commands: \/help/);
  assert.match(result, /For the full command list: \/help all/);
});

test('formatHelpText - default help has fewer commands than all', () => {
  const defaultResult = formatHelpText(true, 'default');
  const allResult = formatHelpText(true, 'all');
  const defaultCount = (defaultResult.match(/^\s*\/\w+/gm) || []).length;
  const allCount = (allResult.match(/^\s*\/\w+/gm) || []).length;
  assert.ok(
    defaultCount < allCount,
    `default help (${defaultCount} commands) should have fewer than all help (${allCount} commands)`,
  );
});

test('formatHelpText - default help is farmer-friendly (no technical jargon)', () => {
  const defaultResult = formatHelpText(true, 'default');
  assert.doesNotMatch(
    defaultResult,
    /worktree|subagent|runtime provider|delegated|durable/,
    'default help should not contain technical jargon',
  );
});
