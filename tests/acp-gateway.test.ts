import assert from 'node:assert/strict';
import test from 'node:test';

import * as acp from '@agentclientprotocol/sdk';

import {
  createAcpAgentApp,
  routePermissionRequestToAcp,
} from '../src/acp/acp-gateway.js';
import { HostEventBus } from '../src/runtime/host-events.js';

test('runs an ACP prompt through the main FFT_nano session', async () => {
  // Given
  const events = new HostEventBus();
  const sent: Array<{ chatJid: string; text: string; requestId: string }> = [];
  const agent = createAcpAgentApp(
    {
      findMainChatJid: () => 'telegram:42',
      sendPrompt: async (params) => {
        sent.push(params);
        events.publish({
          kind: 'run_state',
          id: 'evt-delta',
          createdAt: new Date().toISOString(),
          source: 'test',
          runId: params.requestId,
          sessionKey: 'main',
          state: 'delta',
          message: { role: 'assistant', content: 'Working' },
        });
        events.publish({
          kind: 'run_state',
          id: 'evt-final',
          createdAt: new Date().toISOString(),
          source: 'test',
          runId: params.requestId,
          sessionKey: 'main',
          state: 'final',
          message: { role: 'assistant', content: 'Working done' },
        });
      },
      abortChat: () => true,
    },
    events,
  );
  const updates: acp.SessionNotification[] = [];
  const client = acp
    .client({ name: 'test-client' })
    .onNotification('session/update', ({ params }) => {
      updates.push(params);
    });

  // When
  await client.connectWith(agent, async (context) => {
    const initialized = await context.request('initialize', {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    assert.equal(initialized.agentInfo?.name, 'fft_nano');
    assert.equal(initialized.agentCapabilities?.loadSession, true);

    const session = await context.request('session/new', {
      cwd: process.cwd(),
      mcpServers: [],
    });
    const result = await context.request('session/prompt', {
      sessionId: session.sessionId,
      prompt: [
        { type: 'text', text: 'Inspect this' },
        {
          type: 'resource_link',
          name: 'spec',
          uri: 'file:///workspace/acp-spec.md',
        },
      ],
    });
    assert.equal(result.stopReason, 'end_turn');
  });

  // Then
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.chatJid, 'telegram:42');
  assert.equal(
    sent[0]?.text,
    'Inspect this\n\n[Resource: spec](file:///workspace/acp-spec.md)',
  );
  assert.deepEqual(
    updates.map((notification) => notification.update),
    [
      {
        sessionUpdate: 'agent_message_chunk',
        messageId: sent[0]?.requestId,
        content: { type: 'text', text: 'Working' },
      },
      {
        sessionUpdate: 'agent_message_chunk',
        messageId: sent[0]?.requestId,
        content: { type: 'text', text: ' done' },
      },
    ],
  );
});

test('routes permission decisions through the active ACP client', async () => {
  // Given
  const events = new HostEventBus();
  let permissionResult: boolean | undefined;
  const agent = createAcpAgentApp(
    {
      findMainChatJid: () => 'telegram:42',
      sendPrompt: async ({ chatJid, requestId }) => {
        const unrelated = await routePermissionRequestToAcp(
          chatJid,
          'another-run',
          {
            id: 'permission-unrelated',
            method: 'confirm',
            title: 'Wrong run',
          },
        );
        assert.equal(unrelated, null);
        const response = await routePermissionRequestToAcp(chatJid, requestId, {
          id: 'permission-1',
          method: 'confirm',
          title: 'Run command',
          message: 'Allow rm temp.txt?',
        });
        permissionResult = response?.confirmed;
        events.publish({
          kind: 'run_state',
          id: 'evt-final',
          createdAt: new Date().toISOString(),
          source: 'test',
          runId: requestId,
          sessionKey: 'main',
          state: 'final',
          message: { role: 'assistant', content: 'Done' },
        });
      },
      abortChat: () => true,
    },
    events,
  );
  const client = acp
    .client({ name: 'test-client' })
    .onRequest('session/request_permission', () => ({
      outcome: { outcome: 'selected', optionId: 'allow_once' },
    }));

  // When
  await client.connectWith(agent, async (context) => {
    await context.request('initialize', {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    const session = await context.request('session/new', {
      cwd: process.cwd(),
      mcpServers: [],
    });
    await context.request('session/prompt', {
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Delete the temp file' }],
    });
  });

  // Then
  assert.equal(permissionResult, true);
});

test('cancels the active host run from an ACP cancellation', async () => {
  // Given
  const events = new HostEventBus();
  let activeRunId = '';
  let activeChatJid = '';
  let promptStarted: (() => void) | null = null;
  const started = new Promise<void>((resolve) => {
    promptStarted = resolve;
  });
  const agent = createAcpAgentApp(
    {
      findMainChatJid: () => 'telegram:42',
      sendPrompt: async ({ chatJid, requestId }) => {
        activeChatJid = chatJid;
        activeRunId = requestId;
        promptStarted?.();
      },
      abortChat: ({ chatJid, runId }) => {
        if (chatJid !== activeChatJid || runId !== activeRunId) return false;
        events.publish({
          kind: 'run_state',
          id: 'evt-aborted',
          createdAt: new Date().toISOString(),
          source: 'test',
          runId,
          sessionKey: 'main',
          state: 'aborted',
        });
        return true;
      },
    },
    events,
  );
  const client = acp.client({ name: 'test-client' });

  // When
  await client.connectWith(agent, async (context) => {
    await context.request('initialize', {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    const session = await context.request('session/new', {
      cwd: process.cwd(),
      mcpServers: [],
    });
    const prompt = context.request('session/prompt', {
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Keep working' }],
    });
    await started;
    await context.notify('session/cancel', { sessionId: session.sessionId });

    // Then
    const result = await prompt;
    assert.equal(result.stopReason, 'cancelled');
  });
});

test('rejects a failed host run after projecting its error', async () => {
  // Given
  const events = new HostEventBus();
  const updates: acp.SessionNotification[] = [];
  let failedRunId = '';
  const agent = createAcpAgentApp(
    {
      findMainChatJid: () => 'telegram:42',
      sendPrompt: async ({ requestId }) => {
        failedRunId = requestId;
        events.publish({
          kind: 'run_state',
          id: 'evt-error',
          createdAt: new Date().toISOString(),
          source: 'test',
          runId: requestId,
          sessionKey: 'main',
          state: 'error',
          errorMessage: 'Provider failed',
        });
      },
      abortChat: () => true,
    },
    events,
  );
  const client = acp
    .client({ name: 'test-client' })
    .onNotification('session/update', ({ params }) => {
      updates.push(params);
    });

  // When
  await client.connectWith(agent, async (context) => {
    await context.request('initialize', {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    const session = await context.request('session/new', {
      cwd: process.cwd(),
      mcpServers: [],
    });

    // Then
    await assert.rejects(
      context.request('session/prompt', {
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'Fail this run' }],
      }),
      /Provider failed/,
    );
  });
  assert.deepEqual(updates[0]?.update, {
    sessionUpdate: 'agent_message_chunk',
    messageId: `${failedRunId}:error`,
    content: { type: 'text', text: 'Error: Provider failed' },
  });
});

test('restricts loading to the canonical main session', async () => {
  // Given
  const events = new HostEventBus();
  const agent = createAcpAgentApp(
    {
      findMainChatJid: () => 'telegram:42',
      sendPrompt: async () => {},
      abortChat: () => true,
    },
    events,
  );

  // When
  await acp
    .client({ name: 'test-client' })
    .connectWith(agent, async (context) => {
      await context.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });

      // Then
      await assert.rejects(
        context.request('session/load', {
          sessionId: 'main-alias',
          cwd: process.cwd(),
          mcpServers: [],
        }),
        /Unknown ACP session/,
      );
    });
});

test('rejects slash commands instead of leaving an ACP prompt pending', async () => {
  // Given
  const events = new HostEventBus();
  let sent = false;
  const agent = createAcpAgentApp(
    {
      findMainChatJid: () => 'telegram:42',
      sendPrompt: async () => {
        sent = true;
      },
      abortChat: () => true,
    },
    events,
  );

  // When
  await acp
    .client({ name: 'test-client' })
    .connectWith(agent, async (context) => {
      await context.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      const session = await context.request('session/new', {
        cwd: process.cwd(),
        mcpServers: [],
      });

      // Then
      await assert.rejects(
        context.request('session/prompt', {
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text: '/gateway status' }],
        }),
        /Slash commands are not supported through ACP/,
      );
    });
  assert.equal(sent, false);
});

test('settles a queued ACP prompt when cancellation removes it', async () => {
  // Given
  const events = new HostEventBus();
  let queuedRunId = '';
  let promptQueued: (() => void) | null = null;
  const queued = new Promise<void>((resolve) => {
    promptQueued = resolve;
  });
  const agent = createAcpAgentApp(
    {
      findMainChatJid: () => 'telegram:42',
      sendPrompt: async ({ requestId }) => {
        queuedRunId = requestId;
        promptQueued?.();
      },
      abortChat: ({ runId }) => runId === queuedRunId,
    },
    events,
  );

  // When
  await acp
    .client({ name: 'test-client' })
    .connectWith(agent, async (context) => {
      await context.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      const session = await context.request('session/new', {
        cwd: process.cwd(),
        mcpServers: [],
      });
      const prompt = context.request('session/prompt', {
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'Queue this' }],
      });
      await queued;
      await context.notify('session/cancel', { sessionId: session.sessionId });

      // Then
      assert.equal((await prompt).stopReason, 'cancelled');
    });
});
