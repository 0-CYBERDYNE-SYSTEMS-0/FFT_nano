import { evaluatePermissionGate, evaluatePermissionGateLegacy } from '../permission-gate-policy.js';

type ExtensionAPI = any;

export default function (pi: ExtensionAPI) {
  const isSubagent = process.env.FFT_NANO_SUBAGENT === '1';

  pi.on('tool_call', async (event: any, ctx: any) => {
    // Try the RunAuthority-based gate first (preferred path).
    // The subprocess receives FFT_NANO_RUN_AUTHORITY_ID but not the full
    // RunAuthority object — for now the extension uses the legacy signature
    // which maps isSubagent/hasUI to origin equivalently.
    const decision = evaluatePermissionGateLegacy({
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
    if (decision.action === 'held') {
      // Held decisions are handled by the host-side IPC handler, not the
      // subprocess extension. Return allow here so the action file is written;
      // the IPC handler will enqueue the held row and suppress delivery.
      return undefined;
    }

    // confirm
    const confirmed = await ctx.ui.confirm(decision.title, decision.message, {
      timeout: 60_000,
    });
    if (!confirmed) {
      return {
        block: true,
        reason: `${decision.title} denied by user.`,
      };
    }
    return undefined;
  });
}
