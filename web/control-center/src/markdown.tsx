import type { JSX, ReactNode } from 'react';

interface InlineRun {
  text: string;
  start: number;
  end: number;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  if (
    /^(https?:|mailto:|tel:)/i.test(trimmed) ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  ) {
    return trimmed;
  }
  return null;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  const patterns: Array<{
    regex: RegExp;
    render: (match: RegExpMatchArray, idx: number) => ReactNode;
  }> = [
    {
      regex: /`([^`\n]+)`/g,
      render: (m, idx) => (
        <code key={`${keyPrefix}-c-${idx}`} className="message-inline-code">
          {m[1]}
        </code>
      ),
    },
    {
      regex: /\*\*([^*\n]+)\*\*/g,
      render: (m, idx) => (
        <strong key={`${keyPrefix}-b-${idx}`}>{m[1]}</strong>
      ),
    },
    {
      regex: /\*([^*\n]+)\*/g,
      render: (m, idx) => (
        <em key={`${keyPrefix}-i-${idx}`}>{m[1]}</em>
      ),
    },
    {
      regex: /\[([^\]\n]+)\]\(([^)\s]+)\)/g,
      render: (m, idx) => {
        const href = safeHref(m[2]);
        if (!href) return m[0];
        return (
          <a
            key={`${keyPrefix}-l-${idx}`}
            className="message-link"
            href={href}
            target="_blank"
            rel="noreferrer noopener"
          >
            {m[1]}
          </a>
        );
      },
    },
  ];

  const runs: InlineRun[] = [];
  for (const { regex } of patterns) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      runs.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    }
  }
  runs.sort((a, b) => a.start - b.start);

  const filtered: InlineRun[] = [];
  let lastEnd = 0;
  for (const run of runs) {
    if (run.start < lastEnd) continue;
    filtered.push(run);
    lastEnd = run.end;
  }

  for (const run of filtered) {
    if (run.start > cursor) {
      nodes.push(text.slice(cursor, run.start));
    }
    for (const { regex, render } of patterns) {
      regex.lastIndex = run.start;
      const m = regex.exec(text);
      if (m && m.index === run.start && m[0] === run.text) {
        nodes.push(render(m, key++));
        break;
      }
    }
    cursor = run.end;
  }
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return nodes;
}

interface Block {
  kind: 'paragraph' | 'heading' | 'code' | 'list' | 'table' | 'blank';
  level?: number;
  lang?: string;
  text?: string;
  items?: string[];
  rows?: string[][];
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  return /^\|?[\s:|-]+\|?$/.test(trimmed) && /-+/.test(trimmed);
}

function parseBlocks(input: string): Block[] {
  const lines = input.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] || '';
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ kind: 'code', lang, text: buf.join('\n') });
      continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1].length,
        text: heading[2],
      });
      i += 1;
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const rows: string[][] = [parseTableRow(line)];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ kind: 'table', rows });
      continue;
    }
    if (/^\s*([-*])\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*])\s+/, ''));
        i += 1;
      }
      blocks.push({ kind: 'list', items });
      continue;
    }
    const buf: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\s*([-*])\s+/.test(lines[i]) &&
      !(/^\s*\|/.test(lines[i]) && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      buf.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: 'paragraph', text: buf.join('\n') });
  }
  return blocks;
}

function renderBlock(block: Block, key: string): JSX.Element {
  if (block.kind === 'code') {
    return (
      <div key={key} className="message-code-wrap">
        {block.lang ? (
          <p className="message-code-lang">{block.lang}</p>
        ) : null}
        <pre className="message-code-block">{block.text || ''}</pre>
      </div>
    );
  }
  if (block.kind === 'heading' && block.text) {
    const Tag = `h${Math.min(6, Math.max(2, block.level || 2))}` as
      | 'h2'
      | 'h3'
      | 'h4'
      | 'h5'
      | 'h6';
    return <Tag key={key}>{renderInline(block.text, key)}</Tag>;
  }
  if (block.kind === 'list' && block.items) {
    return (
      <ul key={key} className="message-list">
        {block.items.map((item, idx) => (
          <li key={`${key}-${idx}`}>{renderInline(item, `${key}-${idx}`)}</li>
        ))}
      </ul>
    );
  }
  if (block.kind === 'table' && block.rows && block.rows.length > 0) {
    const [header, ...body] = block.rows;
    return (
      <div key={key} className="message-table-wrap">
        <table className="message-table">
          <thead>
            <tr>
              {header.map((cell, idx) => (
                <th key={`h-${idx}`}>{renderInline(cell, `${key}-h-${idx}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, rIdx) => (
              <tr key={`r-${rIdx}`}>
                {row.map((cell, cIdx) => (
                  <td key={`c-${rIdx}-${cIdx}`}>
                    {renderInline(cell, `${key}-r-${rIdx}-${cIdx}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (block.kind === 'paragraph' && block.text) {
    return (
      <p key={key} className="message-paragraph">
        {renderInline(block.text, key)}
      </p>
    );
  }
  return <></>;
}

export function MarkdownLite({ text }: { text: string }): JSX.Element {
  const trimmed = (text || '').trim();
  if (!trimmed) return <p className="message-paragraph">(empty)</p>;
  const blocks = parseBlocks(trimmed);
  return (
    <div className="message-content">
      {blocks.map((block, idx) => renderBlock(block, `m-${idx}`))}
    </div>
  );
}

export function escapeText(text: string): string {
  return escapeHtml(text);
}
