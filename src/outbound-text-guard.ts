/**
 * Host-side guard for user-visible agent replies.
 * Blocks tool-call markup and obvious full-file source dumps from chat delivery.
 */

export const OUTBOUND_DUMP_FALLBACK =
  'That reply looked like a full file or tool dump, so it was not posted in chat. If a file was written, open it from disk; otherwise ask for a short summary.';

export type OutboundTextGuardResult = {
  allow: boolean;
  reason?: 'tool-markup' | 'full-file-dump';
  /** Text to deliver: original when allowed, short fallback when blocked. */
  text: string;
};

const TOOL_MARKUP_RE =
  /<\s*tool_call\b|<\s*\/\s*tool_call\b|<\s*function\s*=|<\s*parameter\b|<\s*\/\s*parameter\b/i;

const HTML_DOC_RE = /<!DOCTYPE\s+html\b|<html[\s>]/i;

/** Minimum size before full-file heuristics apply (short snippets stay allowed). */
const FULL_FILE_MIN_CHARS = 2500;
const LARGE_CODE_MIN_CHARS = 8000;

export function guardOutboundAgentText(text: string): OutboundTextGuardResult {
  const raw = typeof text === 'string' ? text : '';
  if (!raw.trim()) {
    return { allow: true, text: raw };
  }

  if (TOOL_MARKUP_RE.test(raw)) {
    return {
      allow: false,
      reason: 'tool-markup',
      text: OUTBOUND_DUMP_FALLBACK,
    };
  }

  if (looksLikeFullFileDump(raw)) {
    return {
      allow: false,
      reason: 'full-file-dump',
      text: OUTBOUND_DUMP_FALLBACK,
    };
  }

  return { allow: true, text: raw };
}

export function looksLikeFullFileDump(text: string): boolean {
  const len = text.length;
  if (len < FULL_FILE_MIN_CHARS) return false;

  if (HTML_DOC_RE.test(text)) {
    const tagHits = (text.match(/<\/?(div|section|style|script|head|body)\b/gi) || [])
      .length;
    if (len >= 4000 || tagHits >= 12) return true;
  }

  // Large mostly-code bodies (CSS/JS/TS dumps without prose).
  if (len >= LARGE_CODE_MIN_CHARS) {
    const lines = text.split('\n');
    if (lines.length >= 40) {
      let codey = 0;
      for (const line of lines) {
        if (isCodeyLine(line)) codey += 1;
      }
      if (codey / lines.length >= 0.55) return true;
    }
  }

  // Dense CSS custom-property / color dumps.
  if (len >= 4000) {
    const colorDecls = (text.match(/:\s*#[0-9a-fA-F]{3,8}\s*;/g) || []).length;
    if (colorDecls >= 15) return true;
  }

  return false;
}

function isCodeyLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (
    /^(const|let|var|function|class|import|export|interface|type|return|if|for|while)\b/.test(
      t,
    )
  ) {
    return true;
  }
  if (/^[{}();[\]]+$/.test(t)) return true;
  if (/^\s*[.#]?[\w-]+\s*\{/.test(line)) return true;
  if (/^\s*\/\*|\*\/|^\s*\/\/|^\s*\*/.test(t)) return true;
  if (/[{};]\s*$/.test(t) && t.length < 120) return true;
  if (/^(<\/?[a-zA-Z][\w:-]*|<!DOCTYPE)/.test(t)) return true;
  return false;
}
