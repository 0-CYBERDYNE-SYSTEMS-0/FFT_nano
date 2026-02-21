export const EMPTY_NON_HEARTBEAT_OUTPUT_MESSAGE =
  'LLM returned no user-visible text (thinking-only output). Please retry or adjust prompt/model.';

export interface AgentRunResult {
  result: string | null;
  streamed: boolean;
  ok: boolean;
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

export async function applyNonHeartbeatEmptyOutputPolicy(params: {
  isHeartbeatRun: boolean;
  firstRun: AgentRunResult;
  retryRun: () => Promise<AgentRunResult>;
}): Promise<{ finalRun: AgentRunResult; retried: boolean }> {
  const { isHeartbeatRun, firstRun, retryRun } = params;
  if (isHeartbeatRun || !firstRun.ok || firstRun.streamed || hasUserVisibleText(firstRun.result)) {
    return { finalRun: firstRun, retried: false };
  }

  const secondRun = await retryRun();
  if (
    secondRun.ok &&
    !secondRun.streamed &&
    !hasUserVisibleText(secondRun.result)
  ) {
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

