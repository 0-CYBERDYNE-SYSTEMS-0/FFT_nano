import fs from 'fs';
import path from 'path';

import { evaluatePermissionGateLegacy } from '../permission-gate-policy.js';

type ExtensionAPI = any;

/**
 * Write a .held marker file so the host-side IPC watcher can detect the held
 * decision and call enqueueHeldDelivery instead of delivering the message.
 *
 * The marker is written BEFORE the tool call returns so that by the time the
 * host polls the IPC directory, both the marker and the action/message file are
 * present and the host can atomically detect the held state.
 *
 * Marker location:
 *   send_message   → <FFT_NANO_IPC_DIR>/messages/<requestId>.held
 *   deliver_file   → <FFT_NANO_IPC_DIR>/deliver_files/<requestId>.held
 *                    (same dir as the deliver_file JSON so the watcher can
 *                    detect the marker before processing the file)
 *   send_webhook   → <FFT_NANO_IPC_DIR>/actions/<requestId>.held
 *                    (no IPC file to suppress; marker just triggers enqueue)
 *
 * Marker content includes destination and body so the host can call
 * enqueueHeldDelivery without needing to read the action/message file.
 */
function writeHeldMarker(
  requestId: string,
  toolName: string,
  input: Record<string, unknown>,
): void {
  const ipcDir = process.env.FFT_NANO_IPC_DIR;
  if (!ipcDir || !requestId) return;

  let subDir: string;
  if (toolName === 'send_message') {
    subDir = 'messages';
  } else if (toolName === 'deliver_file') {
    subDir = 'deliver_files';
  } else {
    subDir = 'actions'; // send_webhook and others
  }

  const markerPath = path.join(ipcDir, subDir, `${requestId}.held`);

  // Extract destination and body from tool input
  let destination = '';
  let body = '';
  if (toolName === 'send_message') {
    destination = String(input.chatJid ?? input.chatId ?? '');
    body = String(input.text ?? '');
  } else if (toolName === 'deliver_file') {
    destination = String(input.chatJid ?? '');
    body = `deliver_file: ${input.filePath ?? input.path ?? ''}${
      input.caption ? ` — ${input.caption}` : ''
    }`;
  } else if (toolName === 'send_webhook') {
    destination = String(input.url ?? '');
    body = `send_webhook: ${input.method ?? 'POST'} ${input.url ?? ''}`;
  }

  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(
      markerPath,
      JSON.stringify({
        requestId,
        action: toolName,
        destination,
        body,
        ts: new Date().toISOString(),
      }),
    );
  } catch {
    // Non-fatal: the marker is best-effort. The host will still receive the
    // message/action file and can fall back to checking the RunAuthority origin
    // if the marker is absent.
  }
}

export default function (pi: ExtensionAPI) {
  const isSubagent = process.env.FFT_NANO_SUBAGENT === '1';

  pi.on('tool_call', async (event: any, ctx: any) => {
    const toolName = String(event.toolName ?? '');

    // Try the RunAuthority-based gate first (preferred path).
    // The subprocess receives FFT_NANO_RUN_AUTHORITY_ID but not the full
    // RunAuthority object — for now the extension uses the legacy signature
    // which maps isSubagent/hasUI to origin equivalently.
    const decision = evaluatePermissionGateLegacy({
      toolName,
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
      // The held decision must be communicated to the host so it can call
      // enqueueHeldDelivery. Write a .held marker file before returning allow.
      // The IPC watcher detects the marker and routes to enqueueHeldDelivery.
      const requestId =
        event.input && typeof event.input === 'object'
          ? String(event.input.requestId ?? '')
          : '';
      writeHeldMarker(
        requestId,
        toolName,
        event.input && typeof event.input === 'object'
          ? (event.input as Record<string, unknown>)
          : {},
      );

      // Return allow so the tool call completes (the action/message file is
      // written to the IPC directory). The host will detect the marker and
      // suppress/normal delivery as appropriate.
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
