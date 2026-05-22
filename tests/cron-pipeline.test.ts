import assert from 'node:assert/strict';
import test from 'node:test';

import { CronPipeline } from '../src/pipeline/cron-pipeline.js';
import type { CronPipelineDeps } from '../src/pipeline/cron-pipeline.js';
import type { PipelineDispatchRequest } from '../src/pipeline/run-pipeline.js';
import type { ScheduledTask } from '../src/types.js';

test('CronPipeline.prepare creates prepared run without registering active runs', async () => {
  const deps = createMockCronDeps();
  const pipeline = new CronPipeline(deps);

  const request: PipelineDispatchRequest = {
    requestId: 'test-1',
    chatJid: 'test-chat',
    sessionKey: 'test-session',
    groupFolder: 'test-group',
    runType: 'cron',
    taskId: 'task-123',
  };

  const prepared = await pipeline.prepare(request);

  // CronPipeline doesn't register in activeChatRuns - it's not a chat-based run
  assert.equal(prepared.requestId, 'test-1', 'Should have correct requestId');
  assert.equal(prepared.chatJid, 'test-chat', 'Should have correct chatJid');
  assert.equal(prepared.sessionKey, 'test-session', 'Should have correct sessionKey');
  assert.ok(prepared.abortController, 'Should have abort controller');
});

test('CronPipeline.runScheduledTask executes container agent and returns output', async () => {
  const deps = createMockCronDeps();
  const pipeline = new CronPipeline(deps);

  const mockTask: ScheduledTask = {
    id: 'task-123',
    group_folder: 'test-group',
    chat_jid: 'test-chat',
    prompt: 'Check system status',
    schedule_type: 'cron',
    schedule_value: '0 * * * *',
    context_mode: 'group',
    next_run: null,
    last_run: null,
    last_result: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
  };

  deps.runContainerAgent = async (group, input) => {
    return {
      status: 'success',
      result: 'System is healthy',
      toolExecutions: [],
    };
  };

  const request: PipelineDispatchRequest = {
    requestId: 'test-2',
    chatJid: 'test-chat',
    sessionKey: 'test-session',
    groupFolder: 'test-group',
    runType: 'cron',
    taskId: 'task-123',
    abortController: new AbortController(),
  };

  const output = await pipeline.runScheduledTask(request, mockTask);

  assert.equal(output.ok, true, 'Should have ok=true');
  assert.equal(output.result, 'System is healthy', 'Should return task result');
  assert.equal(output.streamed, false, 'Should have streamed=false for cron tasks');
});

test('CronPipeline.runScheduledTask handles container agent failure', async () => {
  const deps = createMockCronDeps();
  const pipeline = new CronPipeline(deps);

  const mockTask: ScheduledTask = {
    id: 'task-456',
    group_folder: 'test-group',
    chat_jid: 'test-chat',
    prompt: 'Run backup',
    schedule_type: 'cron',
    schedule_value: '0 2 * * *',
    context_mode: 'group',
    next_run: null,
    last_run: null,
    last_result: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
  };

  deps.runContainerAgent = async () => {
    return {
      status: 'error',
      error: 'Backup failed - disk full',
    };
  };

  const request: PipelineDispatchRequest = {
    requestId: 'test-3',
    chatJid: 'test-chat',
    sessionKey: 'test-session',
    groupFolder: 'test-group',
    runType: 'cron',
    taskId: 'task-456',
  };

  const output = await pipeline.runScheduledTask(request, mockTask);

  assert.equal(output.ok, false, 'Should have ok=false on error');
  assert.equal(output.result, null, 'Should have null result on error');
});

test('CronPipeline.runScheduledTask handles exceptions', async () => {
  const deps = createMockCronDeps();
  const pipeline = new CronPipeline(deps);

  const mockTask: ScheduledTask = {
    id: 'task-789',
    group_folder: 'test-group',
    chat_jid: 'test-chat',
    prompt: 'Process data',
    schedule_type: 'interval',
    schedule_value: '3600',
    context_mode: 'group',
    next_run: null,
    last_run: null,
    last_result: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
  };

  deps.runContainerAgent = async () => {
    throw new Error('Network error');
  };

  const request: PipelineDispatchRequest = {
    requestId: 'test-4',
    chatJid: 'test-chat',
    sessionKey: 'test-session',
    groupFolder: 'test-group',
    runType: 'cron',
    taskId: 'task-789',
  };

  const output = await pipeline.runScheduledTask(request, mockTask);

  assert.equal(output.ok, false, 'Should have ok=false on exception');
  assert.equal(output.result, null, 'Should have null result on exception');
});

test('CronPipeline.runScheduledTask returns error for missing group', async () => {
  const deps = createMockCronDeps();
  deps.state.registeredGroups = {}; // No groups registered
  const pipeline = new CronPipeline(deps);

  const mockTask: ScheduledTask = {
    id: 'task-no-group',
    group_folder: 'nonexistent-group',
    chat_jid: 'test-chat',
    prompt: 'Do something',
    schedule_type: 'once',
    schedule_value: '',
    context_mode: 'group',
    next_run: null,
    last_run: null,
    last_result: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
  };

  const request: PipelineDispatchRequest = {
    requestId: 'test-5',
    chatJid: 'test-chat',
    sessionKey: 'test-session',
    groupFolder: 'nonexistent-group',
    runType: 'cron',
    taskId: 'task-no-group',
  };

  const output = await pipeline.runScheduledTask(request, mockTask);

  assert.equal(output.ok, false, 'Should have ok=false for missing group');
  assert.equal(output.result, null, 'Should have null result for missing group');
});

test('CronPipeline.runScheduledTask passes isScheduledTask flag to container agent', async () => {
  const deps = createMockCronDeps();
  const pipeline = new CronPipeline(deps);

  let receivedInput: any = null;

  deps.runContainerAgent = async (group, input) => {
    receivedInput = input;
    return { status: 'success', result: 'Done' };
  };

  const mockTask: ScheduledTask = {
    id: 'task-scheduled',
    group_folder: 'test-group',
    chat_jid: 'test-chat',
    prompt: 'Scheduled task',
    schedule_type: 'cron',
    schedule_value: '0 * * * *',
    context_mode: 'group',
    next_run: null,
    last_run: null,
    last_result: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
  };

  const request: PipelineDispatchRequest = {
    requestId: 'test-6',
    chatJid: 'test-chat',
    sessionKey: 'test-session',
    groupFolder: 'test-group',
    runType: 'cron',
    taskId: 'task-scheduled',
  };

  await pipeline.runScheduledTask(request, mockTask);

  assert.equal(receivedInput.isScheduledTask, true, 'Should pass isScheduledTask=true');
});

// Mock dependencies factory
function createMockCronDeps(): CronPipelineDeps {
  return {
    state: {
      registeredGroups: {
        'test-group': { name: 'Test Group', folder: 'test-group', trigger: '' },
      },
    },
    constants: {
      mainGroupFolder: 'test',
    },
    runContainerAgent: async () => ({
      status: 'success',
      result: 'Task completed',
    }),
    deliverTaskOutcome: async () => {},
    updateTaskAfterRun: () => {},
    logger: {
      info: () => {},
      error: () => {},
      warn: () => {},
    },
  };
}
