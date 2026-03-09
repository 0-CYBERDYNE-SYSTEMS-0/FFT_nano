import { spawnSync } from 'child_process';
import { Type } from '@sinclair/typebox';
import {
  type ExtensionAPI,
  type ToolDefinition,
} from '@mariozechner/pi-coding-agent';

import {
  runDelegatedCodingWorker,
  type DelegateParams,
} from '../coder-worker.js';

function registerOllamaProvider(pi: ExtensionAPI): void {
  const result = spawnSync('ollama', ['list'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return;

  const models = (result.stdout || '')
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((name): name is string => !!name);

  if (models.length === 0) return;

  pi.registerProvider('ollama', {
    baseUrl:
      process.env.OPENAI_BASE_URL || process.env.PI_BASE_URL || 'http://localhost:11434/v1',
    apiKey: process.env.PI_API_KEY || process.env.OPENAI_API_KEY || 'ollama',
    api: 'openai-completions',
    models: models.map((id) => ({
      id,
      name: id,
      reasoning: false,
      input: ['text'] as ('text' | 'image')[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192,
      maxTokens: 4096,
    })),
  });
}

export default function piOnPiExtension(pi: ExtensionAPI): void {
  registerOllamaProvider(pi);
  const delegateTool: ToolDefinition = {
    name: 'delegate_to_coding_agent',
    label: 'Delegate To Coding Agent',
    description:
      'Delegate a software-engineering task to an isolated coding worker session. Use for coding, debugging, tests, refactors, and implementation planning.',
    parameters: Type.Object({
      task: Type.String({
        minLength: 1,
        description: 'The exact coding task for the worker, with required context.',
      }),
      mode: Type.Union([Type.Literal('plan'), Type.Literal('execute')], {
        description:
          'plan: propose changes only. execute: implement changes in the workspace.',
      }),
      constraints: Type.Optional(
        Type.String({
          description: 'Optional constraints and guardrails for the delegated run.',
        }),
      ),
    }),
    execute: async (_toolCallId, rawParams, signal, _onUpdate, ctx) => {
      if (process.env.FFT_NANO_IS_MAIN !== '1') {
        return {
          content: [
            {
              type: 'text',
              text: 'Coding delegation is only available in the main/admin chat.',
            },
          ],
          details: { blocked: true },
        };
      }

      const params = rawParams as DelegateParams;
      if (!params.task?.trim()) {
        return {
          content: [{ type: 'text', text: 'No coding task was provided.' }],
          details: { blocked: true },
        };
      }

      const { result, streamed, stats } = await runDelegatedCodingWorker({
        params,
        signal,
        model: ctx.model,
        chatJid: process.env.FFT_NANO_CHAT_JID || '',
        requestId: process.env.FFT_NANO_REQUEST_ID || '',
      });

      return {
        content: [{ type: 'text', text: result }],
        details: {
          delegated: true,
          mode: params.mode,
          streamed,
          toolExecutionCount: stats.toolExecutionCount,
          mutatingToolExecutionCount: stats.mutatingToolExecutionCount,
          changedFiles: stats.changedFiles.length,
        },
      };
    },
  };

  pi.registerTool(delegateTool);
}
