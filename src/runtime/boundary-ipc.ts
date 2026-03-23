import type {
  FarmActionRequest,
  MemoryActionRequest,
  RegisteredGroup,
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
  TPayload extends FarmActionRequest | MemoryActionRequest =
    | FarmActionRequest
    | MemoryActionRequest,
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

export function wrapLegacyTaskEnvelope(
  payload: unknown,
  sourceGroup: string,
  createdAt = new Date().toISOString(),
): BoundaryEnvelope<Record<string, unknown>> | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  if (typeof raw.type !== 'string' || !raw.type.trim()) return null;
  const requestId =
    typeof raw.taskId === 'string' && raw.taskId.trim()
      ? raw.taskId.trim()
      : undefined;
  return {
    id: createEnvelopeId('task', sourceGroup, requestId, createdAt),
    kind: 'task',
    createdAt,
    sourceGroup,
    requestId,
    payload: raw,
  };
}

export function wrapLegacyActionEnvelope(
  payload: FarmActionRequest | MemoryActionRequest,
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

export function translateLegacyMessageToHostEvent(
  envelope: BoundaryEnvelope<Record<string, unknown>>,
  registeredGroups: Record<string, RegisteredGroup>,
  isMain: boolean,
): HostEvent | null {
  const payload = envelope.payload;
  if (payload.type === 'telegram_draft_update') return null;
  if (payload.type !== 'message') return null;
  if (typeof payload.chatJid !== 'string' || typeof payload.text !== 'string')
    return null;
  const targetGroup = registeredGroups[payload.chatJid];
  if (
    !isMain &&
    (!targetGroup || targetGroup.folder !== envelope.sourceGroup)
  ) {
    return null;
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

export type LegacyMessageDispatchResult =
  | 'delivered'
  | 'ignored_draft'
  | 'ignored_invalid';

export async function dispatchLegacyMessageEnvelope(
  envelope: BoundaryEnvelope<Record<string, unknown>>,
  registeredGroups: Record<string, RegisteredGroup>,
  isMain: boolean,
  dispatch: (event: HostEvent) => Promise<void> | void,
): Promise<LegacyMessageDispatchResult> {
  const event = translateLegacyMessageToHostEvent(
    envelope,
    registeredGroups,
    isMain,
  );
  if (!event) {
    return envelope.payload.type === 'telegram_draft_update'
      ? 'ignored_draft'
      : 'ignored_invalid';
  }
  await dispatch(event);
  return 'delivered';
}
