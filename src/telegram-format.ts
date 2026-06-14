type FenceSpan = {
  start: number;
  end: number;
  openLine: string;
  marker: string;
  indent: string;
  info: string;
  closed: boolean;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

function parseFenceSpans(buffer: string): FenceSpan[] {
  const spans: FenceSpan[] = [];
  let open:
    | {
        start: number;
        markerChar: string;
        markerLen: number;
        openLine: string;
        marker: string;
        indent: string;
        info: string;
      }
    | undefined;

  let offset = 0;
  while (offset <= buffer.length) {
    const nextNewline = buffer.indexOf('\n', offset);
    const lineEnd = nextNewline === -1 ? buffer.length : nextNewline;
    const line = buffer.slice(offset, lineEnd);

    const match = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
    if (match) {
      const indent = match[1];
      const marker = match[2];
      const info = match[3];
      const markerChar = marker[0];
      const markerLen = marker.length;

      if (!open) {
        open = {
          start: offset,
          markerChar,
          markerLen,
          openLine: line,
          marker,
          indent,
          info,
        };
      } else if (
        open.markerChar === markerChar &&
        markerLen >= open.markerLen
      ) {
        spans.push({
          start: open.start,
          end: lineEnd,
          openLine: open.openLine,
          marker: open.marker,
          indent: open.indent,
          info: open.info,
          closed: true,
        });
        open = undefined;
      }
    }

    if (nextNewline === -1) break;
    offset = nextNewline + 1;
  }

  if (open) {
    spans.push({
      start: open.start,
      end: buffer.length,
      openLine: open.openLine,
      marker: open.marker,
      indent: open.indent,
      info: open.info,
      closed: false,
    });
  }

  return spans;
}

function findFenceSpanAt(
  spans: FenceSpan[],
  index: number,
): FenceSpan | undefined {
  return spans.find((span) => index > span.start && index < span.end);
}

function isSafeFenceBreak(spans: FenceSpan[], index: number): boolean {
  return !findFenceSpanAt(spans, index);
}

function renderInlineMarkdown(markdown: string): string {
  if (!markdown) return '';

  const codeTokens: string[] = [];
  let text = markdown.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    const idx = codeTokens.length;
    codeTokens.push(`<code>${escapeHtml(code)}</code>`);
    return `@@TGCODE${idx}@@`;
  });

  text = escapeHtml(text);

  text = text.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, label: string, href: string) => {
      const unescapedHref = href.replace(/&amp;/g, '&');
      return `<a href="${escapeHtmlAttr(unescapedHref)}">${label}</a>`;
    },
  );
  text = text.replace(/\*\*([^\n*][^*\n]*?)\*\*/g, '<b>$1</b>');
  text = text.replace(/__([^\n_][^_\n]*?)__/g, '<b>$1</b>');
  text = text.replace(/\*([^\s*][^*\n]*?)\*/g, '<i>$1</i>');
  text = text.replace(/~~([^\n~][^~\n]*?)~~/g, '<s>$1</s>');
  text = text.replace(
    /\|\|([^\n|][^|\n]*?)\|\|/g,
    '<tg-spoiler>$1</tg-spoiler>',
  );

  text = text.replace(/@@TGCODE(\d+)@@/g, (_m, rawIndex: string) => {
    const idx = Number.parseInt(rawIndex, 10);
    return Number.isFinite(idx) && codeTokens[idx] ? codeTokens[idx] : '';
  });

  return text;
}

function fenceCodeOpenTag(info: string): string {
  const lang = (info || '')
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^\w+.#-]/g, '');
  return lang ? `<pre><code class="language-${lang}">` : '<pre><code>';
}

