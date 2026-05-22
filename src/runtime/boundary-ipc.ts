import type {
  FarmActionRequest,
  MemoryActionRequest,
  RegisteredGroup,
  SkillActionRequest,
} from '../types.js';
import type { HostEvent } from './host-events.js';

export interface BoundaryEnvelope<TPayload = unknown> {
  id: string;
  kind: 'message' | 'task' | 'action' | 'action_result';
  createdAt: string;
  sourceGroup: string;
  requestId?: string;
  payload: TPayload;
}

export interface BoundaryActionEnvelope<
  TPayload extends
    | FarmActionRequest
    | MemoryActionRequest
    | SkillActionRequest =
    | FarmActionRequest
    | MemoryActionRequest
    | SkillActionRequest,
> extends BoundaryEnvelope<TPayload> {
  kind: 'action';
  resultPath: string;
}

function createEnvelopeId(
  kind: BoundaryEnvelope['kind'],
  sourceGroup: string,
  requestId: string | undefined,
  createdAt: string,
): string {
  const suffix = requestId?.trim() || createdAt;
  return `${kind}:${sourceGroup}:${suffix}`;
}

export function wrapLegacyMessageEnvelope(
  payload: unknown,
  sourceGroup: string,
  createdAt = new Date().toISOString(),
): BoundaryEnvelope<Record<string, unknown>> | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  if (typeof raw.type !== 'string' || !raw.type.trim()) return null;
  const requestId =
    typeof raw.requestId === 'string' && raw.requestId.trim()
      ? raw.requestId.trim()
      : undefined;
  return {
    id: createEnvelopeId('message', sourceGroup, requestId, createdAt),
    kind: 'message',
    createdAt,
    sourceGroup,
    requestId,
    payload: raw,
  };
}

export function wrapLegacyActionEnvelope(
  payload: FarmActionRequest | MemoryActionRequest | SkillActionRequest,
  sourceGroup: string,
  resultPath: string,
  createdAt = new Date().toISOString(),
): BoundaryActionEnvelope {
  return {
    id: createEnvelopeId('action', sourceGroup, payload.requestId, createdAt),
    kind: 'action',
    createdAt,
    sourceGroup,
    requestId: payload.requestId,
    payload,
    resultPath,
  };
}

export function isInternalEvaluatorVerdictText(text: string): boolean {
  const isVerdictObject = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    const parsed = value as Record<string, unknown>;
    const rawScore = parsed.score;
    const hasScore =
      typeof rawScore === 'number' ||
      (typeof rawScore === 'string' &&
        rawScore.trim().length > 0 &&
        Number.isFinite(Number(rawScore)));
    return (
      typeof parsed.pass === 'boolean' &&
      hasScore &&
      Array.isArray(parsed.issues) &&
      typeof parsed.feedback === 'string'
    );
  };

  const tryJsonCandidate = (candidate: string): boolean => {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (isVerdictObject(parsed)) return true;
      if (isVerdictObject(parsed.verdict)) return true;
      return false;
    } catch {
      return false;
    }
  };

  const trimmed = text.trim();
  if (!trimmed) return false;
  if (tryJsonCandidate(trimmed)) return true;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/gi) || [];
  for (const block of fenced) {
    const content = block.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '');
    if (tryJsonCandidate(content.trim())) return true;
  }

  const passLike = /["']?pass["']?\s*:\s*(true|false)/i;
  const scoreLike = /["']?score["']?\s*:\s*["']?\d+/i;
  const issuesLike = /["']?issues["']?\s*:\s*\[/i;
  const feedbackLike = /["']?feedback["']?\s*:\s*["']/i;
  if (
    passLike.test(trimmed) &&
    scoreLike.test(trimmed) &&
    issuesLike.test(trimmed) &&
    feedbackLike.test(trimmed)
  ) {
    return true;
  }

  const braceCandidates = trimmed.match(/\{[\s\S]*?\}/g) || [];
  for (const candidate of braceCandidates) {
    if (tryJsonCandidate(candidate)) return true;
  }
  return false;
}

export function sanitizeUserFacingVerdictLeak(text: string): string {
  return isInternalEvaluatorVerdictText(text) ? 'verification_failed' : text;
}

export function translateLegacyMessageToHostEvent(
  envelope: BoundaryEnvelope<Record<string, unknown>>,
  registeredGroups: Record<string, RegisteredGroup>,
  isMain: boolean,
  getSessionKeyForChat?: (chatJid: string) => string,
): HostEvent | null {
  const payload = envelope.payload;
  if (payload.type !== 'message' && payload.type !== 'run_progress') {
    return null;
  }
  if (typeof payload.chatJid !== 'string' || typeof payload.text !== 'string')
    return null;
  const targetGroup = registeredGroups[payload.chatJid];
  if (
    !isMain &&
    (!targetGroup || targetGroup.folder !== envelope.sourceGroup)
  ) {
    return null;
  }
  if (
    payload.type === 'message' &&
    isInternalEvaluatorVerdictText(payload.text)
  ) {
    return null;
  }
  if (payload.type === 'run_progress') {
    if (
      typeof payload.requestId !== 'string' ||
      !payload.requestId.trim() ||
      !payload.text.trim()
    ) {
      return null;
    }
    const rawPhase =
      typeof payload.phase === 'string' && payload.phase.trim()
        ? payload.phase.trim()
        : 'thinking';
    const phase =
      rawPhase === 'thinking' ||
      rawPhase === 'tool_running' ||
      rawPhase === 'stale'
        ? rawPhase
        : null;
    if (!phase) return null;
    return {
      kind: 'run_progress',
      id: envelope.id,
      createdAt: envelope.createdAt,
      source: 'ipc-boundary',
      runId: payload.requestId.trim(),
      sessionKey: getSessionKeyForChat
        ? getSessionKeyForChat(payload.chatJid)
        : payload.chatJid,
      chatJid: payload.chatJid,
      phase,
      text: payload.text,
      ...(typeof payload.detail === 'string' && payload.detail.trim()
        ? { detail: payload.detail.trim() }
        : {}),
    };
  }
  return {
    kind: 'chat_delivery_requested',
    id: envelope.id,
    createdAt: envelope.createdAt,
    source: 'ipc-boundary',
    chatJid: payload.chatJid,
    text: payload.text,
    ...(typeof payload.requestId === 'string' && payload.requestId.trim()
      ? { requestId: payload.requestId.trim() }
      : {}),
    prefixWhatsApp: true,
  };
}

export type LegacyMessageDispatchResult = 'delivered' | 'ignored_invalid';

export async function dispatchLegacyMessageEnvelope(
  envelope: BoundaryEnvelope<Record<string, unknown>>,
  registeredGroups: Record<string, RegisteredGroup>,
  isMain: boolean,
  dispatch: (event: HostEvent) => Promise<void> | void,
  getSessionKeyForChat?: (chatJid: string) => string,
): Promise<LegacyMessageDispatchResult> {
  const event = translateLegacyMessageToHostEvent(
    envelope,
    registeredGroups,
    isMain,
    getSessionKeyForChat,
  );
  if (!event) {
    return 'ignored_invalid';
  }
  await dispatch(event);
  return 'delivered';
}
