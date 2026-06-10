import fs from 'fs';
import path from 'path';

import { evaluatePermissionGate } from '../permission-gate-policy.js';
import type { RunAuthority } from '../types.js';

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

/**
 * Parse the RunAuthority from the environment.
 *
 * The host pushes a JSON snapshot of the RunAuthority into the subprocess env
 * via FFT_NANO_RUN_AUTHORITY_JSON. This is the authoritative source for the
 * gate decision (origin, operatorGrant, effectiveToolSet).
 *
 * If the env var is missing or malformed, we fall back to a conservative
 * block to maintain the security invariant (I1: gate never allows based on
 * missing authority).
 */
function parseRunAuthority(): RunAuthority | null {
  const raw = process.env.FFT_NANO_RUN_AUTHORITY_JSON;
  if (!raw) {
    console.error('[fft-permission-gate] FFT_NANO_RUN_AUTHORITY_JSON is not set');
    return null;
  }
  try {
    return JSON.parse(raw) as RunAuthority;
  } catch (err) {
    console.error('[fft-permission-gate] Failed to parse FFT_NANO_RUN_AUTHORITY_JSON:', err);
    return null;
  }
}

export default function (pi: ExtensionAPI) {
  pi.on('tool_call', async (event: any, ctx: any) => {
    const toolName = String(event.toolName ?? '');

    // Read the RunAuthority snapshot pushed into the subprocess env by the host.
    // This contains origin, operatorGrant, and effectiveToolSet — all host-derived
    // fields that the agent subprocess cannot influence (I1 invariant).
    const runAuthority = parseRunAuthority();
    if (!runAuthority) {
      // Conservative fallback: block if we cannot verify the authority.
      // This maintains the security invariant — missing authority means no trust.
      return { block: true, reason: 'RunAuthority not available; refusing tool call' };
    }

    const input =
      event.input && typeof event.input === 'object'
        ? (event.input as Record<string, unknown>)
        : {};

    // WS1: Use the RunAuthority-based gate. This replaces the legacy
    // isSubagent/hasUI signature. The extension now consumes the same
    // authority the host uses, so bash-guard and write/edit confirm/block
    // decisions are consistent with the host-side (category, origin) policy table.
    const decision = evaluatePermissionGate({
      toolName,
      input,
      runAuthority,
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