function renderFenceCodeBlock(markdown: string, span: FenceSpan): string {
  const openTag = fenceCodeOpenTag(span.info);
  const openLineEnd = markdown.indexOf('\n', span.start);
  if (openLineEnd === -1 || openLineEnd >= span.end) {
    return `${openTag}\n</code></pre>`;
  }

  const codeStart = openLineEnd + 1;
  let codeEnd = span.end;
  if (span.closed) {
    const closeLineStart = markdown.lastIndexOf('\n', span.end - 1);
    if (closeLineStart >= codeStart) {
      codeEnd = closeLineStart + 1;
    } else {
      codeEnd = codeStart;
    }
  }

  let code = markdown.slice(codeStart, codeEnd);
  if (!code.endsWith('\n')) {
    code = `${code}\n`;
  }

  return `${openTag}${escapeHtml(code)}</code></pre>`;
}

const BLOCKQUOTE_LINE = /^\s*>\s?/;
// Long quotes collapse in Telegram clients; mark them expandable so the reader
// gets an explicit expand control instead of a silently clipped block.
const BLOCKQUOTE_EXPANDABLE_LINES = 8;
const BLOCKQUOTE_EXPANDABLE_CHARS = 400;

// Telegram has no table markup; GitHub-style pipe tables are rendered as an
// aligned monospace <pre> block so columns line up in the proportional font.
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((cell) => cell.trim());
}

function isTableDelimiterRow(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function isTableStart(lines: string[], i: number): boolean {
  return (
    i + 1 < lines.length &&
    lines[i].includes('|') &&
    isTableDelimiterRow(lines[i + 1])
  );
}

function renderTable(rows: string[][]): string {
  const [header, ...body] = rows;
  // GFM: the header row defines the column count. Extra body cells are dropped
  // and missing ones padded, so the separator never desyncs from the header.
  const cols = header.length;
  const widths = Array.from({ length: cols }, (_, c) =>
    Math.max(...rows.map((r) => (r[c] ?? '').length)),
  );
  const pad = (cell: string, c: number) => (cell ?? '').padEnd(widths[c]);
  const headerLine = header
    .map((cell, c) => pad(cell, c))
    .join(' | ')
    .trimEnd();
  const sepLine = widths.map((w) => '-'.repeat(w)).join('-+-');
  const bodyLines = body.map((row) =>
    Array.from({ length: cols }, (_, c) => pad(row[c] ?? '', c))
      .join(' | ')
      .trimEnd(),
  );
  const table = [headerLine, sepLine, ...bodyLines].join('\n');
  return `<pre>${escapeHtml(table)}</pre>`;
}

// Renders a non-fenced segment, lifting consecutive `> ` lines into Telegram
// <blockquote> elements and pipe tables into <pre> before inline formatting.
function renderBlockMarkdown(segment: string): string {
  const lines = segment.split('\n');
  const parts: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isTableStart(lines, i)) {
      const rows: string[][] = [splitTableRow(lines[i])];
      i += 2; // skip header + delimiter
      while (i < lines.length && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      parts.push(renderTable(rows));
    } else if (BLOCKQUOTE_LINE.test(lines[i])) {
      const quoteLines: string[] = [];
      while (i < lines.length && BLOCKQUOTE_LINE.test(lines[i])) {
        quoteLines.push(lines[i].replace(BLOCKQUOTE_LINE, ''));
        i++;
      }
      const inner = quoteLines.join('\n');
      const expandable =
        quoteLines.length > BLOCKQUOTE_EXPANDABLE_LINES ||
        inner.length > BLOCKQUOTE_EXPANDABLE_CHARS;
      const tag = expandable ? '<blockquote expandable>' : '<blockquote>';
      parts.push(`${tag}${renderInlineMarkdown(inner)}</blockquote>`);
    } else {
      const textLines: string[] = [];
      while (
        i < lines.length &&
        !BLOCKQUOTE_LINE.test(lines[i]) &&
        !isTableStart(lines, i)
      ) {
        textLines.push(lines[i]);
        i++;
      }
      parts.push(renderInlineMarkdown(textLines.join('\n')));
    }
  }
  return parts.join('\n');
}

