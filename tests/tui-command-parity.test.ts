import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const tuiClientSource = readFileSync(
  path.join(root, 'src/tui/client.ts'),
  'utf8',
);
const wiringSource = readFileSync(path.join(root, 'src/wiring.ts'), 'utf8');

const tuiParityCommands = [
  'reflect',
  'models',
  'refresh_models',
  'title',
  'run',
  'run_status',
  'cancel_run',
  'coder_plan',
];

test('TUI lists operator commands that have Telegram command parity', () => {
  for (const command of tuiParityCommands) {
    assert.match(
      tuiClientSource,
      new RegExp(`\\{ name: '${command}'`),
      `missing /${command} from TUI slash command registry`,
    );
    assert.match(
      tuiClientSource,
      new RegExp(`/${command.replace('_', '[_-]')}`),
      `missing /${command} from TUI help text`,
    );
  }
});

test('TUI bridges operator command parity set to the runtime', () => {
  for (const command of tuiParityCommands) {
    assert.match(
      tuiClientSource,
      new RegExp(`case '${command.replace('_', '[-_]')}':`),
      `missing /${command} operator bridge case`,
    );
  }

  assert.match(wiringSource, /normalized === 'reflect'/);
  assert.match(wiringSource, /normalized === 'coder_plan'/);
  assert.match(wiringSource, /normalized === 'refresh_models'/);
  assert.match(wiringSource, /normalized === 'run_status'/);
  assert.match(wiringSource, /normalized === 'cancel_run'/);
});
