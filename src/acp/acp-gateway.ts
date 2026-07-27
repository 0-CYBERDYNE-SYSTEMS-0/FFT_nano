import { randomUUID } from 'node:crypto';

import * as acp from '@agentclientprotocol/sdk';

import { APP_VERSION } from '../app-state.js';
import type { ExtensionUIRequest, ExtensionUIResponse } from '../pi-runner.js';
import type { HostEvent, HostEventSubscriber } from '../runtime/host-events.js';
import {
  createAcpProjectionState,
  projectEventToAcpNotifications,
} from './acp-event-projector.js';

export interface AcpGatewayAdapters {
  readonly findMainChatJid: () => string | null;
  readonly sendPrompt: (params: {
    readonly chatJid: string;
    readonly text: string;
    readonly requestId: string;
  }) => Promise<void>;
  readonly abortChat: (params: {
    readonly chatJid: string;
    readonly runId: string;
  }) => boolean;
  readonly getHistory?: (chatJid: string) => Promise<
    readonly {
      readonly role: 'user' | 'assistant';
      readonly text: string;
    }[]
  >;
}

export function createAcpAgentApp(
  adapters: AcpGatewayAdapters,
  events: HostEventSubscriber<HostEvent>,
): acp.AgentApp {
  const sessions = new Map<
    string,
    { readonly chatJid: string; readonly cwd: string }
  >();
  const activePrompts = new Map<
    string,
    {
      readonly chatJid: string;
      readonly runId: string;
      cancelled: boolean;
    }
  >();

  return acp
    .agent({ name: 'fft_nano' })
    .onRequest('initialize', ({ params }) => ({
      protocolVersion:
        params.protocolVersion === acp.PROTOCOL_VERSION
          ? params.protocolVersion
          : acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
      },
      agentInfo: {
        name: 'fft_nano',
        title: 'FFT_nano',
        version: APP_VERSION,
      },
    }))
    .onRequest('session/new', ({ params }) => {
      const chatJid = requireMainChat(adapters);
      sessions.set('main', { chatJid, cwd: params.cwd });
      return { sessionId: 'main' };
    })
    .onRequest('session/load', async ({ params, client }) => {
      const chatJid = requireMainChat(adapters);
      sessions.set(params.sessionId, { chatJid, cwd: params.cwd });
      const history = await adapters.getHistory?.(chatJid);
      if (history) {
        let messageIndex = 0;
        for (const message of history) {
          await client.notify('session/update', {
            sessionId: params.sessionId,
            update: {
              sessionUpdate:
                message.role === 'assistant'
                  ? 'agent_message_chunk'
                  : 'user_message_chunk',
              messageId: `${params.sessionId}:history:${messageIndex}`,
              content: { type: 'text', text: message.text },
            },
          });
          messageIndex += 1;
        }
      }
      return {};
    })
    .onRequest('session/prompt', async (context) => {
      const session = sessions.get(context.params.sessionId);
      if (!session) {
        throw acp.RequestError.invalidParams(
          { sessionId: context.params.sessionId },
          'Unknown ACP session',
        );
      }
      if (activePrompts.has(context.params.sessionId)) {
        throw acp.RequestError.invalidRequest(
          { sessionId: context.params.sessionId },
          'An ACP prompt is already running for this session',
        );
      }

      const runId = `acp-${String(context.requestId ?? randomUUID())}`;
      const active = {
        chatJid: session.chatJid,
        runId,
        cancelled: false,
      };
      activePrompts.set(context.params.sessionId, active);
      activePermissionContexts.set(session.chatJid, {
        sessionId: context.params.sessionId,
        client: context.client,
      });
      const projectionState = createAcpProjectionState();
      let notificationTail = Promise.resolve();
      let settlePrompt: (() => void) | null = null;
      const promptSettled = new Promise<void>((resolve) => {
        settlePrompt = resolve;
      });
      const unsubscribe = events.subscribe((event) => {
        const notifications = projectEventToAcpNotifications(
          event,
          context.params.sessionId,
          runId,
          projectionState,
        );
        for (const notification of notifications) {
          notificationTail = notificationTail.then(() =>
            context.client.notify('session/update', notification),
          );
        }
        if (
          event.kind === 'run_state' &&
          'state' in event &&
          event.runId === runId &&
          (event.state === 'final' ||
            event.state === 'aborted' ||
            event.state === 'error')
        ) {
          active.cancelled = event.state === 'aborted';
          settlePrompt?.();
        }
      });

      try {
        await adapters.sendPrompt({
          chatJid: session.chatJid,
          text: promptToText(context.params.prompt),
          requestId: runId,
        });
        await promptSettled;
        await notificationTail;
        return { stopReason: active.cancelled ? 'cancelled' : 'end_turn' };
      } finally {
        unsubscribe();
        activePrompts.delete(context.params.sessionId);
        const permissionContext = activePermissionContexts.get(session.chatJid);
        if (permissionContext?.client === context.client) {
          activePermissionContexts.delete(session.chatJid);
        }
      }
    })
    .onNotification('session/cancel', ({ params }) => {
      const active = activePrompts.get(params.sessionId);
      if (!active) return;
      active.cancelled = adapters.abortChat({
        chatJid: active.chatJid,
        runId: active.runId,
      });
    });
}

export async function routePermissionRequestToAcp(
  chatJid: string,
  request: ExtensionUIRequest,
): Promise<ExtensionUIResponse | null> {
  if (request.method !== 'confirm') return null;
  const active = activePermissionContexts.get(chatJid);
  if (!active) return null;

  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(),
    request.timeout ?? 60_000,
  );
  timeout.unref?.();
  try {
    const response = await Promise.race([
      active.client.request(
        'session/request_permission',
        {
          sessionId: active.sessionId,
          toolCall: {
            toolCallId: request.id,
            title: request.title || 'Permission required',
            kind: 'execute',
            status: 'pending',
            rawInput: request.message || request.text || '',
          },
          options: [
            {
              optionId: 'allow_once',
              name: 'Allow once',
              kind: 'allow_once',
            },
            {
              optionId: 'reject_once',
              name: 'Reject',
              kind: 'reject_once',
            },
          ],
        },
        { cancellationSignal: timeoutController.signal },
      ),
      new Promise<null>((resolve) => {
        timeoutController.signal.addEventListener(
          'abort',
          () => resolve(null),
          {
            once: true,
          },
        );
      }),
    ]);
    if (!response || response.outcome.outcome === 'cancelled') {
      return { id: request.id, confirmed: false, cancelled: true };
    }
    return {
      id: request.id,
      confirmed: response.outcome.optionId === 'allow_once',
    };
  } finally {
    clearTimeout(timeout);
  }
}

interface ActivePermissionContext {
  readonly sessionId: string;
  readonly client: acp.AgentContext;
}

const activePermissionContexts = new Map<string, ActivePermissionContext>();

function requireMainChat(adapters: AcpGatewayAdapters): string {
  const chatJid = adapters.findMainChatJid();
  if (!chatJid) {
    throw acp.RequestError.resourceNotFound('fft_nano://session/main');
  }
  return chatJid;
}

function promptToText(blocks: readonly acp.ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        parts.push(block.text);
        break;
      case 'resource_link':
        parts.push(`[Resource: ${block.name}](${block.uri})`);
        break;
      case 'image':
      case 'audio':
      case 'resource':
        throw acp.RequestError.invalidParams(
          { contentType: block.type },
          `Unsupported ACP prompt content type: ${block.type}`,
        );
    }
  }
  return parts.filter((part) => part.trim()).join('\n\n');
}
