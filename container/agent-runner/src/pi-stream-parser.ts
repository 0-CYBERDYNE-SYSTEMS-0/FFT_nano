export type TextDelta = { kind: 'append'; text: string } | { kind: 'replace'; text: string };

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block);
      continue;
    }
    if (!block || typeof block !== 'object') continue;
    const record = block as Record<string, unknown>;
    const blockType = typeof record.type === 'string' ? record.type : '';
    if (blockType && blockType !== 'text') continue;
    if (typeof record.text === 'string') {
      parts.push(record.text);
      continue;
    }
    if (typeof record.content === 'string') {
      parts.push(record.content);
    }
  }

  return parts.join('');
}

function extractAssistantTextDelta(event: unknown): TextDelta | null {
  if (!event || typeof event !== 'object') return null;
  const evt = event as Record<string, unknown>;

  if (evt.type === 'text_delta' && typeof evt.delta === 'string') {
    return { kind: 'append', text: evt.delta };
  }

  if (evt.delta && typeof evt.delta === 'object') {
    const deltaText = (evt.delta as Record<string, unknown>).text;
    if (typeof deltaText === 'string') {
      return { kind: 'append', text: deltaText };
    }
  }

  if (typeof evt.text === 'string') {
    return { kind: 'append', text: evt.text };
  }

  if (evt.message && typeof evt.message === 'object') {
    const content = (evt.message as Record<string, unknown>).content;
    const text = extractTextFromContent(content);
    if (text) return { kind: 'replace', text };
  }

  if (evt.content) {
    const text = extractTextFromContent(evt.content);
    if (text) return { kind: 'replace', text };
  }

  return null;
}

export function extractAssistantTextDeltaFromPiEvent(event: unknown): TextDelta | null {
  if (!event || typeof event !== 'object') return null;
  const evt = event as Record<string, unknown>;
  const type = typeof evt.type === 'string' ? evt.type : '';

  if (type === 'message_update') {
    return (
      extractAssistantTextDelta(evt.assistantMessageEvent) ||
      extractAssistantTextDelta(evt.assistant_message_event) ||
      extractAssistantTextDelta(evt.message) ||
      extractAssistantTextDelta(evt)
    );
  }

  // Some providers emit direct delta events (not nested under message_update).
  if (
    type === 'text_delta' ||
    type === 'assistant_message_event' ||
    type === 'assistant_message_delta'
  ) {
    return extractAssistantTextDelta(evt);
  }

  if (type === 'message_end') {
    const message = evt.message;
    if (!message || typeof message !== 'object') return null;
    if ((message as Record<string, unknown>).role !== 'assistant') return null;
    const text = extractTextFromContent((message as Record<string, unknown>).content);
    if (!text) return null;
    return { kind: 'replace', text };
  }

  return null;
}
