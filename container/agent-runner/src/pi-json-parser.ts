export interface PiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  provider?: string;
  model?: string;
}

export interface ParsePiJsonOutputInput {
  stdout: string;
  provider?: string;
  model?: string;
}

export interface ParsePiJsonOutputResult {
  result: string;
  usage?: PiUsage;
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

function toNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value >= 0 ? value : undefined;
}

export function parsePiJsonOutput(
  input: ParsePiJsonOutputInput,
): ParsePiJsonOutputResult {
  let lastAssistant = '';
  let lastError: string | null = null;
  let sawJsonEvent = false;
  let sawAssistantMessageEnd = false;
  let usage: PiUsage | undefined;

  const extractUsage = (evt: any) => {
    const messageUsage = evt?.message?.usage;
    const directUsage = evt?.usage;
    const usageCandidate = messageUsage && typeof messageUsage === 'object'
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

      const stopReason = evt?.message?.stopReason;
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

      const extracted = extractTextFromContent(evt?.message?.content).trim();
      if (extracted) lastAssistant = extracted;
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
      return { result: '', usage };
    }
    return { result: raw, usage };
  }

  return { result: lastAssistant.trim(), usage };
}

