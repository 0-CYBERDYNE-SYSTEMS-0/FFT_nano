type FenceSpan = {
  start: number;
  end: number;
  openLine: string;
  marker: string;
  indent: string;
  closed: boolean;
};

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
        };
      } else if (open.markerChar === markerChar && markerLen >= open.markerLen) {
        spans.push({
          start: open.start,
          end: lineEnd,
          openLine: open.openLine,
          marker: open.marker,
          indent: open.indent,
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
      closed: false,
    });
  }

  return spans;
}

function findFenceSpanAt(spans: FenceSpan[], index: number): FenceSpan | undefined {
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

  text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, href: string) => {
    const unescapedHref = href.replace(/&amp;/g, '&');
    return `<a href="${escapeHtmlAttr(unescapedHref)}">${label}</a>`;
  });
  text = text.replace(/\*\*([^\n*][^*\n]*?)\*\*/g, '<b>$1</b>');
  text = text.replace(/__([^\n_][^_\n]*?)__/g, '<b>$1</b>');
  text = text.replace(/~~([^\n~][^~\n]*?)~~/g, '<s>$1</s>');
  text = text.replace(/\|\|([^\n|][^|\n]*?)\|\|/g, '<tg-spoiler>$1</tg-spoiler>');

  text = text.replace(/@@TGCODE(\d+)@@/g, (_m, rawIndex: string) => {
    const idx = Number.parseInt(rawIndex, 10);
    return Number.isFinite(idx) && codeTokens[idx] ? codeTokens[idx] : '';
  });

  return text;
}

function renderFenceCodeBlock(markdown: string, span: FenceSpan): string {
  const openLineEnd = markdown.indexOf('\n', span.start);
  if (openLineEnd === -1 || openLineEnd >= span.end) {
    return '<pre><code>\n</code></pre>';
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

  return `<pre><code>${escapeHtml(code)}</code></pre>`;
}

export function markdownToTelegramHtml(markdown: string): string {
  const text = (markdown || '').replace(/\r\n?/g, '\n');
  if (!text) return '';

  const spans = parseFenceSpans(text);
  if (spans.length === 0) {
    return renderInlineMarkdown(text);
  }

  let out = '';
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      out += renderInlineMarkdown(text.slice(cursor, span.start));
    }
    out += renderFenceCodeBlock(text, span);
    cursor = span.end;
  }
  if (cursor < text.length) {
    out += renderInlineMarkdown(text.slice(cursor));
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
  const { lastNewline, lastWhitespace } = scanParenAwareBreakpoints(window, (idx) =>
    isSafeFenceBreak(spans, idx),
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

    const brokeOnSeparator = breakIdx < remaining.length && /\s/.test(remaining[breakIdx]);
    const nextStart = Math.min(remaining.length, breakIdx + (brokeOnSeparator ? 1 : 0));
    remaining = remaining.slice(nextStart).trimStart();
  }

  if (remaining.length) chunks.push(remaining);
  return chunks;
}

export function chunkTelegramMarkdownText(text: string, limit: number): string[] {
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
        let lastNewline = remaining.lastIndexOf('\n', Math.max(0, maxIdxIfAlreadyNewline - 1));
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
        fenceAtBreak && fenceAtBreak.start === initialFence.start ? fenceAtBreak : undefined;
    }

    let rawChunk = remaining.slice(0, breakIdx);
    if (!rawChunk) break;

    const brokeOnSeparator = breakIdx < remaining.length && /\s/.test(remaining[breakIdx]);
    const nextStart = Math.min(remaining.length, breakIdx + (brokeOnSeparator ? 1 : 0));
    let next = remaining.slice(nextStart);

    if (fenceToSplit) {
      const closeLine = `${fenceToSplit.indent}${fenceToSplit.marker}`;
      rawChunk = rawChunk.endsWith('\n') ? `${rawChunk}${closeLine}` : `${rawChunk}\n${closeLine}`;
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

export function splitTelegramText(text: string, maxLen: number): string[] {
  if (!text) return [''];
  const markdownChunks = chunkTelegramMarkdownText(text, maxLen);
  if (markdownChunks.length > 0) return markdownChunks;
  const plain = chunkPlainText(text, maxLen);
  return plain.length > 0 ? plain : [''];
}
