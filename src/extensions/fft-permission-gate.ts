import { evaluatePermissionGate } from '../permission-gate-policy.js';

type ExtensionAPI = any;

export default function (pi: ExtensionAPI) {
  const isSubagent = process.env.FFT_NANO_SUBAGENT === '1';

  pi.on('tool_call', async (event: any, ctx: any) => {
    const decision = evaluatePermissionGate({
      toolName: String(event.toolName ?? ''),
      input:
        event.input && typeof event.input === 'object'
          ? (event.input as Record<string, unknown>)
          : {},
      isSubagent,
      hasUI: ctx.hasUI,
    });

    if (decision.action === 'allow') {
      return undefined;
    }
    if (decision.action === 'block') {
      return { block: true, reason: decision.reason };
    }

    const confirmed = await ctx.ui.confirm(
      decision.title,
      decision.message,
      { timeout: 60_000 },
    );
    if (!confirmed) {
      return {
        block: true,
        reason: `${decision.title} denied by user.`,
      };
    }
    return undefined;
  });
}
