export const EMPTY_NON_HEARTBEAT_OUTPUT_MESSAGE =
  'LLM produced no user-visible final response. Please retry or switch model if this repeats.';

export interface AgentRunResult {
  result: string | null;
  streamed: boolean;
  ok: boolean;
  suppressUserDelivery?: boolean;
  controlPlaneStatus?: 'verification_failed';
  hadToolSideEffects?: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    provider?: string;
    model?: string;
  };
}

export function hasUserVisibleText(text: string | null | undefined): boolean {
  return typeof text === 'string' && text.trim().length > 0;
}

export function formatEmptyFinalOutputDiagnostic(params: {
  runId?: string;
  streamed?: boolean;
  externallyCompleted?: boolean;
  previewFinalized?: boolean;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}): string {
  const details: string[] = [];
  if (params.runId) details.push(`run=${params.runId}`);
  if (typeof params.streamed === 'boolean') {
    details.push(`streamed=${params.streamed ? 'yes' : 'no'}`);
  }
  if (typeof params.externallyCompleted === 'boolean') {
    details.push(
      `external_delivery=${params.externallyCompleted ? 'yes' : 'no'}`,
    );
  }
  if (typeof params.previewFinalized === 'boolean') {
    details.push(`preview_finalized=${params.previewFinalized ? 'yes' : 'no'}`);
  }
  if (params.provider) details.push(`provider=${params.provider}`);
  if (params.model) details.push(`model=${params.model}`);
  if (typeof params.inputTokens === 'number') {
    details.push(`input_tokens=${params.inputTokens}`);
  }
  if (typeof params.outputTokens === 'number') {
    details.push(`output_tokens=${params.outputTokens}`);
  }
  if (typeof params.totalTokens === 'number') {
    details.push(`total_tokens=${params.totalTokens}`);
  }

  if (details.length === 0) return EMPTY_NON_HEARTBEAT_OUTPUT_MESSAGE;
  return `${EMPTY_NON_HEARTBEAT_OUTPUT_MESSAGE}\n\nDiagnostics: ${details.join(', ')}`;
}

export async function applyNonHeartbeatEmptyOutputPolicy(params: {
  isHeartbeatRun: boolean;
  firstRun: AgentRunResult;
  retryRun: () => Promise<AgentRunResult>;
  isAborted?: () => boolean;
}): Promise<{ finalRun: AgentRunResult; retried: boolean }> {
  const { isHeartbeatRun, firstRun, retryRun, isAborted } = params;
  if (
    isHeartbeatRun ||
    !firstRun.ok ||
    hasUserVisibleText(firstRun.result) ||
    isAborted?.()
  ) {
    return { finalRun: firstRun, retried: false };
  }

  const secondRun = await retryRun();
  if (isAborted?.()) {
    return { finalRun: secondRun, retried: true };
  }
  if (secondRun.ok && !hasUserVisibleText(secondRun.result)) {
    return {
      finalRun: {
        ...secondRun,
        result: EMPTY_NON_HEARTBEAT_OUTPUT_MESSAGE,
        streamed: false,
        ok: true,
      },
      retried: true,
    };
  }

  return { finalRun: secondRun, retried: true };
}
