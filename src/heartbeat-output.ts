const HEARTBEAT_TOKEN = 'HEARTBEAT_OK';

function normalizeHeartbeatTokenMarkup(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/[*`~]/g, '')
    .trim();
}

export function looksLikeJsonEventStream(text: string): boolean {
  if (!text.startsWith('{') || !text.includes('"type"')) return false;
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return false;

  let parsed = 0;
  for (const line of lines) {
    try {
      const evt = JSON.parse(line) as { type?: unknown };
      if (!evt || typeof evt !== 'object' || typeof evt.type !== 'string') {
        return false;
      }
      parsed++;
    } catch {
      return false;
    }
  }

  if (parsed === 0) return false;
  return /"type":"(message_|turn_|agent_|session)/.test(text);
}

export function looksLikeThinkingOnlyToolCall(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('<tool_call>')) return false;
  return /<\/tool_call>\s*$/s.test(trimmed);
}

export function isHeartbeatAckOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed === HEARTBEAT_TOKEN) return true;
  if (looksLikeJsonEventStream(trimmed)) return true;
  if (looksLikeThinkingOnlyToolCall(trimmed)) return true;

  const normalized = normalizeHeartbeatTokenMarkup(trimmed);
  if (normalized === HEARTBEAT_TOKEN) return true;

  const withoutPrefix = normalized
    .replace(new RegExp(`^${HEARTBEAT_TOKEN}[\\s.!?,:;\\-\\]\\[(){}"']*`, 'i'), '')
    .trim();
  return withoutPrefix.length === 0;
}
