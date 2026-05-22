export interface PiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  provider?: string;
  model?: string;
}

export interface PiToolExecution {
  index: number;
  toolName: string;
  status: 'ok' | 'error';
  args?: string;
  output?: string;
  error?: string;
}

export interface ParsePiJsonOutputInput {
  stdout: string;
  provider?: string;
  model?: string;
}

export interface ParsePiJsonOutputResult {
  result: string;
  usage?: PiUsage;
  toolExecutions?: PiToolExecution[];
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

type TextDelta =
  | { kind: 'append'; text: string }
  | { kind: 'replace'; text: string };

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
    const message = evt.message as Record<string, unknown>;
    if (message.role && message.role !== 'assistant') return null;
    const text = extractTextFromContent(message.content);
    if (text) return { kind: 'replace', text };
  }

  if (evt.content) {
    const text = extractTextFromContent(evt.content);
    if (text) return { kind: 'replace', text };
  }

  return null;
}

function extractAssistantTextDeltaFromPiEvent(
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

function toNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value >= 0 ? value : undefined;
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

interface PendingToolExecution {
  index: number;
  toolName: string;
  args?: string;
}

const NON_FINAL_ASSISTANT_STOP_REASONS = new Set([
  'tooluse',
  'tool_use',
  'tool_calls',
  'function_call',
  'tool-call',
]);

const FINAL_ASSISTANT_STOP_REASONS = new Set([
  '',
  'stop',
  'end_turn',
  'max_tokens',
]);

function normalizeStopReason(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function readMessageStopReason(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const record = message as Record<string, unknown>;
  return normalizeStopReason(record.stopReason ?? record.stop_reason);
}

function isFinalAssistantStopReason(stopReason: string): boolean {
  if (NON_FINAL_ASSISTANT_STOP_REASONS.has(stopReason)) return false;
  return FINAL_ASSISTANT_STOP_REASONS.has(stopReason);
}

export function parsePiJsonOutput(
  input: ParsePiJsonOutputInput,
): ParsePiJsonOutputResult {
  let lastAssistant = '';
  let streamedAssistantCandidate = '';
  let lastError: string | null = null;
  let sawJsonEvent = false;
  let sawAssistantMessageEnd = false;
  let usage: PiUsage | undefined;
  const pendingById = new Map<string, PendingToolExecution>();
  const pendingQueue: PendingToolExecution[] = [];
  const toolExecutions: PiToolExecution[] = [];
  let nextToolIndex = 1;

  const extractUsage = (evt: any) => {
    const messageUsage = evt?.message?.usage;
    const directUsage = evt?.usage;
    const usageCandidate =
      messageUsage && typeof messageUsage === 'object'
        ? messageUsage
        : directUsage && typeof directUsage === 'object'
          ? directUsage
          : undefined;
    if (!usageCandidate) return;

    const inputTokens =
      toNumber(usageCandidate.inputTokens) ??
      toNumber(usageCandidate.input_tokens) ??
      toNumber(usageCandidate.promptTokens) ??
      toNumber(usageCandidate.prompt_tokens);
    const outputTokens =
      toNumber(usageCandidate.outputTokens) ??
      toNumber(usageCandidate.output_tokens) ??
      toNumber(usageCandidate.completionTokens) ??
      toNumber(usageCandidate.completion_tokens);
    const totalTokens =
      toNumber(usageCandidate.totalTokens) ??
      toNumber(usageCandidate.total_tokens) ??
      (typeof inputTokens === 'number' || typeof outputTokens === 'number'
        ? (inputTokens || 0) + (outputTokens || 0)
        : undefined);

    usage = {
      inputTokens,
      outputTokens,
      totalTokens,
      provider:
        (typeof evt?.message?.provider === 'string' && evt.message.provider) ||
        (typeof evt?.provider === 'string' && evt.provider) ||
        input.provider,
      model:
        (typeof evt?.message?.model === 'string' && evt.message.model) ||
        (typeof evt?.model === 'string' && evt.model) ||
        input.model,
    };
  };

  for (const line of input.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const evt = JSON.parse(trimmed) as any;
      sawJsonEvent = true;
      extractUsage(evt);

      const evtRecord = evt as Record<string, unknown>;
      const evtType = typeof evtRecord.type === 'string' ? evtRecord.type : '';
      const textDelta = extractAssistantTextDeltaFromPiEvent(evt);
      if (textDelta) {
        streamedAssistantCandidate =
          textDelta.kind === 'replace'
            ? textDelta.text
            : streamedAssistantCandidate + textDelta.text;
      }
      if (evtType) {
        if (isToolStartEvent(evtType)) {
          const pending: PendingToolExecution = {
            index: nextToolIndex++,
            toolName: extractToolName(evtRecord) || 'tool',
            args: extractToolArgs(evtRecord),
          };
          const callId = extractToolCallId(evtRecord);
          if (callId) pendingById.set(callId, pending);
          pendingQueue.push(pending);
        } else if (isToolEndEvent(evtType)) {
          const callId = extractToolCallId(evtRecord);
          let pending: PendingToolExecution | undefined;
          if (callId && pendingById.has(callId)) {
            pending = pendingById.get(callId);
            pendingById.delete(callId);
            if (pending) {
              const idx = pendingQueue.indexOf(pending);
              if (idx !== -1) pendingQueue.splice(idx, 1);
            }
          } else if (pendingQueue.length > 0) {
            pending = pendingQueue.shift();
          }

          const isError = isToolError(evtRecord);
          const output = extractToolOutput(evtRecord);
          const error =
            extractToolError(evtRecord) || (isError ? output : undefined);
          const toolName =
            extractToolName(evtRecord) || pending?.toolName || 'tool';
          const args = extractToolArgs(evtRecord) || pending?.args;

          toolExecutions.push({
            index: pending?.index || nextToolIndex++,
            toolName,
            status: isError ? 'error' : 'ok',
            ...(args ? { args } : {}),
            ...(isError ? (error ? { error } : {}) : output ? { output } : {}),
          });
        }
      }

      const stopReason = normalizeStopReason(
        evt?.message?.stopReason ?? evt?.message?.stop_reason,
      );
      const errorMessage = evt?.message?.errorMessage;
      if (
        stopReason === 'error' &&
        typeof errorMessage === 'string' &&
        errorMessage
      ) {
        lastError = errorMessage;
      }

      if (evt?.type !== 'message_end') continue;
      if (evt?.message?.role !== 'assistant') continue;
      sawAssistantMessageEnd = true;

      const msgStopReason = readMessageStopReason(evt?.message);
      if (!isFinalAssistantStopReason(msgStopReason)) {
        streamedAssistantCandidate = '';
        continue;
      }

      const extracted = extractTextFromContent(evt?.message?.content).trim();
      if (extracted) {
        lastAssistant = extracted;
      } else {
        // Final turn produced no text — preamble text from prior tool-use turns
        // is cleared on the tool-use turn. Remaining streamed text belongs to
        // this final turn and is the best provider-trusted final candidate.
        lastAssistant = streamedAssistantCandidate.trim();
      }
      streamedAssistantCandidate = '';
    } catch {
      // Ignore non-JSON lines
    }
  }

  if (!lastAssistant && lastError) {
    throw new Error(lastError);
  }

  if (!lastAssistant) {
    const raw = input.stdout.trim();
    if (sawAssistantMessageEnd || sawJsonEvent) {
      return {
        result: '',
        usage,
        ...(toolExecutions.length > 0 ? { toolExecutions } : {}),
      };
    }
    return {
      result: raw,
      usage,
      ...(toolExecutions.length > 0 ? { toolExecutions } : {}),
    };
  }

  return {
    result: lastAssistant.trim(),
    usage,
    ...(toolExecutions.length > 0 ? { toolExecutions } : {}),
  };
}
