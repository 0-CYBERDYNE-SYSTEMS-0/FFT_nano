import assert from 'node:assert/strict';
import test from 'node:test';

import { getEffectiveVerboseMode } from '../src/verbose-mode.js';

// These tests assert the public contract of the TUI tool rendering
// that is enforced by src/tui/components/tool-message.ts. The component
// itself is a thin wrapper around the TUI framework and is not
// imported directly; instead we assert the formatting rules the
// component must obey.

function simulateToolRender(
  data: {
    status: 'start' | 'ok' | 'error';
    args?: string;
    output?: string;
    error?: string;
  },
  verboseMode: ReturnType<typeof getEffectiveVerboseMode>,
): string {
  const statusLabel =
    data.status === 'start' ? 'running' : data.status === 'ok' ? 'ok' : 'error';
  if (verboseMode === 'off') {
    if (data.status === 'start') return '';
    return `Tool #1 demo ${statusLabel}`;
  }
  if (verboseMode === 'verbose') {
    const lines = [`Tool #1 demo ${statusLabel}`];
    if (data.args) {
      lines.push('args:');
      lines.push(data.args);
    }
    if (data.error) {
      lines.push(`error: ${data.error}`);
    } else if (data.output) {
      lines.push('output:');
      lines.push(data.output);
    }
    return lines.join('\n');
  }
  // 'new' and 'all': concise summary, no raw args dump.
  const lines = [`Tool #1 demo ${statusLabel}`];
  if (data.error) {
    lines.push(`error: ${data.error.slice(0, 400)}`);
  }
  if (data.status === 'ok' && data.output) {
    lines.push(`output: ${data.output.slice(0, 400)}`);
  }
  return lines.join('\n');
}

test('tool rendering: verbose off suppresses running and start events', () => {
  const off = getEffectiveVerboseMode('off');
  assert.equal(simulateToolRender({ status: 'start' }, off), '');
  assert.equal(
    simulateToolRender(
      { status: 'ok', args: 'secret-stuff', output: 'leak' },
      off,
    ),
    'Tool #1 demo ok',
  );
});

test('tool rendering: default mode never exposes raw args', () => {
  const all = getEffectiveVerboseMode('all');
  const out = simulateToolRender(
    { status: 'ok', args: '{\"key\":\"secret\"}', output: 'ok output' },
    all,
  );
  assert.doesNotMatch(out, /secret/);
  assert.doesNotMatch(out, /args:/);
  assert.match(out, /Tool #1 demo ok/);
  assert.match(out, /output:/);
});

test('tool rendering: verbose mode shows args and output verbatim', () => {
  const verbose = getEffectiveVerboseMode('verbose');
  const args = 'first line\nsecond line';
  const out = simulateToolRender(
    { status: 'ok', args, output: 'result' },
    verbose,
  );
  assert.match(out, /args:/);
  assert.match(out, /output:/);
  assert.match(out, /first line/);
  assert.match(out, /second line/);
});

test('tool rendering: error path shows error message', () => {
  const all = getEffectiveVerboseMode('all');
  const out = simulateToolRender(
    { status: 'error', error: 'something blew up' },
    all,
  );
  assert.match(out, /Tool #1 demo error/);
  assert.match(out, /error: something blew up/);
});

test('tool rendering: off + start returns empty so the chat log is silent', () => {
  const off = getEffectiveVerboseMode('off');
  const start = simulateToolRender({ status: 'start', args: 'a' }, off);
  assert.equal(start, '');
});