export function markdownToTelegramHtml(markdown: string): string {
  const text = (markdown || '').replace(/\r\n?/g, '\n');
  if (!text) return '';

  const spans = parseFenceSpans(text);
  if (spans.length === 0) {
    return renderBlockMarkdown(text);
  }

  let out = '';
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      out += renderBlockMarkdown(text.slice(cursor, span.start));
    }
    out += renderFenceCodeBlock(text, span);
    cursor = span.end;
  }
  if (cursor < text.length) {
    out += renderBlockMarkdown(text.slice(cursor));
  }

  return out;
}

export function renderTelegramHtmlText(
  text: string,
  options: { textMode?: 'markdown' | 'html' } = {},
): string {
  if ((options.textMode || 'markdown') === 'html') return text;
  return markdownToTelegramHtml(text);
}

function stripLeadingNewlines(value: string): string {
  let i = 0;
  while (i < value.length && value[i] === '\n') i++;
  return i > 0 ? value.slice(i) : value;
}

function scanParenAwareBreakpoints(
  window: string,
  isAllowed: (index: number) => boolean = () => true,
): { lastNewline: number; lastWhitespace: number } {
  let lastNewline = -1;
  let lastWhitespace = -1;
  let depth = 0;

  for (let i = 0; i < window.length; i++) {
    if (!isAllowed(i)) continue;

    const char = window[i];
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')' && depth > 0) {
      depth -= 1;
      continue;
    }
    if (depth !== 0) continue;

    if (char === '\n') lastNewline = i;
    else if (/\s/.test(char)) lastWhitespace = i;
  }

  return { lastNewline, lastWhitespace };
}

function pickSafeBreakIndex(window: string, spans: FenceSpan[]): number {
  const { lastNewline, lastWhitespace } = scanParenAwareBreakpoints(
    window,
    (idx) => isSafeFenceBreak(spans, idx),
  );
  if (lastNewline > 0) return lastNewline;
  if (lastWhitespace > 0) return lastWhitespace;
  return -1;
}

function chunkPlainText(text: string, limit: number): string[] {
  if (!text) return [];
  if (limit <= 0) return [text];
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit);
    const { lastNewline, lastWhitespace } = scanParenAwareBreakpoints(window);
    let breakIdx = lastNewline > 0 ? lastNewline : lastWhitespace;
    if (breakIdx <= 0) breakIdx = limit;

    const rawChunk = remaining.slice(0, breakIdx);
    const chunk = rawChunk.trimEnd();
    if (chunk.length > 0) chunks.push(chunk);

    const brokeOnSeparator =
      breakIdx < remaining.length && /\s/.test(remaining[breakIdx]);
    const nextStart = Math.min(
      remaining.length,
      breakIdx + (brokeOnSeparator ? 1 : 0),
    );
    remaining = remaining.slice(nextStart).trimStart();
  }

  if (remaining.length) chunks.push(remaining);
  return chunks;
}

