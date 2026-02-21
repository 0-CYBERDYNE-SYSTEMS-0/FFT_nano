export interface GatewayRequestFrame {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface GatewayResponseFrame {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface GatewayEventFrame {
  event: string;
  payload?: unknown;
}

export interface TuiSessionSummary {
  sessionKey: string;
  chatJid: string;
  name: string;
  isMain: boolean;
  lastActivity?: string;
}

export interface ChatEventPayload {
  runId: string;
  sessionKey: string;
  state: 'message' | 'delta' | 'final' | 'aborted' | 'error';
  message?: unknown;
  errorMessage?: string;
  timestamp?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    provider?: string;
    model?: string;
  };
}

export interface AgentEventPayload {
  runId: string;
  stream: 'lifecycle';
  data?: {
    phase?: 'start' | 'end' | 'error';
    detail?: string;
  };
}

export function isGatewayRequestFrame(value: unknown): value is GatewayRequestFrame {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return typeof rec.id === 'string' && typeof rec.method === 'string';
}
