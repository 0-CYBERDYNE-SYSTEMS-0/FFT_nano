export type TextDelta =
  | { kind: 'append'; text: string }
  | { kind: 'replace'; text: string };
export interface ToolDelta {
  index: number;
  toolName: string;
  status: 'start' | 'ok' | 'error';
  args?: string;
  output?: string;
  error?: string;
}

interface PendingToolExecution {
  index: number;
  toolName: string;
  args?: string;
}

export interface ToolTrackerState {
  nextToolIndex: number;
  pendingById: Map<string, PendingToolExecution>;
  pendingQueue: PendingToolExecution[];
}

function extractBlocksByType(content: unknown, targetType: string): string {
  if (!Array.isArray(content)) return '';

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const record = block as Record<string, unknown>;
    const blockType = typeof record.type === 'string' ? record.type : '';
    if (blockType !== targetType) continue;
    if (typeof record.text === 'string') parts.push(record.text);
    else if (typeof record.content === 'string') parts.push(record.content);
    else if (typeof record.thinking === 'string') parts.push(record.thinking);
  }
  return parts.join('');
}

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

function extractThinkingFromContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return extractBlocksByType(content, 'thinking');
}

function readString(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function truncate(value: string, max = 320): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 3)}...`;
}

function summarizeValue(value: unknown, max = 320): string | undefined {
  if (typeof value === 'undefined' || value === null) return undefined;
  if (typeof value === 'string') {
    const text = truncate(value, max);
    return text || undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    const encoded = JSON.stringify(value);
    if (!encoded) return undefined;
    return truncate(encoded, max);
  } catch {
    return undefined;
  }
}

function extractToolName(evt: Record<string, unknown>): string | undefined {
  return readString(evt, ['toolName', 'tool_name', 'name', 'tool']);
}

function extractToolCallId(evt: Record<string, unknown>): string | undefined {
  return readString(evt, [
    'toolCallId',
    'tool_call_id',
    'toolExecutionId',
    'tool_execution_id',
    'callId',
    'call_id',
  ]);
}

function extractToolArgs(evt: Record<string, unknown>): string | undefined {
  return (
    summarizeValue(evt.args, 240) ||
    summarizeValue(evt.arguments, 240) ||
    summarizeValue(evt.toolArgs, 240) ||
    summarizeValue(evt.tool_args, 240)
  );
}

function extractToolError(evt: Record<string, unknown>): string | undefined {
  const direct =
    readString(evt, [
      'errorMessage',
      'error_message',
      'errorText',
      'message',
    ]) || summarizeValue(evt.error, 320);
  if (direct) return direct;

  const result = evt.result;
  if (result && typeof result === 'object') {
    const nested = result as Record<string, unknown>;
    return (
      readString(nested, [
        'errorMessage',
        'error_message',
        'errorText',
        'message',
      ]) || summarizeValue(nested.error, 320)
    );
  }
  return undefined;
}

function extractToolOutput(evt: Record<string, unknown>): string | undefined {
  return (
    summarizeValue(evt.output, 320) ||
    summarizeValue(evt.result, 320) ||
    summarizeValue(evt.response, 320) ||
    summarizeValue(evt.value, 320)
  );
}

function isToolStartEvent(type: string): boolean {
  return (
    type === 'tool_execution_start' ||
    type === 'tool_call_start' ||
    type === 'tool_start' ||
    (type.startsWith('tool_') && type.endsWith('_start'))
  );
}

function isToolEndEvent(type: string): boolean {
  return (
    type === 'tool_execution_end' ||
    type === 'tool_call_end' ||
    type === 'tool_end' ||
    (type.startsWith('tool_') && type.endsWith('_end'))
  );
}

function isToolError(evt: Record<string, unknown>): boolean {
  if (evt.isError === true || evt.is_error === true) return true;
  const status = readString(evt, ['status']);
  if (status && ['error', 'failed', 'failure'].includes(status.toLowerCase()))
    return true;
  const stopReason = readString(evt, ['stopReason', 'stop_reason']);
  if (stopReason && stopReason.toLowerCase() === 'error') return true;
  return false;
}

export function createToolTrackerState(): ToolTrackerState {
  return {
    nextToolIndex: 1,
    pendingById: new Map<string, PendingToolExecution>(),
    pendingQueue: [],
  };
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

export function extractAssistantTextDeltaFromPiEvent(
  event: unknown,
): TextDelta | null {
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
    const text = extractTextFromContent(
      (message as Record<string, unknown>).content,
    );
    if (!text) return null;
    return { kind: 'replace', text };
  }

  return null;
}

export function extractThinkingDeltaFromPiEvent(event: unknown): string | null {
  if (!event || typeof event !== 'object') return null;
  const evt = event as Record<string, unknown>;
  const type = typeof evt.type === 'string' ? evt.type : '';

  if (type === 'thinking_delta' && typeof evt.thinking === 'string') {
    return evt.thinking;
  }
  if (type === 'thinking_delta' && typeof evt.delta === 'string') {
    return evt.delta;
  }

  if (type === 'content_block_delta') {
    const delta = evt.delta as Record<string, unknown> | undefined;
    if (
      delta?.type === 'thinking_delta' &&
      typeof delta.thinking === 'string'
    ) {
      return delta.thinking;
    }
  }

  if (type === 'message_end') {
    const message = evt.message;
    if (!message || typeof message !== 'object') return null;
    const content = (message as Record<string, unknown>).content;
    const thinking = extractThinkingFromContent(content);
    return thinking || null;
  }

  return null;
}

export function extractToolDeltaFromPiEvent(
  event: unknown,
  state: ToolTrackerState,
): ToolDelta | null {
  if (!event || typeof event !== 'object') return null;
  const evt = event as Record<string, unknown>;
  const type = typeof evt.type === 'string' ? evt.type : '';
  if (!type) return null;

  if (isToolStartEvent(type)) {
    const pending: PendingToolExecution = {
      index: state.nextToolIndex++,
      toolName: extractToolName(evt) || 'tool',
      args: extractToolArgs(evt),
    };
    const callId = extractToolCallId(evt);
    if (callId) state.pendingById.set(callId, pending);
    state.pendingQueue.push(pending);
    return {
      index: pending.index,
      toolName: pending.toolName,
      status: 'start',
      ...(pending.args ? { args: pending.args } : {}),
    };
  }

  if (!isToolEndEvent(type)) return null;

  const callId = extractToolCallId(evt);
  let pending: PendingToolExecution | undefined;
  if (callId && state.pendingById.has(callId)) {
    pending = state.pendingById.get(callId);
    state.pendingById.delete(callId);
    if (pending) {
      const idx = state.pendingQueue.indexOf(pending);
      if (idx !== -1) state.pendingQueue.splice(idx, 1);
    }
  } else if (state.pendingQueue.length > 0) {
    pending = state.pendingQueue.shift();
  }

  const toolName = extractToolName(evt) || pending?.toolName || 'tool';
  const args = extractToolArgs(evt) || pending?.args;
  const error = extractToolError(evt);
  const output = extractToolOutput(evt);
  const status: ToolDelta['status'] = isToolError(evt) ? 'error' : 'ok';
  return {
    index: pending?.index || state.nextToolIndex++,
    toolName,
    status,
    ...(args ? { args } : {}),
    ...(status === 'error'
      ? error
        ? { error }
        : output
          ? { error: output }
          : {}
      : output
        ? { output }
        : {}),
  };
}