export function chunkTelegramMarkdownText(
  text: string,
  limit: number,
): string[] {
  if (!text) return [];
  if (limit <= 0) return [text];
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    const spans = parseFenceSpans(remaining);
    const window = remaining.slice(0, limit);

    const softBreak = pickSafeBreakIndex(window, spans);
    let breakIdx = softBreak > 0 ? softBreak : limit;

    const initialFence = isSafeFenceBreak(spans, breakIdx)
      ? undefined
      : findFenceSpanAt(spans, breakIdx);

    let fenceToSplit = initialFence;
    if (initialFence) {
      const closeLine = `${initialFence.indent}${initialFence.marker}`;
      const maxIdxIfNeedNewline = limit - (closeLine.length + 1);

      if (maxIdxIfNeedNewline <= 0) {
        fenceToSplit = undefined;
        breakIdx = limit;
      } else {
        const minProgressIdx = Math.min(
          remaining.length,
          initialFence.start + initialFence.openLine.length + 2,
        );
        const maxIdxIfAlreadyNewline = limit - closeLine.length;

        let pickedNewline = false;
        let lastNewline = remaining.lastIndexOf(
          '\n',
          Math.max(0, maxIdxIfAlreadyNewline - 1),
        );
        while (lastNewline !== -1) {
          const candidateBreak = lastNewline + 1;
          if (candidateBreak < minProgressIdx) break;

          const candidateFence = findFenceSpanAt(spans, candidateBreak);
          if (candidateFence && candidateFence.start === initialFence.start) {
            breakIdx = Math.max(1, candidateBreak);
            pickedNewline = true;
            break;
          }
          lastNewline = remaining.lastIndexOf('\n', lastNewline - 1);
        }

        if (!pickedNewline) {
          if (minProgressIdx > maxIdxIfAlreadyNewline) {
            fenceToSplit = undefined;
            breakIdx = limit;
          } else {
            breakIdx = Math.max(minProgressIdx, maxIdxIfNeedNewline);
          }
        }
      }

      const fenceAtBreak = findFenceSpanAt(spans, breakIdx);
      fenceToSplit =
        fenceAtBreak && fenceAtBreak.start === initialFence.start
          ? fenceAtBreak
          : undefined;
    }

    let rawChunk = remaining.slice(0, breakIdx);
    if (!rawChunk) break;

    const brokeOnSeparator =
      breakIdx < remaining.length && /\s/.test(remaining[breakIdx]);
    const nextStart = Math.min(
      remaining.length,
      breakIdx + (brokeOnSeparator ? 1 : 0),
    );
    let next = remaining.slice(nextStart);

    if (fenceToSplit) {
      const closeLine = `${fenceToSplit.indent}${fenceToSplit.marker}`;
      rawChunk = rawChunk.endsWith('\n')
        ? `${rawChunk}${closeLine}`
        : `${rawChunk}\n${closeLine}`;
      next = `${fenceToSplit.openLine}\n${next}`;
    } else {
      next = stripLeadingNewlines(next);
    }

    chunks.push(rawChunk);
    remaining = next;
  }

  if (remaining.length) chunks.push(remaining);
  return chunks;
}

const TELEGRAM_HTML_TAGS = [
  'b',
  'i',
  's',
  'u',
  'code',
  'pre',
  'tg-spoiler',
  'blockquote',
  'a',
];

export function rebalanceHtmlChunks(chunks: string[]): string[] {
  if (chunks.length <= 1) return chunks;

  const tagPattern = new RegExp(
    `<(/?)(${TELEGRAM_HTML_TAGS.join('|')})(\\s[^>]*)?>`,
    'gi',
  );

  const result: string[] = [];
  const carryOver: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i];

    if (carryOver.length > 0) {
      chunk = carryOver.map((tag) => `<${tag}>`).join('') + chunk;
      carryOver.length = 0;
    }

    const stack: string[] = [];
    let match: RegExpMatchArray | null;
    const allMatches = chunk.matchAll(tagPattern);
    for (match of allMatches) {
      const isClose = match[1] === '/';
      const tag = match[2].toLowerCase();
      if (isClose) {
        const idx = stack.lastIndexOf(tag);
        if (idx !== -1) stack.splice(idx, 1);
      } else {
        stack.push(tag);
      }
    }

    if (stack.length > 0 && i < chunks.length - 1) {
      chunk += [...stack]
        .reverse()
        .map((t) => `</${t}>`)
        .join('');
      carryOver.push(...stack);
    }

    result.push(chunk);
  }

  return result;
}

export function splitTelegramText(text: string, maxLen: number): string[] {
  if (!text) return [''];
  const markdownChunks = chunkTelegramMarkdownText(text, maxLen);
  if (markdownChunks.length > 0) return rebalanceHtmlChunks(markdownChunks);
  const plain = chunkPlainText(text, maxLen);
  return plain.length > 0 ? plain : [''];
}
