import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OUTBOUND_DUMP_FALLBACK,
  guardOutboundAgentText,
  looksLikeFullFileDump,
} from '../src/outbound-text-guard.js';

test('allows short normal summaries', () => {
  const text =
    'Done. Wrote the prototype to /Users/me/nano/projects/foo/index.html and opened preview.';
  const result = guardOutboundAgentText(text);
  assert.equal(result.allow, true);
  assert.equal(result.text, text);
});

test('blocks tool-call markup with file body', () => {
  const text = [
    'Now I will write the page.',
    '<tool_call>',
    '<function=write>',
    '<parameter=content>',
    '<!DOCTYPE html>',
    '<html><head><style>',
    ...Array.from({ length: 80 }, (_, i) => `  .c${i} { color: #${i % 9}a${i % 9}b${i % 9}c; }`),
    '</style></head><body><div>hi</div></body></html>',
    '</parameter>',
    '</tool_call>',
  ].join('\n');
  const result = guardOutboundAgentText(text);
  assert.equal(result.allow, false);
  assert.equal(result.reason, 'tool-markup');
  assert.equal(result.text, OUTBOUND_DUMP_FALLBACK);
});

test('blocks large HTML document dumps without tool markup', () => {
  const sections = Array.from(
    { length: 40 },
    (_, i) =>
      `<section class="s${i}"><div class="wrap"><h2>Chapter ${i}</h2><p>text</p></div></section>`,
  ).join('\n');
  const text = `<!DOCTYPE html>\n<html lang="en">\n<head><style>:root{--a:#111;--b:#222;}</style></head>\n<body>\n${sections}\n</body></html>`;
  assert.equal(looksLikeFullFileDump(text), true);
  const result = guardOutboundAgentText(text);
  assert.equal(result.allow, false);
  assert.equal(result.reason, 'full-file-dump');
  assert.equal(result.text, OUTBOUND_DUMP_FALLBACK);
});

test('allows short fenced snippet', () => {
  const text = [
    'Here is the key change:',
    '```ts',
    'export const x = 1;',
    '```',
    'Path: src/foo.ts',
  ].join('\n');
  const result = guardOutboundAgentText(text);
  assert.equal(result.allow, true);
});
