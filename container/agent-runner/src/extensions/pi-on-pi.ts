import { Type } from '@sinclair/typebox';
import {
  type ExtensionAPI,
  type ToolDefinition,
} from '@mariozechner/pi-coding-agent';

import {
  runDelegatedCodingWorker,
  type DelegateParams,
} from '../coder-worker.js';

export default function piOnPiExtension(pi: ExtensionAPI): void {
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
