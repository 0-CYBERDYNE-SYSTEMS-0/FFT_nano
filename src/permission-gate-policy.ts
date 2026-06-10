import { isDestructiveCommand } from './bash-guard.js';

const PROTECTED_PATHS = ['.env', '.env.', '.git/', 'node_modules/'];

export type ActionCategory = 'read' | 'local-mutate' | 'outbound' | 'schedule' | 'destroy';

export interface ClassifyResult {
  category: ActionCategory;
}

/**
 * Classify a tool invocation into one of five action categories.
 * The classifier is deterministic and total — unknown tool names
 * default to 'local-mutate' (the conservative-non-allow choice).
 *
 * Category semantics:
 *   read          — tools that only read state, never mutate it
 *   local-mutate  — tools that mutate local state (filesystem edits)
 *   outbound      — tools that send data outside the host (messages, webhooks, file delivery)
 *   schedule      — tools that schedule future agent runs
 *   destroy       — bash commands flagged by isDestructiveCommand
 */
export function classifyActionCategory(
  toolName: string,
  _input: Record<string, unknown>,
): ClassifyResult {
  switch (toolName) {
    // Read-only tools
    case 'read':
    case 'grep':
    case 'ls':
      return { category: 'read' };

    // Local-mutate tools
    case 'edit':
    case 'write':
      return { category: 'local-mutate' };

    // Bash: delegate to bash-guard for destroy classification
    case 'bash': {
      // Note: the actual command is in _input.command; isDestructiveCommand
      // is called by the gate. Here we return 'destroy' only when the gate
      // has already determined the command is destructive — the gate delegates
      // to us and then applies the origin policy. Since we don't have the
      // command value here without reading _input, we return 'local-mutate'
      // as the safe default for bash; the gate itself enforces destroy via
      // isDestructiveCommand. To make this classifier total and deterministic
      // without coupling to the bash-guard internals, we inspect the input.
      const command = typeof _input.command === 'string' ? _input.command : '';
      const result = isDestructiveCommand(command);
      return { category: result.destructive ? 'destroy' : 'local-mutate' };
    }

    // Outbound IPC tools
    case 'send_message':
    case 'deliver_file':
    case 'send_webhook':
      return { category: 'outbound' };

    // Scheduling IPC tools
    case 'schedule_task':
    case 'cancel_task':
      return { category: 'schedule' };

    // Unknown / future tools: conservative default
    default:
      return { category: 'local-mutate' };
  }
}

export type PermissionGateDecision =
  | { action: 'allow' }
  | { action: 'block'; reason: string }
  | { action: 'confirm'; title: string; message: string };

export function isProtectedPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return PROTECTED_PATHS.some(
    (segment) =>
      normalized === segment ||
      normalized.includes(`/${segment}`) ||
      normalized.startsWith(segment),
  );
}

export function evaluatePermissionGate(params: {
  toolName: string;
  input: Record<string, unknown>;
  isSubagent: boolean;
  hasUI: boolean;
}): PermissionGateDecision {
  if (params.toolName === 'bash') {
    const command = String(params.input.command ?? '');
    const result = isDestructiveCommand(command);
    if (!result.destructive) return { action: 'allow' };

    if (params.isSubagent || !params.hasUI) {
      return {
        action: 'block',
        reason: `Destructive command blocked (${result.matched}). ${
          params.isSubagent
            ? 'Subagents cannot execute destructive commands.'
            : 'No confirmation UI is available.'
        }`,
      };
    }

    return {
      action: 'confirm',
      title: 'Destructive Command',
      message: `The agent wants to run:\n\n  ${command}\n\nMatched: ${result.matched}\n\nAllow this command?`,
    };
  }

  if (params.toolName === 'write' || params.toolName === 'edit') {
    const filePath = String(params.input.path ?? '');
    if (!isProtectedPath(filePath)) return { action: 'allow' };

    if (params.isSubagent || !params.hasUI) {
      return {
        action: 'block',
        reason: `Write to protected path blocked: ${filePath}. ${
          params.isSubagent
            ? 'Subagents cannot modify protected files.'
            : 'No confirmation UI is available.'
        }`,
      };
    }

    return {
      action: 'confirm',
      title: 'Protected Path',
      message: `The agent wants to ${params.toolName}:\n\n  ${filePath}\n\nThis is a protected path. Allow?`,
    };
  }

  return { action: 'allow' };
}
